import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { chromium, expect } from '@playwright/test';
import { jsPDF } from 'jspdf';
import { startLocalRuntime } from '../../src/runtime-server.mjs';

function interactionPdf() {
  const pdf = new jsPDF();
  pdf.setFont('times', 'normal');
  let x = 20;
  for (const [text, size] of [
    ['I', 32],
    ['MPLICIT', 24],
    [' ', 24],
    ['R', 32],
    ['EGULARIZATION', 24]
  ]) {
    pdf.setFontSize(size);
    pdf.text(text, x, 30);
    x += pdf.getTextWidth(text);
  }
  pdf.setFontSize(18);
  pdf.text('Second selected line', 20, 50);
  pdf.text('Left column', 20, 70);
  pdf.text('Right column', 140, 70);
  for (let i = 1; i <= 60; i++) pdf.outline.add(null, `Section ${i}`, { pageNumber: 1 });
  return Buffer.from(pdf.output('arraybuffer'));
}

test('PDF 交互：长目录与标注独立滚动、连续高亮、批注悬停且仍可拖选', { timeout: 90000 }, async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'knowra-pdf-interactions-'));
  const runtime = await startLocalRuntime({
    dataDirectory: root,
    distRoot: fileURLToPath(new URL('../../../web/dist', import.meta.url)),
    syncOptions: { autoSync: false }
  });
  const browser = await chromium.launch(
    process.env.KNOWRA_TEST_BROWSER_CHANNEL ? { channel: process.env.KNOWRA_TEST_BROWSER_CHANNEL } : {}
  );
  t.after(async () => {
    await browser.close();
    await runtime.close();
    fs.rmSync(root, { recursive: true, force: true });
  });
  const context = await browser.newContext({ viewport: { width: 1440, height: 800 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(runtime.launchUrl);
  const space = (
    await (await context.request.post(`${runtime.origin}/api/knowledge/spaces/default`, { data: {} })).json()
  ).data;
  const params = new URLSearchParams({
    operationId: 'pdf-interactions',
    spaceId: space.id,
    fileName: '连续高亮验收.pdf'
  });
  const imported = await context.request.post(`${runtime.origin}/api/storage/pdf-imports?${params}`, {
    headers: { 'Content-Type': 'application/pdf' },
    data: interactionPdf()
  });
  assert.equal(imported.status(), 201);
  const note = (await imported.json()).data;
  await page.reload();
  await page.goto(`${runtime.origin}/#/materials/notes/${note.id}`);
  await expect(page.locator('.textLayer')).toContainText('EGULARIZATION', { timeout: 25000 });
  const inspector = page.getByRole('complementary', { name: 'PDF 检查器' });
  await inspector.getByRole('tab', { name: '目录', exact: true }).click();
  const panel = inspector.getByRole('tabpanel');
  await expect.poll(() => panel.evaluate(el => el.scrollHeight > el.clientHeight)).toBe(true);
  await panel.hover();
  await page.mouse.wheel(0, 5000);
  await expect(inspector.getByRole('button', { name: 'Section 60', exact: true })).toBeInViewport();
  await expect.poll(() => panel.evaluate(el => el.scrollTop)).toBeGreaterThan(0);
  // 新选区含大小写字形和空格；同时保存旧版逐片段坐标，用来核验历史标注的显示兼容。
  const legacySegments = await page.locator('.textLayer').evaluate(layer => {
    const spans = [...layer.querySelectorAll('span[role="presentation"]')].filter(
      el => el.getBoundingClientRect().top < layer.getBoundingClientRect().top + 140
    );
    const range = document.createRange();
    range.setStart(spans[0].firstChild, 0);
    range.setEnd(spans.at(-1).firstChild, spans.at(-1).textContent.length);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    const bounds = layer.closest('.page').querySelector('.canvasWrapper').getBoundingClientRect();
    const width = (210 * 72) / 25.4,
      height = (297 * 72) / 25.4;
    const segments = spans.flatMap(span => {
      const fragment = document.createRange();
      fragment.selectNodeContents(span);
      return [...fragment.getClientRects()]
        .filter(r => r.width > 0.5)
        .map(r => ({
          pageIndex: 0,
          rect: [
            ((r.left - bounds.left) * width) / bounds.width,
            height - ((r.bottom - bounds.top) * height) / bounds.height,
            ((r.right - bounds.left) * width) / bounds.width,
            height - ((r.top - bounds.top) * height) / bounds.height
          ]
        }));
    });
    layer.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    return segments;
  });
  assert(legacySegments.length >= 4);
  await page.getByRole('button', { name: '标注为重点', exact: true }).click();
  await inspector.getByRole('textbox', { name: '评论', exact: true }).fill('悬停即可查看的批注\n第二行批注');
  await expect(page.getByText('标注已保存', { exact: true })).toBeVisible();
  let marks = (await (await context.request.get(`${runtime.origin}/api/pdf/${note.id}/annotations`)).json()).data;
  assert.equal(marks[0].segments.length, 1, JSON.stringify(marks[0].segments));
  const mark = page.locator('[data-knowra-pdf-overlay] [data-type="highlight"]');
  await expect(mark).toHaveCount(1);
  const box = await mark.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await expect(page.getByRole('tooltip')).toContainText('悬停即可查看的批注');
  await page
    .getByRole('region', { name: 'PDF 阅读与标注' })
    .screenshot({ path: path.join(process.env.KNOWRA_E2E_OUTPUT ?? root, 'pdf-continuous-highlight-hover.png') });
  // 从高亮内部开始实际拖选，浮层必须收起且文字选择继续工作。
  await page.mouse.move(box.x + 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width - 2, box.y + box.height / 2, { steps: 12 });
  await page.mouse.up();
  await expect(page.getByRole('tooltip')).toHaveCount(0);
  assert.match(await page.evaluate(() => window.getSelection().toString()), /MPLICIT/);
  await page.getByLabel('PDF 页面', { exact: true }).press('Escape');
  await page.evaluate(() => window.getSelection().removeAllRanges());
  // 重新载入已有的分散片段；不改写历史标注，只连接绘制结果。
  const replaced = await context.request.put(`${runtime.origin}/api/pdf/${note.id}/annotations/${marks[0].id}`, {
    data: { expectedRevision: marks[0].revision, operationId: 'legacy-segments', segments: legacySegments }
  });
  assert.equal(replaced.status(), 200);
  await page.reload();
  await expect(page.locator('.textLayer')).toContainText('EGULARIZATION', { timeout: 25000 });
  const legacyMark = page.locator(`[data-pdf-annotation-id="${marks[0].id}"]`);
  await expect(legacyMark).toHaveCount(1);
  for (let i = 0; i < 4; i++) {
    await page.getByRole('button', { name: '旋转', exact: true }).click();
    await expect(legacyMark).toBeVisible();
    await legacyMark.evaluate(el => el.scrollIntoView({ block: 'center', inline: 'center' }));
    // PDF.js 旋转和滚动会重建页面覆盖层，等实际绘制及批注命中均稳定。
    await expect
      .poll(async () => {
        const rotated = await legacyMark.boundingBox();
        if (!rotated) return '';
        await page.mouse.move(rotated.x + rotated.width / 2, rotated.y + rotated.height / 2);
        return (await page.getByRole('tooltip').allTextContents()).join('');
      })
      .toContain('悬停即可查看的批注');
    await page.mouse.move(5, 5);
    await expect(page.getByRole('tooltip')).toHaveCount(0);
  }
  // 多条标注也必须使用检查器自身的滚动区。
  const seed = marks[0];
  for (let i = 0; i < 15; i++) {
    const result = await context.request.put(`${runtime.origin}/api/pdf/${note.id}/annotations/list-${i}`, {
      data: {
        type: seed.type,
        kind: seed.kind,
        segments: seed.segments,
        quoteText: `Scroll mark ${i}`,
        comment: '列表批注',
        expectedRevision: 0,
        operationId: `seed-${i}`
      }
    });
    assert.equal(result.status(), 200);
  }
  await page.reload();
  await inspector.getByRole('tab', { name: /标注/ }).click();
  await expect.poll(() => panel.evaluate(el => el.scrollHeight > el.clientHeight)).toBe(true);
  await panel.hover();
  await page.mouse.wheel(0, 5000);
  await expect(inspector.getByRole('button', { name: /定位标注.*Scroll mark 14/ })).toBeInViewport();
  assert.deepEqual(errors, []);
});
