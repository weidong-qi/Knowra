import { openEditorToolbarMenu } from '../../../../scripts/test-support/editor-menu.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { chromium, expect } from '@playwright/test';
import { createFileDataStore } from '../../../api/src/infrastructure/file-data-store.js';
import { startLocalRuntime } from '../../src/runtime-server.mjs';
import { createAppContext } from '../../../api/src/app.factory.js';
import { createServer } from '../../../api/src/server.js';
import { createV4WebServer } from '../../../web/server/app.mjs';

async function fixture(t, driver, rawMarkdown = '- 父项\n  - 子项\n- 相邻') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'knowra-list-page-'));
  const distRoot = fileURLToPath(new URL('../../../web/dist/', import.meta.url));
  const runtime =
    driver === 'sqlite'
      ? await startLocalRuntime({
          dataDirectory: path.join(root, 'runtime'),
          distRoot,
          syncOptions: { autoSync: false }
        })
      : null;
  const store = runtime?.store ?? createFileDataStore(path.join(root, 'data.json'));
  const app = createAppContext({ dataStore: store, storageRootDir: root }),
    k = app.modules.knowledge;
  const space = k.knowledgeSpaceService.createDefaultKnowledgeSpace({ userId: 'demo' });
  const note = k.noteService.createNote({ spaceId: space.id, title: '列表重点真实页面', rawMarkdown });
  let api, web;
  if (!runtime) {
    api = createServer({ appContext: app });
    api.listen(0, '127.0.0.1');
    await once(api, 'listening');
    web = createV4WebServer({ distRoot, getApiOrigin: () => `http://127.0.0.1:${api.address().port}` });
    web.listen(0, '127.0.0.1');
    await once(web, 'listening');
  }
  const browser = await chromium.launch(),
    page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  t.after(async () => {
    await browser.close();
    if (runtime) await runtime.close();
    else {
      await new Promise(resolve => web.close(resolve));
      await new Promise(resolve => api.close(resolve));
    }
    fs.rmSync(root, { recursive: true, force: true });
    assert.deepEqual(errors, []);
  });
  if (runtime) await page.goto(runtime.launchUrl);
  const origin = runtime?.origin ?? `http://127.0.0.1:${web.address().port}`;
  await page.goto(`${origin}/#/materials/notes/${note.id}`);
  const editor = page.locator('.ProseMirror');
  await expect(editor).toContainText('子项');
  const annotations = () => k.contentAnnotationService.listAnnotationsByNote({ noteId: note.id });
  return { page, editor, k, note, annotations };
}
async function placeCaret(paragraph, end = true) {
  await paragraph.evaluate((element, atEnd) => {
    const range = document.createRange();
    range.selectNodeContents(element);
    range.collapse(!atEnd);
    element.closest('[contenteditable]').focus();
    window.getSelection().removeAllRanges();
    window.getSelection().addRange(range);
    document.dispatchEvent(new Event('selectionchange'));
  }, end);
  // Keyboard transactions synchronise ProseMirror with the DOM caret before a menu takes focus.
  await paragraph.page().keyboard.press(end ? 'ArrowLeft' : 'ArrowRight');
  await paragraph.page().keyboard.press(end ? 'ArrowRight' : 'ArrowLeft');
}
async function mark(page, paragraph) {
  await paragraph.hover();
  await page.getByRole('button', { name: '列表项重点菜单', exact: true }).click();
  await page.getByRole('menuitem', { name: '标记此列表项为重点（包含本项及全部子项）', exact: true }).click();
}

for (const driver of ['json', 'sqlite'])
  test(`真实页面 ${driver}：快捷创建父子列表标记，末尾编辑、撤销重做及重载保持子树`, { timeout: 60000 }, async t => {
    const { page, editor, k, annotations } = await fixture(t, driver);
    await mark(
      page,
      editor
        .locator('p')
        .filter({ hasText: /^父项$/ })
        .first()
    );
    await expect.poll(() => annotations().length).toBe(1);
    const root = annotations()[0];
    assert.equal(root.scopeType, 'list');
    assert.equal(root.quoteText, '父项\n子项');
    assert.equal(root.schemaVersion, 3);
    assert.equal(root.anchor.format, 'knowra-inline');
    assert.ok(root.anchor.markId);
    await mark(
      page,
      editor
        .locator('p')
        .filter({ hasText: /^子项$/ })
        .first()
    );
    await expect.poll(() => annotations().length).toBe(2);
    const child = annotations().find(annotation => annotation.id !== root.id);
    assert.equal(child.quoteText, '子项');
    const current = () => k.contentAnnotationService.getAnnotation(root.id);
    await placeCaret(
      editor
        .locator('p')
        .filter({ hasText: /^父项$/ })
        .first()
    );
    await page.keyboard.insertText('补充');
    await expect.poll(() => current().quoteText).toContain('补充');
    assert.equal(current().anchorStatus, 'resolved');
    await page.keyboard.press('ControlOrMeta+z');
    await expect.poll(() => current().quoteText).not.toContain('补充');
    await page.keyboard.press('ControlOrMeta+Shift+z');
    await expect.poll(() => current().quoteText).toContain('补充');
    await page.reload();
    await expect(editor.locator(`[data-list-annotation="${root.id}"]`)).toContainText('补充');
    assert.doesNotMatch(current().quoteText, /相邻/);
    await page.getByRole('button', { name: '切换文档检查器', exact: true }).click();
    await page.getByRole('tab', { name: '标注', exact: true }).click();
    await page.getByRole('button', { name: /^列表项 2$/ }).click();
    await expect(page.getByRole('button', { name: /^列表项 2$/ })).toHaveAttribute('aria-pressed', 'true');
    if (driver === 'sqlite') await page.screenshot({ path: '/tmp/knowra-list-ui.png', fullPage: true });
  });

test('真实页面：长列表续段滚动后入口仍可操作，窄屏与阅读模式保持边界', { timeout: 60000 }, async t => {
  const raw =
    '- 父项\n\n' +
    Array.from({ length: 25 }, (_, index) => `  续接段落 ${index}：${'长列表内容'.repeat(15)}\n\n`).join('') +
    '  可见续段\n\n  - 子项\n- 相邻';
  const { page, editor, annotations } = await fixture(t, 'json', raw);
  await page.setViewportSize({ width: 700, height: 720 });
  const target = editor.locator('p').filter({ hasText: /^可见续段$/ });
  await target.scrollIntoViewIfNeeded();
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await target.hover();
  await page.screenshot({ path: '/tmp/knowra-list-narrow-ui.png', fullPage: true });
  const targetBounds = await target.boundingBox();
  await page.mouse.move(targetBounds.x + 8, targetBounds.y + targetBounds.height / 2);
  const button = page.getByRole('button', { name: '列表项重点菜单', exact: true });
  await expect(button).toBeVisible();
  const bounds = await button.boundingBox();
  assert.ok(bounds.y >= 0 && bounds.y + bounds.height <= 720);
  await button.click();
  await page.getByRole('menuitem', { name: '标记此列表项为重点（包含本项及全部子项）', exact: true }).click();
  await expect.poll(() => annotations().length).toBe(1);
  assert.match(annotations()[0].quoteText, /续接段落 0/);
  assert.match(annotations()[0].quoteText, /子项/);
  assert.doesNotMatch(annotations()[0].quoteText, /相邻/);
  await openEditorToolbarMenu(page, '视图');
  await page.getByRole('menuitem', { name: '阅读模式', exact: true }).click();
  await expect(editor).toHaveAttribute('contenteditable', 'false');
  await target.hover();
  await expect(page.getByRole('button', { name: '列表项重点菜单', exact: true })).toHaveCount(0);
});
