import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { chromium, expect } from '@playwright/test';
import { startLocalRuntime } from '../../src/runtime-server.mjs';

test('真实页面创建、筛选和编辑自定义标签色，明暗主题与手机布局均可操作', { timeout: 60000 }, async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'knowra-tag-colors-e2e-'));
  const evidence = process.env.KNOWRA_TAG_COLOR_EVIDENCE_DIR;
  if (evidence) fs.mkdirSync(evidence, { recursive: true });
  const runtime = await startLocalRuntime({
    dataDirectory: root,
    distRoot: fileURLToPath(new URL('../../../web/dist/', import.meta.url))
  });
  t.after(async () => {
    await runtime.close();
    fs.rmSync(root, { recursive: true, force: true });
  });
  const browser = await chromium.launch({
    ...(process.env.V4_BROWSER_CHANNEL === 'chrome' ? { channel: 'chrome' } : {})
  });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const problems = [];
  page.on('pageerror', error => problems.push(error.message));
  await page.goto(runtime.launchUrl);
  await page.goto(`${runtime.origin}/#/materials`);
  await page.getByRole('button', { name: '新建标签', exact: true }).click();
  const quick = page.getByRole('dialog', { name: '新建标签', exact: true });
  await quick.getByRole('textbox', { name: '标签名称' }).fill('侧栏自定义');
  await quick.getByRole('textbox', { name: '十六进制颜色' }).fill('#fff');
  await expect(quick.getByRole('button', { name: '创建标签' })).toBeDisabled();
  await quick.getByLabel('自定义颜色调色盘').fill('#12abef');
  await expect(quick.getByRole('textbox', { name: '十六进制颜色' })).toHaveValue('#12abef');
  await quick.getByRole('textbox', { name: '十六进制颜色' }).fill('#3C68FF');
  if (evidence) await page.screenshot({ path: path.join(evidence, 'sidebar-light.png'), animations: 'disabled' });
  await quick.getByRole('button', { name: '创建标签' }).click();
  await expect(quick).toBeHidden();
  const storedTag = () => runtime.store.state.tags.find(tag => tag.name === '侧栏自定义');
  assert.equal(storedTag().color, '#3c68ff');
  await page.reload();
  const sidebarChip = page.getByRole('button', { name: '侧栏自定义', exact: true });
  await expect(sidebarChip).toHaveCSS('--tag-color', '#3c68ff');
  await page.getByRole('button', { name: '筛选', exact: true }).click();
  await page.getByRole('menuitem', { name: '标签', exact: true }).click();
  const filterDot = page.getByRole('menuitemcheckbox', { name: /侧栏自定义/ }).locator('i');
  await expect(filterDot).toHaveCSS('background-color', 'rgb(60, 104, 255)');
  await page.keyboard.press('Escape');
  const noteResponse = await page.request.post(`${runtime.origin}/api/knowledge/notes`, {
    data: { spaceId: storedTag().spaceId, title: '颜色验收笔记', rawMarkdown: '验证笔记标签颜色' }
  });
  assert.equal(noteResponse.status(), 201);
  const note = (await noteResponse.json()).data;
  await page.goto(`${runtime.origin}/#/materials/notes/${note.id}`);
  await page.reload();
  await expect(page.getByRole('heading', { name: '颜色验收笔记', exact: true })).toBeVisible();
  const inspectorToggle = page
    .getByRole('button', { name: /^(切换|打开)文档检查器$/ })
    .filter({ visible: true })
    .first();
  if ((await inspectorToggle.getAttribute('aria-pressed')) !== 'true') await inspectorToggle.click();
  await page
    .getByRole('complementary', { name: '文档检查器' })
    .getByRole('button', { name: '添加', exact: true })
    .click();
  await page
    .getByRole('dialog', { name: '编辑笔记标签' })
    .getByRole('button', { name: '新建标签', exact: true })
    .click();
  const noteForm = page.getByRole('dialog', { name: '新建标签', exact: true });
  await noteForm.getByRole('textbox', { name: '标签名称' }).fill('笔记自定义');
  await noteForm.getByRole('textbox', { name: '十六进制颜色' }).fill('#1764C0');
  if (evidence) await page.screenshot({ path: path.join(evidence, 'note-light.png'), animations: 'disabled' });
  await noteForm.getByRole('button', { name: '创建并添加' }).click();
  await page.getByRole('button', { name: '保存到笔记' }).click();
  const noteTag = runtime.store.state.tags.find(tag => tag.name === '笔记自定义');
  assert.equal(noteTag.color, '#1764c0');
  await expect.poll(() => runtime.store.state.notes.find(item => item.id === note.id).tagIds).toContain(noteTag.id);
  await page.goto(`${runtime.origin}/#/materials/tags`);
  for (const [mode, width, color] of [
    ['light', 1440, '#ffffff'],
    ['dark', 1440, '#000000'],
    ['dark', 390, '#ab12ef']
  ]) {
    await page.evaluate(
      mode => localStorage.setItem('knowra:notes-index-appearance:v1', JSON.stringify({ mode })),
      mode
    );
    await page.setViewportSize({ width, height: width < 500 ? 844 : 1000 });
    await page.reload();
    const card = page.getByRole('article').filter({ hasText: '侧栏自定义' });
    await card.getByRole('button', { name: /的更多操作/ }).click();
    await page.getByRole('menuitem', { name: '编辑', exact: true }).click();
    const edit = page.getByRole('dialog', { name: '编辑标签' });
    await expect(edit.getByRole('textbox', { name: '十六进制颜色' })).toHaveValue(storedTag().color);
    await edit.getByRole('textbox', { name: '十六进制颜色' }).fill(color);
    const preview = edit.getByLabel('颜色预览').locator('[data-color]');
    await expect(preview).toHaveCSS('--tag-color', color);
    const previewBox = await preview.boundingBox();
    assert(previewBox.width > 0 && previewBox.x >= 0 && previewBox.x + previewBox.width <= width);
    const save = edit.getByRole('button', { name: '保存', exact: true });
    await expect(save).toBeInViewport();
    if (evidence)
      await page.screenshot({ path: path.join(evidence, `manager-${mode}-${width}.png`), animations: 'disabled' });
    await save.click();
    await expect(edit).toBeHidden();
    assert.equal(storedTag().color, color);
  }
  assert.deepEqual(problems, []);
});
