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
import { createV4WebServer } from '../../../web/server/app.mjs';
import {
  projectMarkdown,
  anchorForSection,
  anchorForBlock,
  anchorFromProjectedRange,
  calculateContentHash
} from '../../../../packages/content-anchor/src/index.js';

async function fixture(t, scope) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'knowra-annotation-ui-'));
  const store = createFileDataStore(path.join(root, 'data.json'));
  const app = createAppContext({ dataStore: store, storageRootDir: root });
  const k = app.modules.knowledge;
  const space = k.knowledgeSpaceService.createDefaultKnowledgeSpace({ userId: 'demo' });
  const raw = '# A\n\n重要文字\n\n# B\n\n尾段';
  const note = k.noteService.createNote({ title: '动态跟随验收', spaceId: space.id, rawMarkdown: raw });
  const p = projectMarkdown(raw);
  const anchor =
    scope === 'section'
      ? anchorForSection(p, 0)
      : scope === 'blocks'
        ? anchorForBlock(p, 1)
        : anchorFromProjectedRange(p, p.text.indexOf('重要文字'), p.text.indexOf('重要文字') + 4);
  const annotation = k.contentAnnotationService.createAnnotation({
    spaceId: space.id,
    noteId: note.id,
    schemaVersion: 2,
    scopeType: scope,
    quoteText: anchor.quoteText,
    anchor,
    fromPosition: anchor.sourceStart,
    toPosition: anchor.sourceEnd,
    anchorFingerprint: 'e2e',
    noteContentHash: calculateContentHash(raw),
    idempotencyKey: 'e2e'
  });
  const server = createServer({ appContext: app });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const web = createV4WebServer({
    distRoot: fileURLToPath(new URL('../../../web/dist/', import.meta.url)),
    getApiOrigin: () => `http://127.0.0.1:${server.address().port}`
  });
  web.listen(0, '127.0.0.1');
  await once(web, 'listening');
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errors = [];
  page.on('request', request => {
    if (process.env.KNOWRA_DEBUG_ANNOTATIONS && request.method() === 'PATCH') console.log(request.postData());
  });
  page.on('pageerror', e => errors.push(e.message));
  t.after(async () => {
    await browser.close();
    await new Promise(resolve => web.close(resolve));
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(root, { recursive: true, force: true });
    assert.deepEqual(errors, []);
  });
  await page.addInitScript(() => {
    document.addEventListener('cut', event => {
      window.__testMoveToken = event.clipboardData?.getData('application/x-knowra-move');
    });
    document.addEventListener('copy', () => {
      window.__testMoveToken = '';
    });
  });
  await page.goto(`http://127.0.0.1:${web.address().port}/#/materials/notes/${note.id}`);
  const editor = page.locator('.ProseMirror');
  await expect(editor).toContainText('重要文字');
  const current = () => k.contentAnnotationService.getAnnotation(annotation.id);
  return { page, editor, k, note, annotation, current };
}
for (const scope of ['selection', 'blocks', 'section'])
  test(`真实页面：${scope} 编辑中、保存、重载和撤销重做保持重点`, { timeout: 60000 }, async t => {
    const { page, editor, current, annotation } = await fixture(t, scope);
    const paragraph = editor.locator('p').filter({ hasText: '重要文字' }).first();
    await expect(editor.locator(`[data-annotation-id="${annotation.id}"]`).first()).toBeVisible();
    // Annotation decoration wraps text; select using the actual text node.
    await paragraph.evaluate(el => {
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      const node = walker.nextNode();
      const range = document.createRange();
      range.setStart(node, 1);
      range.collapse(true);
      el.closest('[contenteditable]').focus();
      window.getSelection().removeAllRanges();
      window.getSelection().addRange(range);
      document.dispatchEvent(new Event('selectionchange'));
    });
    await page.keyboard.insertText('新增');
    await expect
      .poll(async () => (await editor.locator(`[data-annotation-id="${annotation.id}"]`).allTextContents()).join(''))
      .toContain('新增');
    await expect.poll(() => current().quoteText).toContain('新增');
    assert.equal(current().anchorStatus, 'resolved');
    await page.keyboard.press('ControlOrMeta+z');
    await expect.poll(() => current().quoteText).not.toContain('新增');
    assert.equal(current().anchorStatus, 'resolved');
    await page.keyboard.press('ControlOrMeta+Shift+z');
    await expect.poll(() => current().quoteText).toContain('新增');
    await page.reload();
    await expect
      .poll(async () => (await editor.locator(`[data-annotation-id="${annotation.id}"]`).allTextContents()).join(''))
      .toContain('新增');
  });
test('真实页面：空块保留并在重载后重新输入继承重点', { timeout: 60000 }, async t => {
  const { page, editor, current, annotation, k, note } = await fixture(t, 'blocks');
  const paragraph = editor.locator('p').filter({ hasText: '重要文字' }).first();
  await paragraph.evaluate(el => {
    const range = document.createRange();
    range.selectNodeContents(el);
    el.closest('[contenteditable]').focus();
    window.getSelection().removeAllRanges();
    window.getSelection().addRange(range);
    document.dispatchEvent(new Event('selectionchange'));
  });
  await page.keyboard.press('Backspace');
  await expect.poll(() => current().quoteText).toBe('');
  assert.equal(current().anchorStatus, 'resolved');
  await page.reload();
  const empty = editor.locator(`[data-annotation-id="${annotation.id}"]`).first();
  await expect(empty).toBeVisible();
  await empty.click();
  await page.keyboard.insertText('重新补充');
  await expect.poll(() => current().quoteText).toBe('重新补充');
  assert.equal(current().scopeType, 'blocks');
});
test('真实页面：章节边界变化通过旧新预览确认并保留标注身份', { timeout: 60000 }, async t => {
  const { page, editor, current, annotation } = await fixture(t, 'section');
  const boundary = editor.locator('h1').filter({ hasText: 'B' });
  await boundary.click();
  await page.getByRole('button', { name: '二级标题', exact: true }).click();
  await expect.poll(() => current().anchorStatus).toBe('needsReview');
  await page.getByRole('button', { name: '切换文档检查器', exact: true }).click();
  await page.getByRole('tab', { name: '标注', exact: true }).click();
  await page.getByRole('button', { name: '重点 1 更多操作', exact: true }).click();
  await page.getByRole('menuitem', { name: '预览与编辑', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '重点详情' });
  await expect(dialog).toContainText('尾段');
  await dialog.getByRole('button', { name: '确认新范围', exact: true }).click();
  await expect.poll(() => current().anchorStatus).toBe('resolved');
  assert.equal(current().id, annotation.id);
  assert.match(current().quoteText, /尾段/);
});
test('真实页面：选区完整删除后跨保存撤销恢复原标注', { timeout: 60000 }, async t => {
  const { page, editor, current, annotation } = await fixture(t, 'selection');
  const paragraph = editor.locator('p').filter({ hasText: '重要文字' }).first();
  await paragraph.evaluate(el => {
    const range = document.createRange();
    range.selectNodeContents(el);
    el.closest('[contenteditable]').focus();
    window.getSelection().removeAllRanges();
    window.getSelection().addRange(range);
    document.dispatchEvent(new Event('selectionchange'));
  });
  await page.keyboard.press('Backspace');
  await expect.poll(() => current().anchorStatus).toBe('missing');
  await page.keyboard.press('ControlOrMeta+z');
  await expect.poll(() => current().anchorStatus).toBe('resolved');
  assert.equal(current().quoteText, '重要文字');
  await page.reload();
  await expect(editor.locator(`[data-annotation-id="${annotation.id}"]`)).toContainText('重要文字');
});
test('真实页面：同笔记剪切粘贴跟随重点，复制不重复继承', { timeout: 60000 }, async t => {
  const { page, editor, current, annotation, k, note } = await fixture(t, 'blocks');
  const paragraph = editor.locator('p').filter({ hasText: '重要文字' }).first();
  await paragraph.evaluate(el => {
    const range = document.createRange();
    range.selectNodeContents(el);
    el.closest('[contenteditable]').focus();
    window.getSelection().removeAllRanges();
    window.getSelection().addRange(range);
    document.dispatchEvent(new Event('selectionchange'));
  });
  await page.keyboard.press('ControlOrMeta+x');
  await expect.poll(() => current().anchorStatus).toBe('missing');
  await editor.locator('p').filter({ hasText: '尾段' }).click();
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await editor.evaluate(el => {
    const data = new DataTransfer();
    data.setData('text/plain', '重要文字');
    data.setData('application/x-knowra-move', window.__testMoveToken || '');
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  });
  await expect.poll(() => current().anchorStatus).toBe('resolved');
  assert.equal(current().quoteText, '重要文字');
  await page.reload();
  await expect(editor.locator(`[data-annotation-id="${annotation.id}"]`)).toHaveCount(1);
  const originalPosition = current().fromPosition;
  const moved = editor.locator(`[data-annotation-id="${annotation.id}"]`);
  await moved.evaluate(el => {
    const range = document.createRange();
    range.selectNodeContents(el);
    el.closest('[contenteditable]').focus();
    window.getSelection().removeAllRanges();
    window.getSelection().addRange(range);
    document.dispatchEvent(new Event('selectionchange'));
  });
  await page.keyboard.press('ControlOrMeta+c');
  // 各平台的 ArrowRight/End 在装饰节点选区后落点不同；明确把光标放在原段落末尾。
  await moved.evaluate(el => {
    const paragraph = el.closest('p');
    const range = document.createRange();
    range.selectNodeContents(paragraph);
    range.collapse(false);
    el.closest('[contenteditable]').focus();
    window.getSelection().removeAllRanges();
    window.getSelection().addRange(range);
    document.dispatchEvent(new Event('selectionchange'));
  });
  await page.keyboard.press('Enter');
  await editor.evaluate(el => {
    const data = new DataTransfer();
    data.setData('text/plain', '重要文字');
    data.setData('application/x-knowra-move', window.__testMoveToken || '');
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  });
  await expect(editor.locator('p').filter({ hasText: '重要文字' })).toHaveCount(2);
  await expect.poll(() => k.noteService.getNote(note.id).rawMarkdown.split('重要文字').length).toBe(3);
  await expect.poll(() => current().fromPosition).toBe(originalPosition);
  await page.reload();
  await expect(editor.locator(`[data-annotation-id="${annotation.id}"]`)).toHaveCount(1);
});
