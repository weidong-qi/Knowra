import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { chromium, expect } from '@playwright/test';
import { createFileDataStore } from '../../../api/src/infrastructure/file-data-store.js';
import { createAppContext } from '../../../api/src/app.factory.js';
import { createServer } from '../../../api/src/server.js';
import { createV4WebServer } from '../../../web-v4/server/app.mjs';

async function fixture(t, rawMarkdown) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'knowra-code-boundary-'));
  const store = createFileDataStore(path.join(root, 'data.json'));
  const app = createAppContext({ dataStore: store, storageRootDir: root });
  const k = app.modules.knowledge;
  const space = k.knowledgeSpaceService.createDefaultKnowledgeSpace({ userId: 'demo' });
  const note = k.noteService.createNote({ title: '合成重点边界', spaceId: space.id, rawMarkdown });
  const api = createServer({ appContext: app });
  api.listen(0, '127.0.0.1');
  await once(api, 'listening');
  const web = createV4WebServer({
    distRoot: fileURLToPath(new URL('../../../web-v4/dist/', import.meta.url)),
    getApiOrigin: () => `http://127.0.0.1:${api.address().port}`
  });
  web.listen(0, '127.0.0.1');
  await once(web, 'listening');
  const browser = await chromium.launch({ executablePath: process.env.KNOWRA_TEST_BROWSER_EXECUTABLE });
  const page = await browser.newPage(),
    errors = [];
  page.on('pageerror', error => errors.push(error.message));
  t.after(async () => {
    await browser.close();
    await new Promise(resolve => web.close(resolve));
    await new Promise(resolve => api.close(resolve));
    fs.rmSync(root, { recursive: true, force: true });
    assert.deepEqual(errors, []);
  });
  await page.goto(`http://127.0.0.1:${web.address().port}/#/materials/notes/${note.id}`);
  const editor = page.locator('.ProseMirror');
  await expect(editor).toBeVisible();
  await expect(page.locator('[data-editor-ready="true"]')).toBeVisible();
  const annotations = () => k.contentAnnotationService.listAnnotationsByNote({ noteId: note.id });
  return { page, editor, k, note, annotations };
}

const selectCode = (code, collapse) =>
  code.evaluate((el, collapse) => {
    const range = document.createRange();
    range.selectNodeContents(el);
    if (collapse) range.collapse(false);
    el.closest('[contenteditable]').focus();
    window.getSelection().removeAllRanges();
    window.getSelection().addRange(range);
    document.dispatchEvent(new Event('selectionchange'));
  }, collapse);

for (const scope of ['blocks', 'selection'])
  test(`真实代码${scope}：末尾换行后文字即时、保存、重开和撤销重做继承核心颜色`, { timeout: 60000 }, async t => {
    const { page, editor, k, annotations } = await fixture(t, '## 合成章节\n\n```\n原始甲\n原始乙\n```\n\n尾段');
    const code = editor.locator('pre code');
    if (scope === 'blocks') {
      await code.hover();
      await page.getByRole('button', { name: '内容块重点菜单', exact: true }).click();
      await page.getByRole('menuitem', { name: '标记此块为重点', exact: true }).hover();
      await page.getByRole('menuitem', { name: '核心', exact: true }).click();
    } else {
      await selectCode(code, false);
      await page.getByRole('button', { name: '标记重点（核心）', exact: true }).click();
    }
    await expect.poll(() => annotations().length).toBe(1);
    const annotation = annotations()[0];
    await selectCode(code, true);
    await page.keyboard.press('Enter');
    await page.keyboard.insertText('新增行');
    const highlighted = editor.locator(`[data-annotation-id="${annotation.id}"]`);
    await expect.poll(async () => (await highlighted.allTextContents()).join('')).toContain('新增行');
    await expect.poll(async () => (await highlighted.allTextContents()).join('')).toBe(await code.textContent());
    const color = await highlighted.first().evaluate(el => getComputedStyle(el).color);
    assert.ok(color && color !== '');
    await expect(highlighted.first()).toHaveAttribute('data-importance', 'core');
    await expect.poll(() => k.contentAnnotationService.getAnnotation(annotation.id).quoteText).toContain('新增行');
    const saved = k.contentAnnotationService.getAnnotation(annotation.id);
    assert.equal(saved.id, annotation.id);
    assert.equal(saved.importance, 'core');
    await page.keyboard.press('ControlOrMeta+z');
    await expect.poll(() => k.contentAnnotationService.getAnnotation(annotation.id).quoteText).not.toContain('新增行');
    await page.keyboard.press('ControlOrMeta+Shift+z');
    await expect.poll(() => k.contentAnnotationService.getAnnotation(annotation.id).quoteText).toContain('新增行');
    await page.reload();
    await expect.poll(async () => (await highlighted.allTextContents()).join('')).toContain('新增行');
    assert.equal(await highlighted.first().evaluate(el => getComputedStyle(el).color), color);
  });

test('真实选区工具：普通、重点、核心直接创建，重开保留对应等级', { timeout: 60000 }, async t => {
  const { page, editor, annotations } = await fixture(t, '## 合成选区\n\n普通摘录\n\n重点摘录\n\n核心摘录');
  for (const [label, importance] of [
    ['普通', 'normal'],
    ['重点', 'important'],
    ['核心', 'core']
  ]) {
    const paragraph = editor.locator('p').filter({ hasText: label + '摘录' });
    await paragraph.evaluate(el => {
      const range = document.createRange();
      range.selectNodeContents(el);
      el.closest('[contenteditable]').focus();
      window.getSelection().removeAllRanges();
      window.getSelection().addRange(range);
      document.dispatchEvent(new Event('selectionchange'));
    });
    await page.getByRole('button', { name: `标记重点（${label}）`, exact: true }).click();
    await expect.poll(() => annotations().find(item => item.quoteText === label + '摘录')?.importance).toBe(importance);
    // 服务端落库早于 onCreate 完成；等标注与 pending 状态更新后才开始下一次选区。
    await expect(paragraph.locator(`[data-importance="${importance}"]`)).toHaveText(label + '摘录');
    await expect
      .poll(() => page.getByRole('toolbar', { name: '选区工具', exact: true }).locator('button:disabled').count())
      .toBe(0);
  }
  await page.reload();
  assert.deepEqual(
    annotations()
      .map(item => item.importance)
      .sort(),
    ['core', 'important', 'normal']
  );
  await expect(editor.locator('[data-importance="core"]')).toHaveText('核心摘录');
});

test('真实章节：首尾空段与混合结构可创建和重开，同级标题仍是边界', { timeout: 60000 }, async t => {
  const markdown =
    '### 合成章节\n\n<br />\n\n开始\n\n* 甲\n* 乙\n\n> 引用\n\n***\n\n```\n\n代码\n\n```\n\n<br />\n\n### 同级边界\n\n相邻段';
  const { page, editor, annotations } = await fixture(t, markdown);
  await editor.locator('h3').first().hover();
  await page.getByRole('button', { name: '标题重点菜单', exact: true }).click();
  await page.getByRole('menuitem', { name: '标记本节为重点', exact: true }).hover();
  await page.getByRole('menuitem', { name: '重点', exact: true }).click();
  await expect.poll(() => annotations().length).toBe(1);
  const annotation = annotations()[0];
  assert.equal(annotation.importance, 'important');
  assert.equal(annotation.scopeType, 'section');
  assert.ok(!annotation.quoteText.includes('同级边界'));
  await page.reload();
  await expect(editor.locator(`[data-annotation-id="${annotation.id}"]`).first()).toBeVisible();
  await expect(editor.locator('h3').last()).not.toHaveAttribute('data-annotation-id');
});

for (const [label, prefix, index] of [
  ['引用定义省略', '[甲]: https://example.com/a\n\n[乙]: https://example.com/b', 0],
  ['HTML与生产标记规范投影', Array(5).fill('<!-- metadata -->').join('\n\n') + '\n\n==高亮== [[合成链接]]', 1]
])
  test(`真实已保存章节：${label}后重开仍标准确同名同文章节`, { timeout: 60000 }, async t => {
    const markdown = prefix + '\n\n' + Array(3).fill('## 同名\n\n同文').join('\n\n');
    const { page, editor, annotations } = await fixture(t, markdown);
    // 悬停前先滚到位：滚动会收起悬停入口，滚动结束后的移动才会重新显示它。
    await editor.locator('h2').nth(index).scrollIntoViewIfNeeded();
    await editor.locator('h2').nth(index).hover();
    await page.getByRole('button', { name: '标题重点菜单', exact: true }).click();
    await page.getByRole('menuitem', { name: '标记本节为重点', exact: true }).hover();
    await page.getByRole('menuitem', { name: '普通', exact: true }).click();
    await expect.poll(() => annotations().length).toBe(1);
    const selector = `[data-annotation-id="${annotations()[0].id}"]`;
    for (const reload of [false, true]) {
      if (reload) await page.reload();
      for (let heading = 0; heading < 3; heading++) {
        const decoration = editor.locator('h2').nth(heading).locator(selector);
        if (heading === index) await expect(decoration).toBeVisible();
        else await expect(decoration).toHaveCount(0);
      }
    }
  });

test('真实菜单：空行代码块通过悬停子菜单创建指定等级，右键卡片复用取消及撤销', { timeout: 60000 }, async t => {
  const { page, editor, annotations } = await fixture(t, '## 合成标题\n\n```\n\n合成内容\n\n```\n\n尾段');
  await editor.locator('pre code').hover();
  await page.getByRole('button', { name: '内容块重点菜单', exact: true }).click();
  await page.getByRole('menuitem', { name: '标记此块为重点', exact: true }).hover();
  await page.getByRole('menuitem', { name: '核心', exact: true }).click();
  await expect.poll(() => annotations().length).toBe(1);
  assert.equal(annotations()[0].quoteText, '\n合成内容\n');
  assert.equal(annotations()[0].importance, 'core');
  await page.getByRole('button', { name: '切换文档检查器', exact: true }).click();
  await page.getByRole('tab', { name: '标注', exact: true }).click();
  const card = page.locator('[data-annotation-card-id]').first();
  await card.click({ button: 'right' });
  await page.getByRole('menuitem', { name: '取消重点', exact: true }).click();
  await expect.poll(() => annotations().length).toBe(0);
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  await expect.poll(() => annotations().length).toBe(1);
});

test('真实整段代码拖选入口：末尾新增行即时继承并保存重开', { timeout: 60000 }, async t => {
  const { page, editor, annotations } = await fixture(t, '## 合成\n\n```\n甲\n乙\n```');
  const code = editor.locator('pre code');
  await code.evaluate(el => {
    const range = document.createRange();
    range.selectNodeContents(el);
    el.closest('[contenteditable]').focus();
    window.getSelection().removeAllRanges();
    window.getSelection().addRange(range);
    document.dispatchEvent(new Event('selectionchange'));
  });
  await page.getByRole('button', { name: '标记重点（核心）', exact: true }).click();
  await expect.poll(() => annotations().length).toBe(1);
  const id = annotations()[0].id;
  assert.equal(annotations()[0].scopeType, 'selection');
  await code.evaluate(el => {
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    el.closest('[contenteditable]').focus();
    window.getSelection().removeAllRanges();
    window.getSelection().addRange(range);
    document.dispatchEvent(new Event('selectionchange'));
  });
  await page.keyboard.press('Enter');
  await page.keyboard.insertText('新增行');
  const decoration = editor.locator(`[data-annotation-id="${id}"]`);
  await expect.poll(async () => (await decoration.allTextContents()).join('')).toContain('新增行');
  await expect.poll(() => annotations()[0].quoteText).toContain('新增行');
  await page.reload();
  await expect.poll(async () => (await decoration.allTextContents()).join('')).toContain('新增行');
  assert.equal(annotations()[0].id, id);
  assert.equal(annotations()[0].scopeType, 'selection');
});

for (const [level, index, quote] of [
  [3, 1, 'Nested\nInside'],
  [2, 0, 'Parent\nOutside']
])
  test(`真实引用内标题：等级${level}章节${index}创建后范围不扩大并重开`, { timeout: 60000 }, async t => {
    const markdown = '## Parent\n\nOutside\n\n> ' + '#'.repeat(level) + ' Nested\n>\n> Inside\n\n## Next\n\nNext body';
    const { page, editor, annotations } = await fixture(t, markdown);
    await editor.locator('h2,h3').nth(index).hover();
    await page.getByRole('button', { name: '标题重点菜单', exact: true }).click();
    await page.getByRole('menuitem', { name: '标记本节为重点', exact: true }).hover();
    await page.getByRole('menuitem', { name: '普通', exact: true }).click();
    await expect.poll(() => annotations().length).toBe(1);
    assert.equal(annotations()[0].quoteText, quote);
    const decoration = editor.locator(`[data-annotation-id="${annotations()[0].id}"]`);
    await expect.poll(async () => (await decoration.allTextContents()).join('\n')).toBe(quote);
    await page.reload();
    await expect.poll(async () => (await decoration.allTextContents()).join('\n')).toBe(quote);
  });
