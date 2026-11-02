import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';
import { createAttachmentTransfer } from '../../api/src/modules/sync/attachment-transfer.js';
import { createSyncEngine } from '../src/sync-engine.mjs';
import { temporaryDirectory, openWorkspace } from './helpers.mjs';

test('新版同步拒绝格式 5 的服务器，保留本地内容和待发送队列', async t => {
  const root = temporaryDirectory(t),
    workspace = openWorkspace(root);
  workspace.knowledge.noteService.createNote({
    spaceId: workspace.space.id,
    title: '待同步',
    rawMarkdown: '- 父项\n  - 子项'
  });
  const pending = workspace.store.getStatus().pendingOperations;
  const engine = createSyncEngine(workspace.store, {
    autoSync: false,
    entityTransfer: createAttachmentTransfer({ uploadsDir: path.join(root, 'uploads'), storageRootDir: root }),
    fetcher: async () =>
      new Response(JSON.stringify({ data: { protocolVersion: 1, scope: 'notes', entitySchemaVersion: 5 } }))
  });
  t.after(async () => {
    await engine.close();
    workspace.store.close();
  });
  await assert.rejects(engine.configure({ serverUrl: 'http://127.0.0.1:1' }), /同步格式已升级/);
  assert.equal(workspace.store.getStatus().pendingOperations, pending);
  assert.match(workspace.store.state.notes[0].rawMarkdown, /父项/);
});
