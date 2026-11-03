import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import sharp from 'sharp';
import { createSqliteDataStore } from '../src/sqlite-data-store.mjs';
import { createRuntimeBackup, inspectRuntimeBackup, listRuntimeBackups, restoreRuntimeBackup } from '../src/backup.mjs';
import { prepareRestoredDirectory } from '../src/restore-directory.mjs';
import { createTaskWorkspaceFiles } from '../src/task-workspaces/files.mjs';
import { createTaskWorkspaceService } from '../../api/src/modules/task-workspaces/service.ts';

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'knowra-task-backup-'));
  const store = createSqliteDataStore(path.join(root, 'local.sqlite'));
  t.after(() => {
    try {
      store.close();
    } catch {}
    fs.rmSync(root, { recursive: true, force: true });
  });
  const files = createTaskWorkspaceFiles({ uploadsDirectory: path.join(root, 'uploads') });
  const service = createTaskWorkspaceService({ store: store.taskWorkspaceStore, files, authorize: () => true });
  const ctx = {
    ...store.taskWorkspaceStore.identity(),
    actor: { kind: 'user', id: 'synthetic-user' },
    guard: () => true
  };
  return { root, store, files, service, ctx };
}

test('完整备份/恢复重启保留任务图片，换dataset/epoch且不改普通笔记同步', async t => {
  const f = fixture(t);
  const workspace = f.service.createWorkspace(f.ctx, { operationId: randomUUID(), name: '合成工作区' }).data.workspace;
  let document = f.service.createDocument(f.ctx, {
    operationId: randomUUID(),
    workspaceId: workspace.id,
    title: '合成文档',
    markdown: ''
  }).data.document;
  const bytes = await sharp({ create: { width: 2, height: 3, channels: 3, background: '#334455' } })
    .png()
    .toBuffer();
  const upload = await f.service.uploadAttachment(f.ctx, {
    operationId: randomUUID(),
    workspaceId: workspace.id,
    documentId: document.id,
    expectedRevision: 1,
    fileName: 'synthetic.png',
    mimeType: 'image/png',
    bytes
  });
  document = f.service.updateDocument(f.ctx, {
    operationId: randomUUID(),
    workspaceId: workspace.id,
    documentId: document.id,
    expectedRevision: 2,
    markdown: `![合成图片](${upload.data.imageUri})`
  }).data.document;
  let task = f.service.createTask(f.ctx, { operationId: randomUUID(), workspaceId: workspace.id, title: '任务' }).data
    .task;
  task = f.service.publishTask(f.ctx, {
    operationId: randomUUID(),
    workspaceId: workspace.id,
    taskId: task.id,
    expectedRevision: task.revision,
    description: { documentId: document.id, versionId: document.version.id },
    acceptanceCriteria: ['合成测试'],
    inScope: '',
    outOfScope: ''
  }).data.task;
  const agent = { ...f.ctx, actor: { kind: 'mcp', id: 'synthetic-agent' } };
  f.service.claimTask(agent, {
    operationId: randomUUID(),
    workspaceId: workspace.id,
    taskId: task.id,
    expectedRevision: task.revision
  });
  assert.deepEqual(f.store.readOutbox(), []);
  assert.equal(f.store.exportSnapshot().data.notes.length, 0);
  assert.equal('taskWorkspaces' in f.store.exportSnapshot().data, false);
  const directory = createRuntimeBackup(f.store, f.root);
  const inspection = inspectRuntimeBackup(directory);
  assert.equal(inspection.workspaceCount, 1);
  assert.equal(inspection.taskAttachmentCount, 1);
  const restoredDirectory = prepareRestoredDirectory(f.root, directory);
  const restored = createSqliteDataStore(path.join(restoredDirectory, 'local.sqlite'));
  try {
    assert.equal(restored.taskWorkspaceStoreError, null);
    const restoredFiles = createTaskWorkspaceFiles({ uploadsDirectory: path.join(restoredDirectory, 'uploads') });
    const service = createTaskWorkspaceService({
      store: restored.taskWorkspaceStore,
      files: restoredFiles,
      authorize: () => true
    });
    const current = { ...f.ctx, ...restored.taskWorkspaceStore.identity() };
    assert.notEqual(current.datasetId, f.ctx.datasetId);
    assert.notEqual(current.datasetEpoch, f.ctx.datasetEpoch);
    assert.throws(() => service.getWorkspace(f.ctx, { workspaceId: workspace.id }), {
      code: 'TASK_WORKSPACE_FORBIDDEN'
    });
    assert.equal(service.getTask(current, { workspaceId: workspace.id, taskId: task.id }).status, 'ready');
    const image = await service.readAttachment(current, {
      workspaceId: workspace.id,
      documentId: document.id,
      versionId: document.version.id,
      attachmentId: upload.data.attachment.id
    });
    assert.deepEqual(image.bytes, bytes);
    assert.equal(image.attachment.sha256, upload.data.attachment.sha256);
  } finally {
    restored.close();
  }
  const record = f.store.taskWorkspaceStore.readSnapshot(tx => tx.get('documents', document.id)).attachments[0];
  fs.unlinkSync(path.join(f.root, 'uploads', record.storageKey));
  const rescue = createRuntimeBackup(f.store, f.root);
  assert.equal(JSON.parse(fs.readFileSync(path.join(rescue, 'manifest.json'))).taskWorkspace.status, 'rescue-only');
  assert.throws(() => inspectRuntimeBackup(rescue), /仅供原始资料救援/);
});

test('未知新域版本只禁用新域，原核心笔记仍能启动和写入', t => {
  const f = fixture(t);
  f.store.close();
  const db = new DatabaseSync(path.join(f.root, 'local.sqlite'));
  db.prepare("UPDATE metadata SET value='999' WHERE key='taskWorkspaceVersion'").run();
  db.close();
  const core = createSqliteDataStore(path.join(f.root, 'local.sqlite'));
  try {
    assert.equal(core.taskWorkspaceStore, null);
    assert.ok(core.taskWorkspaceStoreError);
    assert.ok(core.aiRepository);
    assert.deepEqual(core.exportSnapshot().data.notes, []);
    core.runTransaction(() => {});
    const rescue = createRuntimeBackup(core, f.root);
    const manifest = JSON.parse(fs.readFileSync(path.join(rescue, 'manifest.json')));
    assert.equal(manifest.taskWorkspace.status, 'rescue-only');
    assert.equal(manifest.restoreReady, false);
    const copy = new DatabaseSync(path.join(rescue, 'local.sqlite'), { readOnly: true });
    try {
      assert.equal(copy.prepare("SELECT value FROM metadata WHERE key='taskWorkspaceVersion'").get().value, '999');
    } finally {
      copy.close();
    }
    assert.ok(listRuntimeBackups(f.root).find(b => b.id === path.basename(rescue)).error);
    assert.throws(() => inspectRuntimeBackup(rescue), /仅供原始资料救援/);
    assert.throws(() => restoreRuntimeBackup(rescue, path.join(f.root, 'blocked-restore')), /仅供原始资料救援/);
    assert.equal(fs.existsSync(path.join(f.root, 'blocked-restore')), false);
  } finally {
    core.close();
  }
});

test('legacy备份缺datasetId且新域为空仍可只读检查，非空域不准失去绑定', t => {
  const f = fixture(t);
  f.store.metadataTransaction(db => db.prepare("DELETE FROM metadata WHERE key='datasetId'").run());
  const emptyBackup = createRuntimeBackup(f.store, f.root);
  assert.equal(inspectRuntimeBackup(emptyBackup).workspaceCount, 0);
  f.store.metadataTransaction(db => db.prepare('INSERT INTO metadata VALUES (?, ?)').run('datasetId', f.ctx.datasetId));
  f.service.createWorkspace(f.ctx, { operationId: randomUUID(), name: '合成资料' });
  f.store.metadataTransaction(db => db.prepare("DELETE FROM metadata WHERE key='datasetId'").run());
  const rescue = createRuntimeBackup(f.store, f.root);
  assert.throws(() => inspectRuntimeBackup(rescue), /仅供原始资料救援/);
});
