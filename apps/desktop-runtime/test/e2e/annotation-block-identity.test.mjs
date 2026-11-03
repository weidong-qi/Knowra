import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { once } from 'node:events';
import { chromium, expect } from '@playwright/test';
import { startLocalRuntime } from '../../src/runtime-server.mjs';
import { createSyncEngine } from '../../src/sync-engine.mjs';
import { openWorkspace } from '../helpers.mjs';
import { createAppContext } from '../../../api/src/app.factory.js';
import { createFileDataStore } from '../../../api/src/infrastructure/file-data-store.js';
import { createServer } from '../../../api/src/server.js';
import { createAttachmentTransfer } from '../../../api/src/modules/sync/attachment-transfer.ts';
import {
  anchorFromProjectedRange,
  bindingSourceRange,
  calculateContentHash,
  parseIdentityBlocks,
  projectMarkdown,
  sourceEdits
} from '../../../../packages/content-anchor/src/index.js';

// 同文档 hash 导航后 reload 可能回到旧历史项；需要全新加载时先到 about:blank。
async function openFresh(page, url) {
  await page.goto('about:blank');
  await page.goto(url);
}

test('真实SQLite页面：保存后块身份写入服务端，整页重开沿用同一组块 ID', { timeout: 45000 }, async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'knowra-block-identity-'));
  const runtime = await startLocalRuntime({
    dataDirectory: directory,
    distRoot: fileURLToPath(new URL('../../../web/dist/', import.meta.url))
  });
  const browser = await chromium.launch({ executablePath: process.env.KNOWRA_TEST_BROWSER_EXECUTABLE });
  t.after(async () => {
    await browser.close();
    await runtime.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  const page = await browser.newPage();
  await page.goto(runtime.launchUrl);
  const post = async (pathname, data) => {
    const response = await page.request.post(runtime.origin + pathname, { data });
    assert.equal(response.ok(), true, await response.text());
    return (await response.json()).data;
  };
  const readNote = async id =>
    (await (await page.request.get(`${runtime.origin}/api/knowledge/notes/${id}`)).json()).data;
  const space = await post('/api/knowledge/spaces/default', {});
  const note = await post('/api/knowledge/notes', {
    id: 'block-identity',
    spaceId: space.id,
    title: '块身份',
    rawMarkdown: '## 标题\n\n第一段\n\n第二段'
  });
  const url = `${runtime.origin}/#/materials/notes/${note.id}`;
  const editor = () => page.getByRole('textbox', { name: '笔记正文' });
  const blockIds = () =>
    page.evaluate(() =>
      Array.from(document.querySelectorAll('.ProseMirror [data-block-id]'), element =>
        element.getAttribute('data-block-id')
      )
    );

  await openFresh(page, url);
  await expect(page.locator('[data-editor-ready="true"]')).toBeVisible();
  await editor().getByText('第二段', { exact: true }).click();
  await page.keyboard.press('End');
  await page.keyboard.type('补充');
  // 就绪后编辑器会恢复上次光标位置，输入落在哪个块不影响本用例。
  await expect.poll(async () => (await readNote(note.id)).rawMarkdown).toContain('补充');
  await expect.poll(async () => (await readNote(note.id)).annotationStructure?.identity?.blocks?.length ?? 0).toBe(3);
  const before = await blockIds();
  const identity = (await readNote(note.id)).annotationStructure.identity;
  assert.deepEqual(
    identity.blocks.map(block => block.id),
    before
  );

  await openFresh(page, url);
  await expect(page.locator('[data-editor-ready="true"]')).toBeVisible();
  await expect(editor()).toContainText('补充');
  assert.deepEqual(await blockIds(), before);
});

for (const { trailingNewline, delayedAnnotation } of [
  { trailingNewline: false, delayedAnnotation: false },
  { trailingNewline: true, delayedAnnotation: false },
  { trailingNewline: false, delayedAnnotation: true }
])
  test(
    `真实SQLite页面：带重点的远端整篇替换后编辑与撤销保留快照、修订和可见状态（末尾换行=${trailingNewline}，标注迟到=${delayedAnnotation}）`,
    { timeout: 60000 },
    async t => {
      const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'knowra-identity-sync-'));
      let runtime, browser, cloud, remote, engine, releaseAnnotations;
      let delayedResponseReady = false;
      t.after(async () => {
        releaseAnnotations?.();
        await browser?.close();
        await runtime?.close();
        await engine?.close();
        remote?.store.close();
        if (cloud) await new Promise(resolve => cloud.close(resolve));
        fs.rmSync(directory, { recursive: true, force: true });
      });
      const app = createAppContext({
        dataStore: createFileDataStore(path.join(directory, 'cloud.json')),
        storageRootDir: directory
      });
      const knowledge = app.modules.knowledge;
      const space = knowledge.knowledgeSpaceService.createDefaultKnowledgeSpace({ userId: 'demo' });
      const rawMarkdown = `## 标题\n\n重要文字\n\n尾段${trailingNewline ? '\n' : ''}`;
      const note = knowledge.noteService.createNote({ spaceId: space.id, title: '带重点同步', rawMarkdown });
      const projection = projectMarkdown(rawMarkdown),
        start = projection.text.indexOf('重要文字');
      const anchor = anchorFromProjectedRange(projection, start, start + 4);
      const annotation = knowledge.contentAnnotationService.createAnnotation({
        spaceId: space.id,
        noteId: note.id,
        schemaVersion: 2,
        scopeType: 'selection',
        anchor,
        quoteText: anchor.quoteText,
        fromPosition: anchor.sourceStart,
        toPosition: anchor.sourceEnd,
        noteContentHash: calculateContentHash(rawMarkdown),
        anchorFingerprint: 'identity-sync',
        idempotencyKey: 'identity-sync'
      });
      cloud = createServer({ appContext: app });
      cloud.listen(0, '127.0.0.1');
      await once(cloud, 'listening');
      const serverUrl = `http://127.0.0.1:${cloud.address().port}`;
      runtime = await startLocalRuntime({
        dataDirectory: path.join(directory, 'local'),
        distRoot: fileURLToPath(new URL('../../../web/dist/', import.meta.url)),
        syncOptions: { autoSync: false }
      });
      browser = await chromium.launch({ executablePath: process.env.KNOWRA_TEST_BROWSER_EXECUTABLE });
      const page = await browser.newPage();
      await page.goto(runtime.launchUrl);
      const post = async (pathname, data) => {
        const response = await page.request.post(runtime.origin + pathname, { data });
        assert.equal(response.ok(), true, `合成请求失败：${response.status()}`);
        return (await response.json()).data;
      };
      const read = async pathname => (await (await page.request.get(runtime.origin + pathname)).json()).data;
      const current = () => read(`/api/knowledge/annotations/${annotation.id}`);
      assert.equal((await post('/api/local-runtime/sync/configure', { serverUrl })).error, null);
      await openFresh(page, `${runtime.origin}/#/materials/notes/${note.id}`);
      const editor = page.getByRole('textbox', { name: '笔记正文' });
      const highlight = editor.locator(`[data-annotation-id="${annotation.id}"]`);
      await expect(highlight).toHaveText('重要文字');
      const original = await current();
      // 确保前端已接受初始同步世代，后续世代变化会原位刷新编辑器。
      await page.waitForResponse(
        response =>
          response.url() === `${runtime.origin}/api/local-runtime/sync` && response.request().method() === 'GET'
      );
      const mountedEditor = await editor.elementHandle();

      const remoteDirectory = path.join(directory, 'remote');
      remote = openWorkspace(remoteDirectory);
      engine = createSyncEngine(remote.store, {
        autoSync: false,
        noteService: remote.knowledge.noteService,
        entityTransfer: createAttachmentTransfer({
          uploadsDir: path.join(remoteDirectory, 'uploads'),
          storageRootDir: remoteDirectory
        })
      });
      await engine.configure({ serverUrl });
      const before = remote.knowledge.noteService.getNote(note.id);
      const remoteQuote = delayedAnnotation ? '重要远端文字' : '重要文字';
      const after = `${before.rawMarkdown.trimEnd().replace('重要文字', remoteQuote)}\n\n远端追加${trailingNewline ? '\n' : ''}`;
      remote.knowledge.noteService.updateNote(note.id, {
        expectedUpdatedAt: before.updatedAt,
        rawMarkdown: after,
        annotationMapping: {
          formatVersion: 1,
          operationId: 'remote-identity',
          baseContentHash: calculateContentHash(before.rawMarkdown),
          targetContentHash: calculateContentHash(after),
          edits: sourceEdits(before.rawMarkdown, after),
          editorState: {
            formatVersion: 2,
            targetContentHash: calculateContentHash(after),
            annotations: [],
            blocks: parseIdentityBlocks(after).map((block, index) => ({
              id: `remote-${index}`,
              type: block.type,
              empty: false
            }))
          }
        }
      });
      await engine.sync();
      assert.equal(engine.status().error, null);
      const remoteAnnotation = remote.knowledge.contentAnnotationService.getAnnotation(annotation.id);
      assert.equal(remoteAnnotation.anchorStatus, 'resolved', '有明确来源编辑映射的重点继续由旧链路自动跟随');
      assert.equal(remoteAnnotation.quoteText, remoteQuote);
      if (delayedAnnotation) {
        const gate = new Promise(resolve => {
          releaseAnnotations = resolve;
        });
        await page.route('**/api/knowledge/annotations?*', async route => {
          const response = await route.fetch();
          delayedResponseReady = true;
          await gate;
          await route.fulfill({ response });
        });
      }
      assert.equal((await post('/api/local-runtime/sync/retry', {})).error, null);
      await page.evaluate(() => window.dispatchEvent(new Event('focus')));
      assert.equal((await read(`/api/knowledge/notes/${note.id}`)).rawMarkdown, after, '接收设备已持久化远端正文');
      await expect(editor).toContainText('远端追加', { timeout: 15000 });
      if (delayedAnnotation) await expect.poll(() => delayedResponseReady).toBe(true);
      releaseAnnotations?.();
      assert.equal(await mountedEditor.evaluate(element => element.isConnected), true, '原位整篇替换，不重建编辑器');
      await expect(highlight).toHaveText(remoteQuote);
      await expect
        .poll(() =>
          editor
            .locator('[data-block-id]')
            .evaluateAll(elements => elements.map(element => element.getAttribute('data-block-id')))
        )
        .toEqual(parseIdentityBlocks(after).map((_, index) => `remote-${index}`));
      const adopted = await current();
      assert.equal(adopted.revision, remoteAnnotation.revision, '身份回填不创建重点修订');
      assert.deepEqual(adopted.originSnapshot, original.originSnapshot);
      assert.equal(adopted.anchorStatus, 'resolved');
      assert.equal(adopted.lifecycleStatus, 'active');
      const assertBinding = async annotation => {
        const savedNote = await read(`/api/knowledge/notes/${note.id}`);
        assert.equal(annotation.identityBinding.contentHash, calculateContentHash(savedNote.rawMarkdown));
        const range = bindingSourceRange(
          savedNote.rawMarkdown,
          savedNote.annotationStructure.identity,
          annotation.identityBinding
        );
        assert.ok(range);
        assert.equal(savedNote.rawMarkdown.slice(range.sourceStart, range.sourceEnd), annotation.quoteText);
      };
      assert.equal(adopted.identityBinding.start.blockId, 'remote-1');
      await assertBinding(adopted);

      await highlight.evaluate(element => {
        const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT),
          node = walker.nextNode();
        const range = document.createRange();
        range.setStart(node, 1);
        range.collapse(true);
        element.closest('[contenteditable]').focus();
        window.getSelection().removeAllRanges();
        window.getSelection().addRange(range);
        document.dispatchEvent(new Event('selectionchange'));
      });
      await page.keyboard.insertText('新增');
      const editedQuote = `${remoteQuote.slice(0, 1)}新增${remoteQuote.slice(1)}`;
      await expect.poll(async () => (await current()).quoteText).toBe(editedQuote);
      await expect(highlight).toHaveText(editedQuote);
      const edited = await current();
      assert.equal(edited.revision, adopted.revision + 1);
      await assertBinding(edited);
      assert.equal(edited.anchorStatus, 'resolved');
      assert.deepEqual(edited.originSnapshot, original.originSnapshot);
      await page.keyboard.press('ControlOrMeta+z');
      await expect.poll(async () => (await current()).quoteText).toBe(remoteQuote);
      await expect(highlight).toHaveText(remoteQuote);
      const undone = await current();
      assert.equal(undone.revision, edited.revision + 1);
      assert.equal(undone.anchorStatus, 'resolved');
      assert.deepEqual(undone.originSnapshot, original.originSnapshot);
      await expect(editor).toContainText('远端追加');
      await assertBinding(undone);
      await openFresh(page, `${runtime.origin}/#/materials/notes/${note.id}`);
      await expect(page.locator('[data-editor-ready="true"]')).toBeVisible();
      await expect(highlight).toHaveText(remoteQuote);
      const reopened = await current();
      assert.deepEqual(reopened.identityBinding, undone.identityBinding);
      assert.equal(reopened.revision, undone.revision);
      assert.deepEqual(reopened.originSnapshot, original.originSnapshot);
    }
  );
