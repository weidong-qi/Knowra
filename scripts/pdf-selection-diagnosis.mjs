/* global window, document, CanvasRenderingContext2D, HTMLElement, HTMLCanvasElement, getComputedStyle, requestAnimationFrame */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, expect } from '@playwright/test';
import { startLocalRuntime } from '../apps/desktop-runtime/src/runtime-server.mjs';

// 公开文件与用户原件逐字节一致。坐标独立取自原 PDF 第 2 页的字符对象。
const sourceUrl = 'https://arxiv.org/pdf/2210.06441v2';
const sourceHash = 'fafd9079da8cfdd2cc28c9356ee358cb78ca4056c461d5f4a99813a523bfff87';
const reference = {
  pageWidth: 612,
  pageHeight: 792,
  word: [239.0476804, 178.4083216, 260.078729, 188.3709216],
  leading: [239.0476804, 178.4083216, 244.0289804, 188.3709216]
};
const output = path.resolve('test-results/pdf-selection-diagnosis', process.platform);
fs.mkdirSync(output, { recursive: true });
const report = { sourceUrl, sourceHash, platform: process.platform, arch: process.arch, reference, cases: [] };
const dataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'knowra-selection-probe-'));
let runtime, browser;
try {
  const response = await fetch(sourceUrl);
  assert(response.ok, `公开 PDF 下载失败：${response.status}`);
  const pdfBytes = Buffer.from(await response.arrayBuffer());
  assert.equal(createHash('sha256').update(pdfBytes).digest('hex'), sourceHash);
  runtime = await startLocalRuntime({
    dataDirectory,
    distRoot: fileURLToPath(new URL('../apps/web/dist', import.meta.url)),
    syncOptions: { autoSync: false }
  });
  browser = await chromium.launch();
  report.browser = browser.version();
  const seed = await browser.newPage();
  await seed.goto(runtime.launchUrl);
  const api = async (url, method = 'GET', data) => {
    const result = await seed.request.fetch(`${runtime.origin}${url}`, { method, ...(data ? { data } : {}) });
    assert(result.ok(), await result.text());
    return (await result.json()).data;
  };
  const space = await api('/api/knowledge/spaces/default', 'POST', {});
  const query = new URLSearchParams({ operationId: 'selection-probe', spaceId: space.id, fileName: '选词对照.pdf' });
  const imported = await seed.request.post(`${runtime.origin}/api/storage/pdf-imports?${query}`, {
    headers: { 'Content-Type': 'application/pdf' },
    data: pdfBytes
  });
  assert.equal(imported.status(), 201);
  const note = (await imported.json()).data;
  const sessionCookies = await seed.context().cookies();
  await seed.close();
  const modes = [
    { id: 'zh-baseline', lang: 'zh-CN', inheritFix: false, metricFont: false },
    { id: 'en-baseline', lang: 'en', inheritFix: false, metricFont: false },
    { id: 'zh-inherit-fix', lang: 'zh-CN', inheritFix: true, metricFont: false },
    { id: 'zh-metric-font', lang: 'zh-CN', inheritFix: false, metricFont: true },
    { id: 'zh-inherit-and-metric', lang: 'zh-CN', inheritFix: true, metricFont: true }
  ];
  for (const mode of modes) {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
      deviceScaleFactor: 2,
      locale: 'zh-CN'
    });
    await context.addCookies(sessionCookies);
    const page = await context.newPage();
    const errors = [];
    (report.contexts ??= []).push({ mode, errors });
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(({ inheritFix }) => {
      window.__pdfMeasureSamples = [];
      const measure = CanvasRenderingContext2D.prototype.measureText;
      CanvasRenderingContext2D.prototype.measureText = function (text) {
        const metrics = measure.call(this, text);
        if (this.canvas.style.display === 'none' && String(text).includes('noise showing')) {
          window.__pdfMeasureSamples.push({
            text,
            width: metrics.width,
            font: this.font,
            canvasLang: this.canvas.getAttribute('lang'),
            contextLang: this.lang,
            textRendering: this.textRendering
          });
        }
        return metrics;
      };
      if (inheritFix) {
        const lang = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'lang');
        Object.defineProperty(HTMLElement.prototype, 'lang', {
          ...lang,
          set(value) {
            // 与上游 #22261 一致：仅对未声明语言的测量画布保留语言继承。
            if (this instanceof HTMLCanvasElement && this.style.display === 'none' && value === '') {
              this.removeAttribute('lang');
              return;
            }
            lang.set.call(this, value);
          }
        });
      }
    }, mode);
    await page.goto(runtime.origin);
    await page.waitForFunction(() => window.__knowraPdfSelectionDiagnostics);
    await page.evaluate(
      ({ mode, noteId }) => {
        document.documentElement.lang = mode.lang;
        const diagnostics = window.__knowraPdfSelectionDiagnostics;
        if (mode.metricFont) {
          // 原 PDF 的 Nimbus Roman 字体仅标了 Symbolic，实际被分配到 sans-serif。
          // 此项只验证该行的字体度量，不作为整份文档的正式字体替换方案。
          for (const family of ['serif', 'sans-serif']) {
            diagnostics.pdfjs.TextLayer.fontFamilyMap.set(
              family,
              '"Times New Roman", Times, "Liberation Serif", serif'
            );
          }
        }
        const setDocument = diagnostics.PDFViewer.prototype.setDocument;
        diagnostics.PDFViewer.prototype.setDocument = function (pdf) {
          window.__pdfViewerForDiagnosis = this;
          return setDocument.call(this, pdf);
        };
        window.location.hash = `/materials/notes/${noteId}`;
      },
      { mode, noteId: note.id }
    );
    const secondPage = page.locator('.page[data-page-number="2"]');
    await expect(secondPage).toHaveCount(1, { timeout: 30000 });
    await secondPage.scrollIntoViewIfNeeded();
    const target = secondPage
      .locator('.textLayer span[role="presentation"]')
      .filter({ hasText: 'noise showing' })
      .first();
    await expect(target).toBeVisible({ timeout: 30000 });
    const metadata = await page.evaluate(async () => {
      const pdf = window.__pdfViewerForDiagnosis.pdfDocument;
      const content = await (await pdf.getPage(2)).getTextContent();
      const item = content.items.find(value => value.str?.includes('noise showing'));
      return { language: content.lang, item, style: content.styles[item.fontName] };
    });
    for (const zoomSteps of [0, 2]) {
      if (zoomSteps) {
        await page.getByLabel('PDF 页面', { exact: true }).press('Escape');
        await page.evaluate(() => window.getSelection()?.removeAllRanges());
        for (let i = 0; i < zoomSteps; i++) await page.getByRole('button', { name: '放大 PDF', exact: true }).click();
      }
      await expect(target).toBeVisible();
      await target.evaluate(element => element.scrollIntoView({ block: 'center', inline: 'center' }));
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const point = await secondPage.locator('.canvasWrapper').evaluate((element, reference) => {
        const box = element.getBoundingClientRect();
        return {
          x: box.left + ((reference.word[0] + reference.word[2]) / 2 / reference.pageWidth) * box.width,
          y: box.top + ((reference.word[1] + reference.word[3]) / 2 / reference.pageHeight) * box.height
        };
      }, reference);
      await page.mouse.dblclick(point.x, point.y, { delay: 70 });
      await expect(page.getByRole('dialog', { name: 'PDF 查词', exact: true })).toBeVisible();
      const result = await target.evaluate((span, reference) => {
        const selection = window.getSelection();
        const rect = selection.getRangeAt(0).getBoundingClientRect();
        const wrapper = span.closest('.page').querySelector('.canvasWrapper');
        const paper = wrapper.getBoundingClientRect();
        const bitmap = [...wrapper.querySelectorAll('canvas')].find(
          canvas => canvas.width && getComputedStyle(canvas).display !== 'none'
        );
        const ink = pdfRect => {
          const x = Math.floor((pdfRect[0] / reference.pageWidth) * bitmap.width);
          const y = Math.floor((pdfRect[1] / reference.pageHeight) * bitmap.height);
          const width = Math.ceil((pdfRect[2] / reference.pageWidth) * bitmap.width) - x;
          const height = Math.ceil((pdfRect[3] / reference.pageHeight) * bitmap.height) - y;
          const pixels = bitmap.getContext('2d').getImageData(x, y, width, height).data;
          let min = width,
            max = -1;
          for (let iy = 0; iy < height; iy++)
            for (let ix = 0; ix < width; ix++) {
              const offset = (iy * width + ix) * 4;
              if (
                pixels[offset + 3] > 127 &&
                pixels[offset] < 160 &&
                pixels[offset + 1] < 160 &&
                pixels[offset + 2] < 160
              ) {
                min = Math.min(min, ix);
                max = Math.max(max, ix);
              }
            }
          if (max < 0) throw new Error('目标字框内没有找到原 PDF 的黑色字形');
          return {
            left: paper.left + ((x + min) / bitmap.width) * paper.width,
            right: paper.left + ((x + max + 1) / bitmap.width) * paper.width
          };
        };
        const wordInk = ink(reference.word),
          leadingInk = ink(reference.leading);
        const index = span.textContent.indexOf('noise');
        const manual = document.createRange();
        manual.setStart(span.firstChild, index);
        manual.setEnd(span.firstChild, index + 5);
        const expected = manual.getBoundingClientRect();
        const style = getComputedStyle(span);
        const spanRect = span.getBoundingClientRect();
        return {
          selectedText: selection.toString(),
          pageLang: document.documentElement.lang,
          browserLang: navigator.language,
          scale: paper.width / reference.pageWidth,
          selection: { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom },
          manualSelection: { left: expected.left, right: expected.right },
          wordInk,
          leadingInk,
          leadingGapCssPx: rect.left - leadingInk.left,
          trailingGapCssPx: wordInk.right - rect.right,
          leadingUncoveredFraction: Math.max(0, rect.left - leadingInk.left) / (leadingInk.right - leadingInk.left),
          span: {
            text: span.textContent,
            width: spanRect.width,
            fontFamily: style.fontFamily,
            fontSize: style.fontSize,
            transform: style.transform,
            textRendering: style.textRendering
          },
          measurements: window.__pdfMeasureSamples
        };
      }, reference);
      const id = `${mode.id}-zoom-${zoomSteps}`;
      report.cases.push({ id, mode, metadata, ...result, errors: [...errors] });
      console.log('PDF_SELECTION_CASE', JSON.stringify(report.cases.at(-1)));
      const frame = page.viewportSize();
      const clip = {
        x: Math.max(0, Math.min(result.selection.left, result.wordInk.left) - 95),
        y: Math.max(0, result.selection.top - 30),
        width: 360,
        height: 110
      };
      clip.width = Math.min(clip.width, frame.width - clip.x);
      clip.height = Math.min(clip.height, frame.height - clip.y);
      await page.screenshot({ path: path.join(output, `${id}.png`), clip });
      fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
    }
    await context.close();
  }
} finally {
  fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  await browser?.close();
  await runtime?.close();
  fs.rmSync(dataDirectory, { recursive: true, force: true });
}
