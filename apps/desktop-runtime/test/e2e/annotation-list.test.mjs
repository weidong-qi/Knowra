import { anchorForListItem, calculateContentHash, projectMarkdown } from '@study-accelerator/content-anchor';
import { openEditorToolbarMenu } from '../../../../scripts/test-support/editor-menu.mjs';
import { withWorkspaceStatus } from './helpers/workspace-status.mjs';
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

async function fixture(t, driver, rawMarkdown = '- 父项\n  - 子项\n- 相邻', legacy = false) {
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
  // 保留旧协议的重试/范围确认验收：一个独立的既有旧重点使该笔记保持 v2 写入模式。
  let legacyId;
  if (legacy) {
    const projection = projectMarkdown(rawMarkdown);
    const anchor = anchorForListItem(projection, projection.listItems.at(-1).path);
    legacyId = k.contentAnnotationService.createAnnotation({
      spaceId: space.id,
      noteId: note.id,
      schemaVersion: 2,
      scopeType: 'list',
      quoteText: anchor.quoteText,
      anchor,
      fromPosition: anchor.sourceStart,
      toPosition: anchor.sourceEnd,
      anchorFingerprint: 'legacy-mode',
      noteContentHash: calculateContentHash(rawMarkdown),
      idempotencyKey: 'legacy-mode'
    }).id;
  }
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
  const annotations = () =>
    k.contentAnnotationService.listAnnotationsByNote({ noteId: note.id }).filter(item => item.id !== legacyId);
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

test('真实页面旧标注模式：已有同级项缩进归入后确认新范围，排除子项与恢复排除可用', { timeout: 60000 }, async t => {
  const { page, editor, k, note, annotations } = await fixture(t, 'json', undefined, true);
  await mark(
    page,
    editor
      .locator('p')
      .filter({ hasText: /^父项$/ })
      .first()
  );
  await expect.poll(() => annotations().length).toBe(1);
  const id = annotations()[0].id,
    current = () => k.contentAnnotationService.getAnnotation(id);
  await placeCaret(
    editor
      .locator('p')
      .filter({ hasText: /^相邻$/ })
      .first()
  );
  await page.keyboard.press('Tab');
  await expect.poll(() => current().anchorStatus).toBe('needsReview');
  await page.getByRole('button', { name: '切换文档检查器', exact: true }).click();
  await page.getByRole('tab', { name: '标注', exact: true }).click();
  await page.getByRole('button', { name: '重点 1 更多操作', exact: true }).click();
  await page.getByRole('menuitem', { name: '预览与编辑', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '重点详情' });
  await expect(dialog).toContainText('相邻');
  await dialog.getByRole('button', { name: '确认新范围', exact: true }).click();
  await expect.poll(() => current().anchorStatus).toBe('resolved');
  assert.match(current().quoteText, /相邻/);
  // 等待确认回执关闭对话框并完成焦点归还，不能仅等服务端落库后操作仍被遮罩的正文。
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('button', { name: '重点 1 更多操作', exact: true })).toBeFocused();
  // Keep a body caret while the inspector menu receives focus.
  await placeCaret(
    editor
      .locator('p')
      .filter({ hasText: /^子项$/ })
      .first()
  );
  await page.getByRole('button', { name: '重点 1 更多操作', exact: true }).click();
  await page.getByRole('menuitem', { name: '排除当前块', exact: true }).click();
  await expect
    .poll(
      () =>
        k.annotationScopeService.previewAnnotation(id).exclusions.filter(exclusion => exclusion.status === 'active')
          .length
    )
    .toBe(1);
  const preview = k.annotationScopeService.previewAnalysisScope({
    spaceId: note.spaceId,
    mode: 'marked',
    annotationIds: [id]
  });
  assert.doesNotMatch(preview.segments.map(segment => segment.markdown).join(''), /子项/);
  await page.getByRole('button', { name: '重点 1 更多操作', exact: true }).click();
  await page.getByRole('menuitem', { name: '预览与编辑', exact: true }).click();
  await page
    .getByRole('dialog', { name: '重点详情' })
    .getByRole('button', { name: /^恢复排除范围/ })
    .click();
  await expect
    .poll(
      () =>
        k.annotationScopeService.previewAnnotation(id).exclusions.filter(exclusion => exclusion.status === 'active')
          .length
    )
    .toBe(0);
});

test('真实页面旧标注模式：创建响应丢失后重试复用幂等键，慢保存期间的新输入保留', { timeout: 60000 }, async t => {
  const { page, editor, k, note, annotations } = await fixture(t, 'json', undefined, true);
  const requests = [];
  let dropped = false;
  await page.route('**/api/knowledge/annotations', async route => {
    if (route.request().method() !== 'POST') return route.continue();
    requests.push(route.request().postDataJSON());
    if (!dropped) {
      dropped = true;
      await route.fetch();
      await route.abort('failed');
    } else await route.continue();
  });
  await mark(
    page,
    editor
      .locator('p')
      .filter({ hasText: /^父项$/ })
      .first()
  );
  await expect.poll(() => annotations().length).toBe(1);
  await withWorkspaceStatus(page, status => expect(status).toContainText('保存失败'));
  await mark(
    page,
    editor
      .locator('p')
      .filter({ hasText: /^父项$/ })
      .first()
  );
  await expect.poll(() => requests.length).toBe(2);
  assert.equal(requests[0].idempotencyKey, requests[1].idempotencyKey);
  assert.equal(annotations().length, 1);
  // 首次丢响应已落库；须等重试回执应用到正文，再开始下一次标记。
  await expect(editor.locator(`[data-list-annotation="${annotations()[0].id}"]`)).toContainText('子项');
  await page.unroute('**/api/knowledge/annotations');
  await placeCaret(
    editor
      .locator('p')
      .filter({ hasText: /^子项$/ })
      .first()
  );
  await page.keyboard.insertText('未保存');
  let release, intercepted;
  const arrived = new Promise(resolve => {
    intercepted = resolve;
  });
  const barrier = new Promise(resolve => {
    release = resolve;
  });
  await page.route(`**/api/knowledge/notes/${note.id}`, async route => {
    if (route.request().method() !== 'PATCH') return route.continue();
    intercepted();
    await barrier;
    await route.continue();
  });
  await mark(
    page,
    editor
      .locator('p')
      .filter({ hasText: /^子项未保存$/ })
      .first()
  );
  await arrived;
  await placeCaret(
    editor
      .locator('p')
      .filter({ hasText: /^子项未保存$/ })
      .first()
  );
  await page.keyboard.insertText('保存中继续');
  release();
  await expect.poll(() => k.noteService.getNote(note.id).rawMarkdown).toContain('保存中继续');
  await expect(editor).toContainText('保存中继续');
  await expect.poll(() => annotations().length).toBe(2);
  assert.equal(annotations().filter(annotation => annotation.quoteText.includes('保存中继续')).length, 2);
  await page.unroute(`**/api/knowledge/notes/${note.id}`);
});

test('真实页面旧标注模式：响应丢失重试期间续输入恢复原幂等请求，不重复创建列表重点', { timeout: 60000 }, async t => {
  const { page, editor, k, note, annotations } = await fixture(t, 'json', undefined, true);
  const requests = [];
  let dropped = false;
  await page.route('**/api/knowledge/annotations', async route => {
    if (route.request().method() !== 'POST') return route.continue();
    requests.push(route.request().postDataJSON());
    if (!dropped) {
      dropped = true;
      await route.fetch();
      await route.abort('failed');
    } else await route.continue();
  });
  const child = editor
    .locator('p')
    .filter({ hasText: /^子项$/ })
    .first();
  await mark(page, child);
  await expect.poll(() => annotations().length).toBe(1);
  await withWorkspaceStatus(page, status => expect(status).toContainText('保存失败'));
  let release, intercepted;
  const arrived = new Promise(resolve => {
    intercepted = resolve;
  });
  const barrier = new Promise(resolve => {
    release = resolve;
  });
  await page.route(`**/api/knowledge/notes/${note.id}`, async route => {
    if (route.request().method() !== 'PATCH') return route.continue();
    intercepted();
    await barrier;
    await route.continue();
  });
  await placeCaret(child);
  await page.keyboard.insertText('临时');
  await page.keyboard.press('ControlOrMeta+z');
  await expect(child).toHaveText('子项');
  await mark(page, child);
  await arrived;
  await placeCaret(child);
  await page.keyboard.insertText('继续');
  release();
  await expect.poll(() => k.noteService.getNote(note.id).rawMarkdown).toContain('子项继续');
  await expect.poll(() => requests.length).toBe(2);
  assert.deepEqual(requests[1], requests[0]);
  assert.equal(annotations().length, 1);
  await expect.poll(() => annotations()[0].quoteText).toBe('子项继续');
  await page.unroute(`**/api/knowledge/notes/${note.id}`);
  await page.unroute('**/api/knowledge/annotations');
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
