import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { chromium, expect } from '@playwright/test';
import { syntheticPdf } from '../../../../scripts/test-support/pdf-fixtures.mjs';
import { startLocalRuntime } from '../../src/runtime-server.mjs';

test('PDF 便签单次创建、区域页面编辑和双击查词同时标注', { timeout: 90000 }, async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'knowra-pdf-annotation-interactions-'));
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
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } }),
    errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(runtime.launchUrl);
  const api = async (url, method = 'GET', data) => {
    const response = await page.request.fetch(`${runtime.origin}${url}`, { method, ...(data ? { data } : {}) });
    assert(response.ok(), await response.text());
    return (await response.json()).data;
  };
  const space = await api('/api/knowledge/spaces/default', 'POST', {});
  const params = new URLSearchParams({
    operationId: 'pdf-interaction-fixes',
    spaceId: space.id,
    fileName: '交互验收.pdf'
  });
  const response = await page.request.post(`${runtime.origin}/api/storage/pdf-imports?${params}`, {
    headers: { 'Content-Type': 'application/pdf' },
    data: syntheticPdf({ pages: [{ text: 'Gradients and consistency', width: 420, height: 595 }] })
  });
  assert.equal(response.status(), 201);
  const note = (await response.json()).data;
  await page.reload();
  await page.goto(`${runtime.origin}/#/materials/notes/${note.id}`);
  await expect(page.locator('.textLayer')).toContainText('Gradients', { timeout: 25000 });
  const reader = page.getByLabel('PDF 页面', { exact: true }),
    canvas = page.locator('.canvasWrapper').first();
  const marks = () => api(`/api/pdf/${note.id}/annotations`);
  const save = () => expect(page.getByText('标注已保存', { exact: true })).toBeVisible();
  const point = async (x, y) => {
    const b = await canvas.boundingBox();
    return { x: b.x + x, y: b.y + y };
  };
  const click = async (x, y) => {
    const p = await point(x, y);
    await page.mouse.click(p.x, p.y);
  };

  await page.getByRole('button', { name: '便签工具', exact: true }).click();
  await click(400, 160);
  await page.getByRole('button', { name: '标注为疑问', exact: true }).click();
  await expect(page.getByRole('button', { name: '文字选择', exact: true })).toHaveAttribute('aria-pressed', 'true');
  const noteEditor = page.getByRole('dialog', { name: '编辑 PDF 批注' });
  await expect(noteEditor).toBeVisible();
  await noteEditor.getByRole('textbox', { name: '便签标题', exact: true }).fill('我的待验证猜想');
  await noteEditor.getByRole('textbox', { name: '批注内容', exact: true }).fill('只创建一条便签');
  await noteEditor.getByRole('button', { name: '完成', exact: true }).click();
  await save();
  const sticky = (await marks()).find(mark => mark.type === 'note');
  assert.equal(sticky.title, '我的待验证猜想');
  const icon = page.locator(`[data-note-id="${sticky.id}"]`);
  await icon.click();
  await expect(noteEditor.getByRole('textbox', { name: '便签标题' })).toHaveValue('我的待验证猜想');
  await noteEditor.getByRole('textbox', { name: '便签标题' }).fill('重新命名的猜想');
  await noteEditor.getByRole('button', { name: '完成', exact: true }).click();
  await save();
  // 图标仍可拖动；拖动完成不重复创建便签，标题与正文保留。
  const iconBox = await icon.boundingBox();
  await page.mouse.move(iconBox.x + iconBox.width / 2, iconBox.y + iconBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(iconBox.x + iconBox.width / 2 - 60, iconBox.y + iconBox.height / 2 + 40, { steps: 8 });
  await page.mouse.up();
  await save();
  const movedSticky = (await marks()).find(mark => mark.id === sticky.id);
  assert.notDeepEqual(movedSticky.segments, sticky.segments);
  assert.equal(movedSticky.title, '重新命名的猜想');
  assert.equal(movedSticky.comment, '只创建一条便签');
  await click(450, 360);
  await expect(page.getByRole('toolbar', { name: '选择标注分类' })).toHaveCount(0);
  assert.equal((await marks()).length, 1, '后续空白点击不创建第二条便签');

  await page.getByRole('button', { name: '区域框选', exact: true }).click();
  const start = await point(100, 220),
    end = await point(300, 300);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 8 });
  await page.mouse.up();
  await page.getByRole('button', { name: '标注为重点', exact: true }).click();
  await save();
  const region = (await marks()).find(mark => mark.type === 'region');
  assert(region);
  const clickRegion = async () => {
    const b = await page.locator(`[data-pdf-annotation-id="${region.id}"]`).boundingBox();
    await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
    await expect(page.getByRole('dialog', { name: 'PDF 标注操作' })).toBeVisible();
  };
  // 保持区域工具时，单击编辑已有区域，拖动仍创建新区域。
  await clickRegion();
  await page.getByRole('button', { name: '改为易错', exact: true }).click();
  await save();
  assert.equal((await marks()).find(mark => mark.id === region.id).kind, 'pitfall');
  await page.getByRole('button', { name: '文字选择', exact: true }).click();
  await clickRegion();
  await page.getByRole('button', { name: '添加批注', exact: true }).click();
  await page
    .getByRole('dialog', { name: '编辑 PDF 批注' })
    .getByRole('textbox', { name: '批注内容' })
    .fill('页面直接编辑区域');
  await page.getByRole('button', { name: '完成', exact: true }).click();
  await save();
  assert.equal((await marks()).find(mark => mark.id === region.id).comment, '页面直接编辑区域');
  await clickRegion();
  await page.getByRole('dialog', { name: 'PDF 标注操作' }).getByRole('button', { name: '删除', exact: true }).click();
  await save();
  assert.equal(
    (await marks()).some(mark => mark.id === region.id),
    false
  );

  const openWord = async () => {
    const p = await page.locator('.textLayer').evaluate(layer => {
      const span = [...layer.querySelectorAll('span')].find(el => el.textContent.includes('Gradients'));
      const range = document.createRange();
      const start = span.textContent.indexOf('Gradients');
      range.setStart(span.firstChild, start);
      range.setEnd(span.firstChild, start + 9);
      const b = range.getBoundingClientRect();
      return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
    });
    await page.mouse.dblclick(p.x, p.y, { delay: 70 });
    await expect(page.getByRole('dialog', { name: 'PDF 查词' })).toBeVisible();
  };
  await openWord();
  const lookup = page.getByRole('dialog', { name: 'PDF 查词' });
  await expect(lookup).toContainText('梯度');
  await expect(lookup.getByRole('toolbar', { name: '选择标注分类' })).toBeVisible();
  await lookup.getByRole('button', { name: '标注样式：下划线', exact: true }).click();
  await lookup.getByRole('button', { name: '选择分类：重点', exact: true }).click();
  await expect(lookup).toBeVisible();
  await expect(lookup).toContainText('梯度');
  assert.equal((await marks()).length, 1, '选择样式和颜色不会创建标注');
  await lookup.getByRole('button', { name: '关闭', exact: true }).click();
  await expect(lookup).toHaveCount(0);
  assert.equal((await marks()).length, 1, '关闭查词卡片不会提交标注设置');
  await openWord();
  await expect(lookup.getByRole('button', { name: '选择分类：重点' })).toHaveAttribute('aria-pressed', 'true');
  await expect(lookup.getByRole('button', { name: '标注样式：下划线' })).toHaveAttribute('aria-pressed', 'true');
  if (process.env.KNOWRA_E2E_OUTPUT) {
    fs.mkdirSync(process.env.KNOWRA_E2E_OUTPUT, { recursive: true });
    await page.screenshot({ path: path.join(process.env.KNOWRA_E2E_OUTPUT, 'pdf-dictionary-and-annotation.png') });
  }
  await lookup.getByRole('button', { name: '仅标注原文', exact: true }).click();
  await expect(lookup).toHaveCount(0);
  await save();
  const wordMark = (await marks()).find(mark => mark.quoteText === 'Gradients');
  assert.equal(wordMark.type, 'underline');
  assert.equal(wordMark.kind, 'important');
  assert.equal(wordMark.comment, '', '仅标注原文不写入词典释义');
  // 双击已有标注仍可查词，同时可按原入口保存释义。
  await openWord();
  await expect(lookup).toContainText('梯度');
  await expect(lookup.getByRole('toolbar', { name: '选择标注分类' })).toBeVisible();
  await expect(lookup.getByRole('button', { name: '选择分类：重点' })).toHaveAttribute('aria-pressed', 'true');
  await expect(lookup.getByRole('button', { name: '标注样式：下划线' })).toHaveAttribute('aria-pressed', 'true');
  await lookup.getByRole('button', { name: '选择分类：疑问' }).click();
  await lookup.getByRole('button', { name: '标注并保存释义', exact: true }).click();
  await save();
  assert((await marks()).some(mark => mark.quoteText === 'Gradients' && mark.comment.includes('词典 · ECDICT')));
  assert((await marks()).some(mark => mark.kind === 'question' && mark.comment.includes('词典 · ECDICT')));
  // 相同释义改用另一分类时保留两条标注，同分类重复提交则定位已有记录。
  await openWord();
  await lookup.getByRole('button', { name: '选择分类：重点' }).click();
  await lookup.getByRole('button', { name: '标注并保存释义', exact: true }).click();
  await save();
  assert.equal((await marks()).length, 4);
  assert((await marks()).some(mark => mark.kind === 'important' && mark.comment.includes('词典 · ECDICT')));
  await openWord();
  await lookup.getByRole('button', { name: '标注并保存释义', exact: true }).click();
  await expect(lookup).toHaveCount(0);
  assert.equal((await marks()).length, 4);
  await page.reload();
  await expect(page.locator('.textLayer')).toContainText('Gradients');
  assert.equal((await marks()).find(mark => mark.id === sticky.id).title, '重新命名的猜想');
  await expect(page.getByRole('button', { name: /定位标注.*重新命名的猜想/ })).toBeVisible();
  assert.equal((await marks()).filter(mark => mark.type === 'note').length, 1);
  assert.equal((await marks()).filter(mark => mark.type === 'region').length, 0);
  await expect(reader).toBeVisible();
  assert.deepEqual(errors, []);
});
