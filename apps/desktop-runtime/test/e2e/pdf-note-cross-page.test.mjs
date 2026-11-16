import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { chromium, expect } from '@playwright/test';
import { syntheticPdf } from '../../../../scripts/test-support/pdf-fixtures.mjs';
import { startLocalRuntime } from '../../src/runtime-server.mjs';

test('PDF 便签跨页拖动、边缘自动滚动、撤销重做与取消', { timeout: 90000 }, async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'knowra-pdf-note-cross-page-'));
  const runtime = await startLocalRuntime({
    dataDirectory: root,
    distRoot: fileURLToPath(new URL('../../../web/dist', import.meta.url)),
    syncOptions: { autoSync: false }
  });
  const browser = await chromium.launch();
  t.after(async () => {
    await browser.close();
    await runtime.close();
    fs.rmSync(root, { recursive: true, force: true });
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }),
    errors = [];
  await page.clock.install();
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(runtime.launchUrl);
  const api = async (url, method = 'GET', data) => {
    const response = await page.request.fetch(`${runtime.origin}${url}`, { method, ...(data ? { data } : {}) });
    assert(response.ok(), await response.text());
    return (await response.json()).data;
  };
  const space = await api('/api/knowledge/spaces/default', 'POST', {});
  const params = new URLSearchParams({ operationId: 'cross-page-import', spaceId: space.id, fileName: '便签跨页.pdf' });
  const response = await page.request.post(`${runtime.origin}/api/storage/pdf-imports?${params}`, {
    headers: { 'Content-Type': 'application/pdf' },
    data: syntheticPdf({
      pages: [
        { text: 'First page', width: 420, height: 360 },
        { text: 'Rotated second page', width: 300, height: 500, rotation: 90 },
        { text: 'Third page', width: 420, height: 595 }
      ]
    })
  });
  assert.equal(response.status(), 201);
  const note = (await response.json()).data;
  const marksUrl = `/api/pdf/${note.id}/annotations`;
  const original = await api(`${marksUrl}/cross-page-note`, 'PUT', {
    type: 'note',
    title: '跨页保留标题',
    comment: '跨页保留正文',
    kind: 'question',
    quoteText: '',
    segments: [{ pageIndex: 0, rect: [180, 180, 198, 198] }],
    expectedRevision: 0,
    operationId: 'cross-page-seed'
  });
  const marks = () => api(marksUrl),
    sticky = async () => (await marks()).find(item => item.id === original.id);
  await page.reload();
  await page.goto(`${runtime.origin}/#/materials/notes/${note.id}`);
  await expect(page.locator('.textLayer').first()).toContainText('First page', { timeout: 25000 });
  const reader = page.getByLabel('PDF 页面', { exact: true });
  const icon = page.locator(`[data-note-id="${original.id}"]`);
  const paper = index => page.locator(`.page[data-page-number="${index}"] .canvasWrapper`);
  // 覆盖层逐帧重画，查询与读取放在同一次页面脚本中，避免持有已被替换的 SVG。
  const previewPage = () =>
    page.evaluate(
      id =>
        document
          .querySelector(`[data-note-id="${CSS.escape(id)}"]`)
          ?.closest('.page')
          ?.getAttribute('data-page-number') ?? null,
      original.id
    );
  const savedOn = async index => {
    await expect.poll(async () => (await sticky()).segments[0].pageIndex).toBe(index);
    await expect(page.getByText('标注已保存', { exact: true })).toBeVisible();
  };
  const begin = async () => {
    // 缩放/侧栏定位后的覆盖层在下一帧刷新，按真实稳定布局开始拖动。
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const b = await icon.boundingBox();
    assert(b);
    await page.mouse.move(b.x + b.width * 0.3, b.y + b.height * 0.7);
    await page.mouse.down();
  };
  const undo = page.getByRole('button', { name: '撤销标注操作', exact: true });
  const redo = page.getByRole('button', { name: '重做标注操作', exact: true });

  // 通过真实缩放控件把前两页同时放进阅读区，覆盖不同尺寸和旋转的目标页。
  for (let i = 0; i < 12; i++) {
    const second = await paper(2).boundingBox(),
      area = await reader.boundingBox();
    if (second && second.y + second.height < area.y + area.height - 80) break;
    await page.getByRole('button', { name: '缩小 PDF', exact: true }).click();
  }
  const second = await paper(2).boundingBox(),
    area = await reader.boundingBox();
  assert(second && area && second.y + second.height < area.y + area.height - 80);
  const target = { x: second.x + second.width * 0.55, y: second.y + second.height * 0.5 };
  await begin();
  await page.mouse.move(target.x, target.y, { steps: 10 });
  await expect.poll(previewPage).toBe('2');
  assert.equal((await sticky()).segments[0].pageIndex, 0, '拖动预览不提前写入');
  const preview = await icon.boundingBox();
  assert(Math.abs(preview.x + preview.width * 0.3 - target.x) < 2, '保留横向抓取位置');
  assert(Math.abs(preview.y + preview.height * 0.7 - target.y) < 2, '保留纵向抓取位置');
  await page.mouse.up();
  await savedOn(1);
  const moved = await sticky();
  assert.equal(moved.title, original.title);
  assert.equal(moved.comment, original.comment);
  assert.equal(moved.revision, original.revision + 1, '整个拖动只保存一次');
  assert(Math.abs(moved.segments[0].rect[2] - moved.segments[0].rect[0] - 18) < 0.01);
  await expect(page.getByRole('button', { name: /定位标注 第 2 页 跨页保留标题/ })).toBeVisible();
  await undo.click();
  await savedOn(0);
  assert.deepEqual((await sticky()).segments, original.segments);
  await redo.click();
  await savedOn(1);
  assert.deepEqual((await sticky()).segments, moved.segments);

  // 反向拖回第一页，再恢复适合宽度；后续跨页必须靠边缘滚动抵达。
  const first = await paper(1).boundingBox();
  await begin();
  await page.mouse.move(first.x + first.width * 0.6, first.y + first.height * 0.55, { steps: 10 });
  await page.mouse.up();
  await savedOn(0);
  await page.getByRole('button', { name: '适合宽度', exact: true }).click();
  const locate = async () => {
    await page.getByRole('button', { name: /定位标注 第 \d+ 页 跨页保留标题/ }).click();
    await page.getByRole('button', { name: '关闭批注输入框', exact: true }).click();
  };
  await locate();
  const readScroll = () => reader.evaluate(element => element.scrollTop);
  const waitFrames = () =>
    page.evaluate(
      () =>
        new Promise(resolve => {
          let remaining = 10;
          function frame() {
            if (--remaining === 0) resolve();
            else requestAnimationFrame(frame);
          }
          requestAnimationFrame(frame);
        })
    );
  const stopped = async () => {
    const top = await readScroll();
    await waitFrames();
    assert(Math.abs((await readScroll()) - top) < 1, '结束拖动后自动滚动停止');
  };
  const edge = async bottom => {
    const b = await reader.boundingBox();
    // 避开中间的悬浮页码条，鼠标保持静止等待滚动。
    await page.mouse.move(b.x + b.width * 0.75, bottom ? b.y + b.height - 6 : b.y + 6, { steps: 10 });
  };
  const beforeAuto = await sticky();
  const dragByScrolling = async (target, bottom) => {
    await begin();
    const before = await readScroll();
    await page.clock.pauseAt(new Date((await page.evaluate(() => Date.now())) + 1000));
    await edge(bottom);
    let reached = false;
    // 保持真实指针和自动滚动，逐帧检查瞬时落点，避免轮询间隔内跳过目标页后继续到第三页。
    for (let frame = 0; frame < 625; frame++) {
      await page.clock.runFor(16);
      const top = await readScroll();
      if ((await previewPage()) === target && (bottom ? top > before + 40 : top < before - 40)) {
        reached = true;
        break;
      }
    }
    assert(reached, `自动滚动须抵达第 ${target} 页且产生实际滚动`);
    await page.mouse.up();
    await page.clock.resume();
  };
  await dragByScrolling('2', true);
  await savedOn(1);
  assert.equal((await sticky()).revision, beforeAuto.revision + 1);
  await stopped();
  await locate();
  await dragByScrolling('1', false);
  await savedOn(0);
  await stopped();

  // Escape 取消整个拖动，不能保存中途的预览或留下滚动任务。
  await locate();
  const beforeCancel = await sticky(),
    scrollBeforeCancel = await readScroll();
  await begin();
  await edge(true);
  await expect.poll(readScroll).toBeGreaterThan(scrollBeforeCancel + 40);
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await stopped();
  assert.deepEqual(await sticky(), beforeCancel);
  await page.reload();
  // 阅读位置独立恢复，先从侧栏定位已保存的便签，再核对纸面标记。
  await locate();
  await expect(icon).toHaveCount(1);
  assert.equal((await marks()).length, 1);
  assert.deepEqual((await sticky()).segments, beforeCancel.segments);
  assert.equal((await sticky()).title, original.title);
  assert.equal((await sticky()).comment, original.comment);
  assert.deepEqual(errors, []);
});
