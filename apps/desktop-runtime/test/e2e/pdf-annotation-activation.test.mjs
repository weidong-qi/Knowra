import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { chromium, expect } from '@playwright/test';
import { syntheticPdf } from '../../../../scripts/test-support/pdf-fixtures.mjs';
import { startLocalRuntime } from '../../src/runtime-server.mjs';

test('PDF 标注单击操作、双击评论、常驻窗口、拖动连线与共享保存', { timeout: 120000 }, async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'knowra-pdf-activation-'));
  const runtime = await startLocalRuntime({
    dataDirectory: root,
    distRoot: fileURLToPath(new URL('../../../web/dist', import.meta.url)),
    syncOptions: { autoSync: false }
  });
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  t.after(async () => {
    if (process.env.KNOWRA_E2E_OUTPUT && !page.isClosed()) {
      fs.mkdirSync(process.env.KNOWRA_E2E_OUTPUT, { recursive: true });
      await page.screenshot({ path: path.join(process.env.KNOWRA_E2E_OUTPUT, 'pdf-comment-window-final.png') });
    }
    await browser.close();
    await runtime.close();
    fs.rmSync(root, { recursive: true, force: true });
  });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const api = async (url, method = 'GET', data) => {
    const response = await page.request.fetch(`${runtime.origin}${url}`, { method, ...(data ? { data } : {}) });
    assert(response.ok(), await response.text());
    return (await response.json()).data;
  };
  await page.goto(runtime.launchUrl);
  const space = await api('/api/knowledge/spaces/default', 'POST', {});
  const params = new URLSearchParams({ operationId: 'pdf-activation', spaceId: space.id, fileName: '点击标注.pdf' });
  const imported = await page.request.post(`${runtime.origin}/api/storage/pdf-imports?${params}`, {
    headers: { 'Content-Type': 'application/pdf' },
    data: syntheticPdf({ pages: [{ text: 'Gradients and consistency', width: 420, height: 595 }] })
  });
  assert.equal(imported.status(), 201);
  const note = (await imported.json()).data;
  const fixtures = [
    { id: 'highlight', type: 'highlight', rect: [40, 500, 220, 540] },
    { id: 'underline', type: 'underline', rect: [40, 420, 190, 440] },
    { id: 'region', type: 'region', rect: [280, 470, 330, 500] },
    { id: 'note', type: 'note', title: '便签目标', rect: [240, 460, 258, 478] }
  ];
  for (const { rect, ...item } of fixtures) {
    await api(`/api/pdf/${note.id}/annotations/${item.id}`, 'PUT', {
      ...item,
      kind: 'question',
      quoteText: `${item.id} 原文`,
      comment: `${item.id} 批注`,
      segments: [{ pageIndex: 0, rect }],
      expectedRevision: 0,
      operationId: `create-${item.id}`
    });
  }
  await page.reload();
  await page.goto(`${runtime.origin}/#/materials/notes/${note.id}`);
  await expect(page.locator('.textLayer')).toContainText('Gradients', { timeout: 25000 });
  const reader = page.getByLabel('PDF 页面', { exact: true });
  const inspector = page.getByRole('complementary', { name: 'PDF 检查器' });
  const actions = page.getByRole('dialog', { name: 'PDF 标注操作', exact: true });
  const editor = page.getByRole('dialog', { name: '编辑 PDF 批注', exact: true });
  const overlay = id => page.locator(`[data-pdf-annotation-id="${id}"]`).first();
  const settleLayout = () =>
    page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const position = async id => {
    // 侧栏开闭会按纸面宽度重新缩放；先完成布局，再把夹具放进可点击的阅读区。
    await settleLayout();
    await overlay(id).evaluate(element => element.scrollIntoView({ block: 'center', inline: 'center' }));
    await settleLayout();
  };
  const click = async id => {
    const box = await overlay(id).boundingBox();
    assert(box);
    const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    const inReader = await reader.evaluate(
      (element, point) => element.contains(document.elementFromPoint(point.x, point.y)),
      point
    );
    assert(inReader, `${id} 的点击位置必须落在 PDF 阅读区内：${JSON.stringify(point)}`);
    await page.mouse.click(point.x, point.y);
  };
  const hover = async id => {
    const box = await overlay(id).boundingBox();
    assert(box);
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  };
  const blank = async () => {
    const box = await page.locator('.canvasWrapper').boundingBox();
    await page.mouse.click(box.x + box.width * 0.9, box.y + box.height * 0.4);
  };
  const preview = id =>
    inspector.getByRole('group', { name: '批注内容，双击或按 Enter 编辑' }).filter({ hasText: `${id} 批注` });
  const input = editor.getByRole('textbox', { name: '批注内容', exact: true });
  const close = () => editor.getByRole('button', { name: '关闭批注输入框', exact: true }).click();
  const marks = () => api(`/api/pdf/${note.id}/annotations`);
  const connector = page.locator('[data-pdf-comment-connector]');
  const at = async locator => {
    const box = await locator.boundingBox();
    assert(box);
    return { x: Math.round(box.x), y: Math.round(box.y) };
  };
  const moveWindow = async () => {
    const bounds = await reader.boundingBox();
    const handle = await editor.getByRole('group', { name: '移动批注窗口' }).boundingBox();
    await page.mouse.move(handle.x + 12, handle.y + 12);
    await page.mouse.down();
    await page.mouse.move(bounds.x + bounds.width - 340, bounds.y + bounds.height - 230, { steps: 8 });
    await page.mouse.up();
    await settleLayout();
  };
  // 四类标注均一次显示操作栏、再次收起；侧栏不自动变成输入状态。
  for (const item of fixtures) {
    await position(item.id);
    await hover(item.id);
    await expect(page.getByRole('tooltip')).toContainText(`${item.id} 批注`);
    const top = await reader.evaluate(element => element.scrollTop);
    await click(item.id);
    await expect(actions).toBeVisible();
    await expect(editor).toHaveCount(0);
    await expect(page.getByRole('tooltip')).toHaveCount(0);
    await expect(overlay(item.id)).toHaveAttribute('data-selected', '');
    await expect(inspector.getByRole('textbox', { name: '评论', exact: true })).toHaveCount(0);
    assert.equal(await reader.evaluate(element => element.scrollTop), top);
    await click(item.id);
    await expect(actions).toHaveCount(0);
    await expect(overlay(item.id)).toHaveAttribute('data-selected', '');
  }

  // 灰色评论区单击定位并显示正文窗口，不抢焦点；拖窗口不移动标注。
  await preview('highlight').click();
  await expect(input).toHaveValue('highlight 批注');
  await expect(input).not.toBeFocused();
  const annotationBefore = (await marks()).find(item => item.id === 'highlight').segments;
  const initial = await at(editor);
  await moveWindow();
  const moved = await at(editor);
  assert.notDeepEqual(moved, initial);
  assert.deepEqual((await marks()).find(item => item.id === 'highlight').segments, annotationBefore);
  await editor.hover();
  await expect(connector).toHaveCount(1);
  await expect(connector).toHaveAttribute('data-pdf-comment-connector', 'highlight');
  assert.equal(await connector.evaluate(element => getComputedStyle(element).pointerEvents), 'none');
  await hover('highlight');
  await expect(page.getByRole('tooltip')).toHaveCount(0);
  await expect(connector).toHaveCount(1);
  await page.mouse.move(5, 5);
  await expect(connector).toHaveCount(0);

  // A 的窗口不随 B 的选中切换；B 仍可预览，并随指针移动。
  await hover('underline');
  await expect(page.getByRole('tooltip')).toContainText('underline 批注');
  const tooltipBefore = await at(page.getByRole('tooltip'));
  const underlineBox = await overlay('underline').boundingBox();
  await page.mouse.move(underlineBox.x + underlineBox.width / 2 + 24, underlineBox.y + underlineBox.height / 2);
  await expect.poll(async () => (await at(page.getByRole('tooltip'))).x).toBeGreaterThan(tooltipBefore.x + 10);
  await reader.press('Escape');
  await expect(page.getByRole('tooltip')).toHaveCount(0);
  await expect(editor).toBeVisible();
  await click('underline');
  await expect(actions).toBeVisible();
  await expect(input).toHaveValue('highlight 批注');
  assert.deepEqual(await at(editor), moved);
  await reader.press('Escape');
  await expect(actions).toHaveCount(0);
  await expect(editor).toBeVisible();

  // 正文右键明确编辑 B，保持只有一个窗口并聚焦输入。
  const target = await overlay('underline').boundingBox();
  await page.mouse.click(target.x + target.width / 2, target.y + target.height / 2, { button: 'right' });
  await expect(editor).toHaveCount(1);
  await expect(input).toHaveValue('underline 批注');
  await expect(input).toBeFocused();
  await input.fill('正文修改后侧栏同步');
  await expect(
    inspector.getByRole('group', { name: '批注内容，双击或按 Enter 编辑' }).filter({ hasText: '正文修改后侧栏同步' })
  ).toBeVisible();
  await close();

  // 未选中的侧栏评论可以直接双击；中文输入 Esc 不结束编辑。
  await preview('highlight').dblclick();
  const inline = inspector.getByRole('textbox', { name: '评论', exact: true });
  await expect(inline).toBeFocused();
  await inline.fill('侧栏修改后正文同步');
  await expect(input).toHaveValue('侧栏修改后正文同步');
  await inline.dispatchEvent('keydown', { key: 'Escape', isComposing: true });
  await expect(inline).toBeFocused();
  await inline.dispatchEvent('keydown', { key: 'Escape', keyCode: 229 });
  await expect(inline).toBeFocused();
  await inline.press('Escape');
  await expect(inline).toHaveCount(0);
  await expect(editor).toBeVisible();
  assert.deepEqual(await at(editor), moved, '每条批注记住本次阅读中的窗口位置');
  await expect
    .poll(async () => (await marks()).find(item => item.id === 'highlight').comment)
    .toBe('侧栏修改后正文同步');
  await expect
    .poll(async () => (await marks()).find(item => item.id === 'underline').comment)
    .toBe('正文修改后侧栏同步');

  // 点击空白、阅读滚动、缩放和旋转均保留窗口；标注离屏时连线消失。
  await blank();
  await expect(editor).toBeVisible();
  assert.deepEqual(await at(editor), moved);
  await reader.evaluate(element => {
    element.scrollTop = element.scrollHeight;
  });
  await editor.hover();
  await expect(connector).toHaveCount(0);
  assert.deepEqual(await at(editor), moved);
  await position('highlight');
  await editor.hover();
  await expect(connector).toHaveCount(1);
  for (const label of ['缩小 PDF', '旋转']) {
    await page.getByRole('button', { name: label, exact: true }).click();
    await expect(editor).toBeVisible();
    assert.deepEqual(await at(editor), moved);
    await position('highlight');
    await editor.hover();
    await expect(connector).toHaveCount(1);
  }
  for (let turn = 0; turn < 3; turn++) await page.getByRole('button', { name: '旋转', exact: true }).click();
  await position('highlight');
  if (process.env.KNOWRA_E2E_OUTPUT) {
    fs.mkdirSync(process.env.KNOWRA_E2E_OUTPUT, { recursive: true });
    await editor.hover();
    await page.screenshot({ path: path.join(process.env.KNOWRA_E2E_OUTPUT, 'pdf-comment-window-light.png') });
    await page.getByRole('button', { name: '切换深色模式', exact: true }).click();
    await editor.hover();
    await page.screenshot({ path: path.join(process.env.KNOWRA_E2E_OUTPUT, 'pdf-comment-window-dark.png') });
    await page.getByRole('button', { name: '切换浅色模式', exact: true }).click();
  }
  await reader.press('Escape');
  await expect(editor).toHaveCount(0);
  await expect(overlay('highlight')).toHaveAttribute('data-selected', '');

  // 目录和关闭侧栏时也是相同的一次点击行为，不自动重新展开侧栏。
  await page.getByRole('button', { name: '目录', exact: true }).click();
  await click('highlight');
  await expect(actions).toBeVisible();
  await expect(inspector.getByRole('tab', { name: /标注/ })).toHaveAttribute('aria-selected', 'true');
  await reader.press('Escape');
  await inspector.getByRole('button', { name: '关闭 PDF 检查器' }).click();
  for (const item of fixtures) {
    await position(item.id);
    await click(item.id);
    await expect(actions).toBeVisible();
    await expect(inspector).toHaveCount(0);
    await reader.press('Escape');
  }
  await page.getByRole('button', { name: '标注', exact: true }).click();
  await position('highlight');
  const search = inspector.getByRole('searchbox', { name: '搜索标注和批注' });
  await search.fill('不匹配');
  await click('highlight');
  await expect(actions).toBeVisible();
  await expect(inspector.getByLabel('当前选中标注')).toContainText('highlight 原文');
  await expect(search).toHaveValue('不匹配');
  await actions.getByRole('button', { name: '编辑批注', exact: true }).click();
  await expect(input).toHaveValue('侧栏修改后正文同步');
  await inspector.getByLabel('当前选中标注').getByRole('button', { name: '删除标注', exact: true }).click();
  await expect(editor).toHaveCount(0);
  await expect(overlay('highlight')).toHaveCount(0);
  await hover('underline');
  await expect(page.getByRole('tooltip')).toContainText('正文修改后侧栏同步');
  await expect(page.getByText('标注已保存', { exact: true })).toBeVisible();
  await search.clear();
  // 重新打开 PDF 会重置会话位置，内容由真实 SQLite 恢复。
  await inspector.getByRole('button', { name: /定位标注.*underline 原文/ }).click();
  await moveWindow();
  const underlinePosition = await at(editor);
  await page.reload();
  await expect(page.locator('.textLayer')).toContainText('Gradients', { timeout: 25000 });
  await inspector.getByRole('button', { name: /定位标注.*underline 原文/ }).click();
  await expect(input).toHaveValue('正文修改后侧栏同步');
  assert.notDeepEqual(await at(editor), underlinePosition);
  assert.deepEqual(errors, []);
});
