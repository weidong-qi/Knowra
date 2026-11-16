import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { chromium, expect } from '@playwright/test';
import { syntheticPdf } from '../../../../scripts/test-support/pdf-fixtures.mjs';
import { startLocalRuntime } from '../../src/runtime-server.mjs';

test('PDF 重叠标注：悬停跳过空批注，四种类型均可选择底层，拖选与便签移动互不干扰', { timeout: 120000 }, async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'knowra-pdf-overlap-'));
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
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const api = async (url, method = 'GET', data) => {
    const response = await page.request.fetch(`${runtime.origin}${url}`, { method, ...(data ? { data } : {}) });
    assert(response.ok(), await response.text());
    return (await response.json()).data;
  };
  await page.goto(runtime.launchUrl);
  const space = await api('/api/knowledge/spaces/default', 'POST', {});
  const query = new URLSearchParams({ operationId: 'pdf-overlap', spaceId: space.id, fileName: '重叠标注.pdf' });
  const response = await page.request.post(`${runtime.origin}/api/storage/pdf-imports?${query}`, {
    headers: { 'Content-Type': 'application/pdf' },
    data: syntheticPdf({ pages: [{ text: 'Gradients and consistency', width: 420, height: 595 }] })
  });
  assert.equal(response.status(), 201);
  const note = (await response.json()).data;
  const url = `/api/pdf/${note.id}/annotations`;
  const marks = () => api(url);
  const textRect = [40, 500, 300, 540];
  const fixtures = [
    { id: 'lower-highlight', type: 'highlight', quoteText: '底层文字', rect: textRect },
    { id: 'upper-highlight', type: 'highlight', quoteText: '上层文字', comment: ' ', rect: textRect },
    { id: 'underline', type: 'underline', quoteText: '下划线原文', rect: textRect },
    { id: 'region', type: 'region', quoteText: '', comment: '', rect: [30, 495, 320, 545] },
    { id: 'lower-note', type: 'note', title: '底层便签', quoteText: '', rect: [100, 515, 118, 533] },
    { id: 'upper-note', type: 'note', title: '上层便签', quoteText: '', comment: '', rect: [100, 515, 118, 533] }
  ];
  for (const { id, rect, comment = `${id} 的批注`, ...fields } of fixtures) {
    await api(`${url}/${id}`, 'PUT', {
      ...fields,
      kind: 'question',
      comment,
      segments: [{ pageIndex: 0, rect }],
      expectedRevision: 0,
      operationId: `create-${id}`
    });
  }
  await page.reload();
  await page.goto(`${runtime.origin}/#/materials/notes/${note.id}`);
  await expect(page.locator('.textLayer')).toContainText('Gradients', { timeout: 25000 });
  const reader = page.getByLabel('PDF 页面', { exact: true });
  const menu = page.getByRole('menu', { name: '选择标注', exact: true });
  const actions = page.getByRole('dialog', { name: 'PDF 标注操作' });
  const editor = page.getByRole('dialog', { name: '编辑 PDF 批注' });
  const inspector = page.getByRole('complementary', { name: 'PDF 检查器' });
  const save = () => expect(page.getByText('标注已保存', { exact: true })).toBeVisible();
  const center = async id => {
    const box = await page.locator(`[data-pdf-annotation-id="${id}"]`).first().boundingBox();
    assert(box);
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  };
  const open = async (count = 6) => {
    const point = await center('lower-note');
    await page.mouse.click(point.x, point.y);
    await expect(menu).toBeVisible();
    await expect(menu.getByRole('menuitem')).toHaveCount(count);
    await expect(page.getByRole('tooltip')).toHaveCount(0);
  };
  const pick = async label => {
    await menu.getByRole('menuitem', { name: new RegExp(label) }).click();
    await expect(menu).toHaveCount(0);
  };
  const selected = id => page.locator(`[data-pdf-annotation-id="${id}"][data-selected]`).first();

  // 空批注区域和高亮不能挡住文字批注；空便签也不能挡住底层便签的正文。
  const textHit = await page.locator('[data-pdf-annotation-id="underline"][data-pdf-hit-area]').boundingBox();
  assert(textHit);
  await page.mouse.move(textHit.x + textHit.width / 2, textHit.y + textHit.height / 2);
  await expect(page.getByRole('tooltip')).toContainText('underline 的批注');
  const notePoint = await center('lower-note');
  await page.mouse.move(notePoint.x, notePoint.y);
  await expect(page.getByRole('tooltip')).toContainText('lower-note 的批注');
  const regionBox = await page.locator('[data-pdf-annotation-id="region"]').boundingBox();
  assert(regionBox);
  await page.mouse.move(regionBox.x + 2, regionBox.y + regionBox.height / 2);
  await expect(page.getByRole('tooltip')).toHaveCount(0);

  await open();
  if (process.env.KNOWRA_E2E_OUTPUT) {
    fs.mkdirSync(process.env.KNOWRA_E2E_OUTPUT, { recursive: true });
    await page.screenshot({ path: path.join(process.env.KNOWRA_E2E_OUTPUT, 'pdf-overlap-picker.png') });
  }
  await pick('下划线：下划线原文');
  await expect(actions).toBeVisible();
  await expect(selected('underline')).toBeVisible();
  await actions.getByRole('button', { name: '改为重点', exact: true }).click();
  await save();
  assert.equal((await marks()).find(item => item.id === 'underline').kind, 'important');
  assert.equal((await marks()).find(item => item.id === 'lower-highlight').kind, 'question');

  await open();
  await pick('高亮：底层文字');
  await expect(selected('lower-highlight')).toBeVisible();
  await expect(
    inspector
      .getByRole('group', { name: '批注内容，双击或按 Enter 编辑' })
      .filter({ hasText: 'lower-highlight 的批注' })
  ).toBeVisible();
  await actions.getByRole('button', { name: '编辑批注', exact: true }).click();
  await editor.getByRole('textbox', { name: '批注内容' }).fill('修改底层文字批注');
  await editor.getByRole('button', { name: '完成', exact: true }).click();
  await save();
  assert.equal((await marks()).find(item => item.id === 'lower-highlight').comment, '修改底层文字批注');

  await open();
  await pick('区域：区域标注');
  await expect(selected('region')).toBeVisible();
  await actions.getByRole('button', { name: '添加批注', exact: true }).click();
  await editor.getByRole('textbox', { name: '批注内容' }).fill('修改区域批注');
  await editor.getByRole('button', { name: '完成', exact: true }).click();
  await save();
  assert.equal((await marks()).find(item => item.id === 'region').comment, '修改区域批注');

  await open();
  await pick('便签：底层便签');
  await actions.getByRole('button', { name: '编辑批注', exact: true }).click();
  await expect(editor).toBeVisible();
  await expect(selected('lower-note')).toBeVisible();
  await editor.getByRole('textbox', { name: '批注内容' }).fill('修改底层便签');
  await editor.getByRole('button', { name: '完成', exact: true }).click();
  await save();
  assert.equal((await marks()).find(item => item.id === 'lower-note').comment, '修改底层便签');

  // 同一位置用键盘选择上层文字，再删除；底层文字及其他标注均保留。
  await open();
  await menu.getByRole('menuitem', { name: /高亮：上层文字/ }).focus();
  await page.keyboard.press('Enter');
  await expect(actions).toBeVisible();
  await actions.getByRole('button', { name: '删除', exact: true }).click();
  await save();
  const afterDelete = await marks();
  assert.equal(afterDelete.length, 5);
  assert(afterDelete.some(item => item.id === 'lower-highlight'));
  assert(!afterDelete.some(item => item.id === 'upper-highlight'));

  // 直接拖动最上层便签，不能弹候选或修改另一条便签。
  const original = (await marks()).find(item => item.id === 'upper-note');
  const start = await center('upper-note');
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 180, start.y + 160, { steps: 8 });
  await page.mouse.up();
  await save();
  await expect(menu).toHaveCount(0);
  await expect(editor).toHaveCount(0);
  const moved = (await marks()).find(item => item.id === 'upper-note');
  assert.notDeepEqual(moved.segments, original.segments);
  assert.deepEqual((await marks()).find(item => item.id === 'lower-note').segments, original.segments);
  const movedPoint = await center('upper-note');
  await page.mouse.click(movedPoint.x, movedPoint.y);
  await expect(actions).toBeVisible();
  await actions.getByRole('button', { name: '添加批注', exact: true }).click();
  await expect(editor).toBeVisible();
  await expect(menu).toHaveCount(0);
  await editor.getByRole('button', { name: '完成', exact: true }).click();
  await page.getByRole('button', { name: '撤销标注操作', exact: true }).click();
  await save();
  assert.deepEqual((await marks()).find(item => item.id === 'upper-note').segments, original.segments);
  await open(5);
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await page.getByRole('button', { name: '重做标注操作', exact: true }).click();
  await save();
  assert.deepEqual((await marks()).find(item => item.id === 'upper-note').segments, moved.segments);

  // 菜单在滚动、旋转、缩放、切换工具与外部点击时关闭。
  await open(4);
  await reader.evaluate(element => {
    element.scrollTop += 10;
  });
  await expect(menu).toHaveCount(0);
  await open(4);
  await page.getByRole('button', { name: '旋转', exact: true }).click();
  await expect(menu).toHaveCount(0);
  await open(4);
  await page.getByRole('button', { name: '缩小 PDF', exact: true }).click();
  await expect(menu).toHaveCount(0);
  await open(4);
  await page.getByRole('button', { name: '区域框选', exact: true }).click();
  await expect(menu).toHaveCount(0);
  await open(4);
  await pick('高亮：底层文字');
  await expect(actions).toBeVisible();
  await page.getByRole('button', { name: '文字选择', exact: true }).click();
  // 旋转回原方向后，从重叠文字处拖选并双击查词，不弹重叠菜单。
  for (let index = 0; index < 3; index++) await page.getByRole('button', { name: '旋转', exact: true }).click();
  await page.getByRole('button', { name: '适合宽度', exact: true }).click();
  const textPoint = await page
    .locator('.textLayer span')
    .filter({ hasText: 'Gradients' })
    .first()
    .evaluate(element => {
      const range = document.createRange();
      range.setStart(element.firstChild, 0);
      range.setEnd(element.firstChild, 3);
      const box = range.getBoundingClientRect();
      return { x: box.x + 1, y: box.y + box.height / 2, end: box.right };
    });
  await page.mouse.move(textPoint.x, textPoint.y);
  await page.mouse.down();
  await page.mouse.move(textPoint.end, textPoint.y, { steps: 5 });
  await page.mouse.up();
  await expect(page.getByRole('toolbar', { name: '选择标注分类' })).toBeVisible();
  await expect(menu).toHaveCount(0);
  await reader.press('Escape');
  await page.evaluate(() => window.getSelection()?.removeAllRanges());
  await page.mouse.dblclick(textPoint.x + 8, textPoint.y);
  await expect(page.getByRole('dialog', { name: 'PDF 查词', exact: true })).toBeVisible();
  await expect(menu).toHaveCount(0);
  assert.equal((await marks()).length, 5);
  assert.deepEqual(errors, []);
});
