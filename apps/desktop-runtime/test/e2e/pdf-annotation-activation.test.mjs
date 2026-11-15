import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { chromium, expect } from '@playwright/test';
import { syntheticPdf } from '../../../../scripts/test-support/pdf-fixtures.mjs';
import { startLocalRuntime } from '../../src/runtime-server.mjs';

test('PDF 标注按侧栏状态先定位再打开，便签、目录和筛选保持联动', { timeout: 90000 }, async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'knowra-pdf-activation-'));
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
  const noDialog = async () => {
    await expect(actions).toHaveCount(0);
    await expect(editor).toHaveCount(0);
  };
  for (const item of fixtures) {
    await blank();
    const top = await reader.evaluate(element => element.scrollTop);
    await hover(item.id);
    await expect(page.getByRole('tooltip')).toContainText(`${item.id} 批注`);
    await click(item.id);
    await noDialog();
    await expect(page.getByRole('tooltip')).toHaveCount(0);
    await expect(overlay(item.id)).toHaveAttribute('data-selected', '');
    await expect(inspector.getByRole('textbox', { name: '评论', exact: true })).toHaveValue(`${item.id} 批注`);
    assert.equal(await reader.evaluate(element => element.scrollTop), top);
    await hover(fixtures.find(other => other.id !== item.id).id);
    await expect(page.getByRole('tooltip')).toHaveCount(0);
    await click(item.id);
    await expect(item.type === 'note' ? editor : actions).toBeVisible();
    await page.keyboard.press('Escape');
    await noDialog();
  }

  // 侧栏选中计入第一次；目录状态则必须先切换并定位。
  await inspector.getByRole('button', { name: /定位标注.*highlight 原文/ }).click();
  await click('highlight');
  await expect(actions).toBeVisible();
  await page.keyboard.press('Escape');
  await click('highlight');
  await page.getByRole('button', { name: '目录', exact: true }).click();
  await click('highlight');
  await noDialog();
  await expect(inspector.getByRole('tab', { name: /标注/ })).toHaveAttribute('aria-selected', 'true');
  await click('highlight');
  await expect(actions).toBeVisible();
  await page.keyboard.press('Escape');

  // 关闭侧栏后四类标注仍一次点击打开，不自动展开侧栏。
  await inspector.getByRole('button', { name: '关闭 PDF 检查器' }).click();
  await expect(inspector).toHaveCount(0);
  for (const item of fixtures) {
    await position(item.id);
    await click(item.id);
    await expect(item.type === 'note' ? editor : actions).toBeVisible();
    await expect(inspector).toHaveCount(0);
    await page.keyboard.press('Escape');
  }

  await page.getByRole('button', { name: '标注', exact: true }).click();
  await position('highlight');
  const search = inspector.getByRole('searchbox', { name: '搜索标注和批注' });
  await search.fill('不匹配');
  await click('highlight');
  await noDialog();
  await expect(inspector.getByLabel('当前选中标注')).toContainText('highlight 原文');
  await expect(search).toHaveValue('不匹配');
  await blank();
  await hover('highlight');
  await expect(page.getByRole('tooltip')).toContainText('highlight 批注');
  // 删除当前标注后也应恢复预览，不能被残留的选中 ID 一直禁用。
  await click('highlight');
  await inspector.getByLabel('当前选中标注').getByRole('button', { name: '删除标注', exact: true }).click();
  await expect(overlay('highlight')).toHaveCount(0);
  await hover('underline');
  await expect(page.getByRole('tooltip')).toContainText('underline 批注');
  await expect(page.getByText('标注已保存', { exact: true })).toBeVisible();
  assert.deepEqual(errors, []);
});
