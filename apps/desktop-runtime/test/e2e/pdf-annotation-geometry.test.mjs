import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { chromium, expect } from '@playwright/test';
import { jsPDF } from 'jspdf';
import { startLocalRuntime } from '../../src/runtime-server.mjs';

test('PDF 紧密行距：新旧高亮不重叠、下划线贴合原行、点击其他位置取消选中', { timeout: 90000 }, async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'knowra-pdf-geometry-'));
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
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(runtime.launchUrl);
  const space = (await (await page.request.post(`${runtime.origin}/api/knowledge/spaces/default`, { data: {} })).json())
    .data;
  const pdf = new jsPDF();
  pdf.setFont('times', 'normal');
  pdf.setFontSize(32);
  pdf.text('SCALING LAWS', 100, 30);
  pdf.text('IMPLICIT REGULARIZATION', 20, 40);
  pdf.setFontSize(18);
  pdf.text('Establishing an exchange rate between', 20, 65);
  pdf.text('augmented and additional real data', 20, 71);
  pdf.text('Unmarked text for deselection', 20, 90);
  const query = new URLSearchParams({ operationId: 'pdf-geometry', spaceId: space.id, fileName: '紧密行距.pdf' });
  const response = await page.request.post(`${runtime.origin}/api/storage/pdf-imports?${query}`, {
    headers: { 'Content-Type': 'application/pdf' },
    data: Buffer.from(pdf.output('arraybuffer'))
  });
  assert.equal(response.status(), 201);
  const note = (await response.json()).data;
  const marksUrl = `${runtime.origin}/api/pdf/${note.id}/annotations`;
  const marks = async () => (await (await page.request.get(marksUrl)).json()).data;
  await page.reload();
  await page.goto(`${runtime.origin}/#/materials/notes/${note.id}`);
  const layer = page.locator('.textLayer');
  await expect(layer).toContainText('Unmarked text', { timeout: 30000 });
  const selectLines = (start, end) =>
    layer.evaluate(
      (element, { start, end }) => {
        const spans = [...element.querySelectorAll('span[role="presentation"]')];
        const range = document.createRange();
        range.setStart(spans[start].firstChild, 0);
        range.setEnd(spans[end].firstChild, spans[end].textContent.length);
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
        element.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
        const bounds = element.closest('.page').querySelector('.canvasWrapper').getBoundingClientRect();
        return spans.slice(start, end + 1).map(span => {
          const fragment = document.createRange();
          fragment.selectNodeContents(span);
          const rect = fragment.getBoundingClientRect();
          return {
            pageIndex: 0,
            rect: [
              ((rect.left - bounds.left) * 595.28) / bounds.width,
              841.89 - ((rect.bottom - bounds.top) * 841.89) / bounds.height,
              ((rect.right - bounds.left) * 595.28) / bounds.width,
              841.89 - ((rect.top - bounds.top) * 841.89) / bounds.height
            ]
          };
        });
      },
      { start, end }
    );
  const legacy = await selectLines(0, 1);
  assert(legacy[0].rect[1] < legacy[1].rect[3], '夹具应复现旧字框的跨行重叠');
  await page.getByRole('button', { name: '标注为易错', exact: true }).click();
  await expect.poll(async () => (await marks()).length).toBe(1);
  await expect(page.getByText('标注已保存', { exact: true })).toBeVisible();
  const highlight = (await marks())[0];
  assert.equal(highlight.segments.length, 2);
  assert(highlight.segments[0].rect[1] > highlight.segments[1].rect[3], '保存的新高亮应有行间空隙');
  const highlights = page.locator('[data-type="highlight"][data-pdf-annotation-id]');
  const assertGap = async () => {
    await expect(highlights).toHaveCount(2);
    await expect
      .poll(async () => {
        const boxes = await highlights.evaluateAll(elements =>
          elements
            .map(el => {
              const rect = el.getBoundingClientRect();
              return { top: rect.top, bottom: rect.bottom };
            })
            .sort((a, b) => a.top - b.top)
        );
        return boxes.length === 2 ? boxes[1].top - boxes[0].bottom : 0;
      })
      .toBeGreaterThan(0);
  };
  await assertGap();
  // 换回旧版 Range 字框，显示修复应继续生效，服务端坐标保持原样。
  const replaced = await page.request.put(`${marksUrl}/legacy-highlight`, {
    data: {
      expectedRevision: 0,
      operationId: 'legacy-geometry',
      type: 'highlight',
      kind: 'pitfall',
      quoteText: highlight.quoteText,
      comment: '',
      segments: legacy
    }
  });
  assert.equal(replaced.status(), 200);
  assert.deepEqual((await replaced.json()).data.segments, legacy);
  const removed = await page.request.delete(`${marksUrl}/${highlight.id}`, {
    data: { expectedRevision: highlight.revision, operationId: 'replace-new-highlight' }
  });
  assert.equal(removed.status(), 200);
  await page.reload();
  await expect(layer).toContainText('Unmarked text');
  await assertGap();
  assert.deepEqual((await marks())[0].segments, legacy);
  await selectLines(2, 3);
  await page.getByRole('button', { name: '标注样式：下划线', exact: true }).click();
  await page.getByRole('button', { name: '标注为易错', exact: true }).click();
  await expect.poll(async () => (await marks()).length).toBe(2);
  await expect(page.getByText('标注已保存', { exact: true })).toBeVisible();
  const lines = page.locator('[data-type="underline"][data-pdf-annotation-id]');
  await expect(lines).toHaveCount(2);
  const lineBoxes = await lines.evaluateAll(elements =>
    elements
      .map(el => {
        const rect = el.getBoundingClientRect();
        return { top: rect.top, bottom: rect.bottom };
      })
      .sort((a, b) => a.top - b.top)
  );
  const textBoxes = await layer.locator('span[role="presentation"]').evaluateAll(elements =>
    elements.slice(2, 4).map(el => {
      const rect = el.getBoundingClientRect();
      return { top: rect.top, bottom: rect.bottom };
    })
  );
  // 字体框比实际字形高：下划线须留在两行基线的中点之前。
  assert(
    lineBoxes[0].bottom < (textBoxes[0].bottom + textBoxes[1].bottom) / 2,
    JSON.stringify({ lineBoxes, textBoxes })
  );
  const hit = page.locator('[data-pdf-hit-area]').first();
  const clickMark = async () => {
    if (await page.getByRole('complementary', { name: 'PDF 检查器' }).isVisible())
      await page.getByRole('button', { name: '关闭 PDF 检查器', exact: true }).click();
    await expect(hit).toBeVisible();
    const box = await hit.boundingBox();
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await expect(page.getByRole('dialog', { name: 'PDF 标注操作' })).toBeVisible();
    await expect(lines.first()).toHaveAttribute('data-selected', '');
    assert.equal(await lines.first().evaluate(el => getComputedStyle(el).stroke), 'none');
  };
  await clickMark();
  const screenshotRoot = process.env.KNOWRA_E2E_OUTPUT ?? root;
  await page
    .getByRole('region', { name: 'PDF 阅读与标注' })
    .screenshot({ path: path.join(screenshotRoot, 'pdf-tight-lines-selected.png') });
  const blank = await layer.boundingBox();
  await page.mouse.click(blank.x + blank.width - 20, blank.y + 220);
  await expect(page.locator('[data-knowra-pdf-overlay] [data-selected]')).toHaveCount(0);
  await expect(page.getByRole('dialog', { name: 'PDF 标注操作' })).toHaveCount(0);
  await clickMark();
  const unmarked = await layer.getByText('Unmarked text for deselection', { exact: true }).boundingBox();
  await page.mouse.click(unmarked.x + 10, unmarked.y + unmarked.height / 2);
  await expect(page.locator('[data-knowra-pdf-overlay] [data-selected]')).toHaveCount(0);
  // 操作面板已经收起时，点击页面仍应清除保留的选中状态。
  await clickMark();
  await page.getByRole('button', { name: '改为重点', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'PDF 标注操作' })).toHaveCount(0);
  await expect(lines.first()).toHaveAttribute('data-selected', '');
  await page.mouse.click(unmarked.x + 10, unmarked.y + unmarked.height / 2);
  await expect(page.locator('[data-knowra-pdf-overlay] [data-selected]')).toHaveCount(0);
  // 批注编辑浮层的外侧点击也必须同时取消选中，输入内容按既有队列保存。
  await clickMark();
  await page.getByRole('button', { name: '添加批注', exact: true }).click();
  const editor = page.getByRole('dialog', { name: '编辑 PDF 批注' });
  await editor.getByRole('textbox', { name: '批注内容' }).fill('点击其他位置结束编辑');
  await page.mouse.click(blank.x + blank.width - 20, blank.y + 220);
  await expect(editor).toHaveCount(0);
  await expect(page.locator('[data-knowra-pdf-overlay] [data-selected]')).toHaveCount(0);
  await expect
    .poll(async () => (await marks()).find(item => item.type === 'underline').comment)
    .toBe('点击其他位置结束编辑');
  await clickMark();
  await page.getByLabel('PDF 页面', { exact: true }).press('Escape');
  await expect(page.locator('[data-knowra-pdf-overlay] [data-selected]')).toHaveCount(0);
  // 细线随页面旋转，不能在 90/270 度时仍横着画在整个文字框底部。
  for (let turn = 1; turn <= 4; turn++) {
    await page.getByRole('button', { name: '旋转', exact: true }).click();
    await expect
      .poll(() =>
        lines.first().evaluate(
          (element, vertical) => {
            const area = element.closest('[data-knowra-pdf-overlay]')?.querySelector('[data-pdf-hit-area]');
            if (!area) return false;
            const line = element.getBoundingClientRect();
            const box = area.getBoundingClientRect();
            return (
              line.width > 0 &&
              line.height > 0 &&
              line.height > line.width === vertical &&
              Math.abs((vertical ? line.height : line.width) - (vertical ? box.height : box.width)) < 1
            );
          },
          turn % 2 === 1
        )
      )
      .toBe(true);
  }
  await assertGap();
  await page
    .getByRole('region', { name: 'PDF 阅读与标注' })
    .screenshot({ path: path.join(screenshotRoot, 'pdf-tight-lines-deselected.png') });
  assert.deepEqual(errors, []);
});
