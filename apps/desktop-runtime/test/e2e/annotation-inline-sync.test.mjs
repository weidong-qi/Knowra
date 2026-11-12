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
import { createAttachmentTransfer } from '../../../api/src/modules/sync/attachment-transfer.ts';
import { inlineAnnotationId } from '../../../api/src/modules/knowledge/application/inline-annotations.ts';
import { startLocalRuntime } from '../../src/runtime-server.mjs';
import { createSyncEngine } from '../../src/sync-engine.mjs';
import { openWorkspace } from '../helpers.mjs';

async function openFresh(page, url) {
  await page.goto('about:blank');
  await page.goto(url);
}

for (const { trailingNewline, delayedAnnotations } of [
  { trailingNewline: false, delayedAnnotations: false },
  { trailingNewline: true, delayedAnnotations: false },
  { trailingNewline: false, delayedAnnotations: true }
])
  test(
    `真实双设备页面：正文重点随远端替换、编辑和撤销保留（末尾换行=${trailingNewline}，标注迟到=${delayedAnnotations}）`,
    { timeout: 60000 },
    async t => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'knowra-inline-sync-'));
      let runtime, browser, cloud, remote, engine, releaseAnnotations;
      let delayedResponseReady = false;
      t.after(async () => {
        releaseAnnotations?.();
        await browser?.close();
        await runtime?.close();
        await engine?.close();
        remote?.store.close();
        if (cloud) await new Promise(resolve => cloud.close(resolve));
        fs.rmSync(root, { recursive: true, force: true });
      });
      const app = createAppContext({
        dataStore: createFileDataStore(path.join(root, 'cloud.json')),
        storageRootDir: root
      });
      const knowledge = app.modules.knowledge;
      const space = knowledge.knowledgeSpaceService.createDefaultKnowledgeSpace({ userId: 'demo' });
      const rawMarkdown = `## 标题\n\n<mark data-k="sync-source" data-t="key">重要文字</mark>\n\n尾段${trailingNewline ? '\n' : ''}`;
      const note = knowledge.noteService.createNote({ spaceId: space.id, title: '带重点同步', rawMarkdown });
      const annotationId = inlineAnnotationId(note.id, 'sync-source');
      cloud = createServer({ appContext: app });
      cloud.listen(0, '127.0.0.1');
      await once(cloud, 'listening');
      const serverUrl = `http://127.0.0.1:${cloud.address().port}`;
      runtime = await startLocalRuntime({
        dataDirectory: path.join(root, 'local'),
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
      const current = () => read(`/api/knowledge/annotations/${annotationId}`);
      assert.equal((await post('/api/local-runtime/sync/configure', { serverUrl })).error, null);
      const url = `${runtime.origin}/#/materials/notes/${note.id}`;
      await openFresh(page, url);
      const editor = page.getByRole('textbox', { name: '笔记正文' });
      const highlight = editor.locator(`[data-annotation-id="${annotationId}"]`);
      await expect(highlight).toHaveText('重要文字');
      const original = await current();
      await page.waitForResponse(
        response =>
          response.url() === `${runtime.origin}/api/local-runtime/sync` && response.request().method() === 'GET'
      );
      const mountedEditor = await editor.elementHandle();

      const remoteDirectory = path.join(root, 'remote');
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
      const remoteQuote = delayedAnnotations ? '重要远端文字' : '重要文字';
      const after = `${before.rawMarkdown.trimEnd().replace('重要文字', remoteQuote)}\n\n远端追加${trailingNewline ? '\n' : ''}`;
      remote.knowledge.noteService.updateNote(note.id, { expectedUpdatedAt: before.updatedAt, rawMarkdown: after });
      await engine.sync();
      assert.equal(engine.status().error, null);
      const remoteAnnotation = remote.knowledge.contentAnnotationService.getAnnotation(annotationId);
      assert.equal(remoteAnnotation.anchorStatus, 'resolved');
      assert.equal(remoteAnnotation.quoteText, remoteQuote);
      if (delayedAnnotations) {
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
      assert.equal((await read(`/api/knowledge/notes/${note.id}`)).rawMarkdown, after);
      await expect(editor).toContainText('远端追加', { timeout: 15000 });
      if (delayedAnnotations) await expect.poll(() => delayedResponseReady).toBe(true);
      releaseAnnotations?.();
      assert.equal(await mountedEditor.evaluate(element => element.isConnected), true, '远端替换不重建编辑器');
      await expect(highlight).toHaveText(remoteQuote);
      const adopted = await current();
      assert.equal(adopted.schemaVersion, 3);
      assert.deepEqual(adopted.originSnapshot, original.originSnapshot);
      assert.equal(adopted.anchorStatus, 'resolved');

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
      await page.keyboard.press('ControlOrMeta+z');
      await expect.poll(async () => (await current()).quoteText).toBe(remoteQuote);
      await expect(highlight).toHaveText(remoteQuote);
      await expect(editor).toContainText('远端追加');
      await openFresh(page, url);
      await expect(page.locator('[data-editor-ready="true"]')).toBeVisible();
      await expect(highlight).toHaveText(remoteQuote);
      assert.deepEqual((await current()).originSnapshot, original.originSnapshot);
    }
  );
