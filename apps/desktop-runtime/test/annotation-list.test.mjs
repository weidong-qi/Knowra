import { createPostgresTestDatabase } from '../../../scripts/test-support/postgres-test-database.mjs';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { once } from 'node:events';
import { test } from 'node:test';
import { createPostgresAppContext } from '../../api/src/postgres-app.factory.js';
import { createAppContext } from '../../api/src/app.factory.js';
import { createFileDataStore } from '../../api/src/infrastructure/file-data-store.js';
import { createServer } from '../../api/src/server.js';
import { createAttachmentTransfer } from '../../api/src/modules/sync/attachment-transfer.ts';
import { createSqliteDataStore } from '../src/sqlite-data-store.mjs';
import { createSyncEngine } from '../src/sync-engine.mjs';
import { createRuntimeBackup, inspectRuntimeBackup, restoreRuntimeBackup } from '../src/backup.mjs';
import { temporaryDirectory, openWorkspace } from './helpers.mjs';
import {
  anchorForListItem,
  anchorFromProjectedRange,
  projectMarkdown,
  calculateContentHash,
  sourceEdits
} from '../../../packages/content-anchor/src/index.js';

function createList(k, spaceId) {
  const raw = '- 父项\n  - 子项\n- 相邻';
  const note = k.noteService.createNote({ spaceId, title: '列表重点', rawMarkdown: raw });
  const projection = projectMarkdown(raw),
    anchor = anchorForListItem(projection, '0.0');
  const annotation = k.contentAnnotationService.createAnnotation({
    spaceId,
    noteId: note.id,
    schemaVersion: 2,
    scopeType: 'list',
    anchor,
    quoteText: anchor.quoteText,
    fromPosition: anchor.sourceStart,
    toPosition: anchor.sourceEnd,
    noteContentHash: calculateContentHash(raw),
    anchorFingerprint: 'list',
    idempotencyKey: 'list',
    comment: '保留备注'
  });
  const start = projection.text.indexOf('子项');
  const excluded = k.annotationScopeService.createExclusion(annotation.id, {
    expectedRevision: annotation.revision,
    noteContentHash: calculateContentHash(raw),
    anchor: anchorFromProjectedRange(projection, start, start + 2)
  });
  return { note, annotation, exclusion: excluded.exclusion };
}
function save(k, note, rawMarkdown) {
  return k.noteService.updateNote(note.id, {
    expectedUpdatedAt: note.updatedAt,
    rawMarkdown,
    annotationMapping: {
      formatVersion: 1,
      operationId: 'list-update',
      baseContentHash: calculateContentHash(note.rawMarkdown),
      targetContentHash: calculateContentHash(rawMarkdown),
      edits: sourceEdits(note.rawMarkdown, rawMarkdown)
    }
  });
}

for (const driver of ['json', 'sqlite'])
  test(`${driver}：列表、排除与身份重启回读，导出导入后继续跟随`, t => {
    const root = temporaryDirectory(t),
      filename = path.join(root, driver === 'json' ? 'data.json' : 'local.sqlite');
    const open = () => (driver === 'json' ? createFileDataStore(filename) : createSqliteDataStore(filename));
    let store = open();
    const app = () => createAppContext({ dataStore: store, storageRootDir: root });
    let context = app(),
      k = context.modules.knowledge;
    const space = k.knowledgeSpaceService.createDefaultKnowledgeSpace({ userId: 'demo' });
    const f = createList(k, space.id);
    let note = save(k, f.note, f.note.rawMarkdown.replace('父项', '父项补充'));
    const before = k.contentAnnotationService.getAnnotation(f.annotation.id);
    store.close?.();
    store = open();
    context = app();
    k = context.modules.knowledge;
    t.after(() => store.close?.());
    assert.deepEqual(k.contentAnnotationService.getAnnotation(f.annotation.id).anchor, before.anchor);
    assert.equal(k.annotationScopeService.previewAnnotation(f.annotation.id).exclusions.length, 1);
    note = save(k, k.noteService.getNote(note.id), note.rawMarkdown.replace('子项', '子项\n  - 新子项'));
    assert.match(k.contentAnnotationService.getAnnotation(f.annotation.id).quoteText, /新子项/);
    const snapshot = context.http.storage.exportKnowledgeBase();
    assert.equal(snapshot.schemaVersion, 7);
    const forged = structuredClone(snapshot);
    forged.data.contentAnnotations.find(item => item.id === f.annotation.id).anchor.tracking.rootId = 'forged-root';
    assert.throws(() => context.http.storage.importKnowledgeBase(forged), /invalid list identity/);
    assert.equal(k.contentAnnotationService.getAnnotation(f.annotation.id).anchorStatus, 'resolved');
    const restored = createFileDataStore(path.join(root, 'restored.json'));
    const restoredApp = createAppContext({ dataStore: restored, storageRootDir: path.join(root, 'restored') });
    restoredApp.http.storage.importKnowledgeBase(snapshot);
    const rk = restoredApp.modules.knowledge;
    assert.equal(rk.contentAnnotationService.getAnnotation(f.annotation.id).anchorStatus, 'resolved');
    assert.equal(rk.contentAnnotationService.getAnnotation(f.annotation.id).comment, '保留备注');
    assert.deepEqual(rk.contentAnnotationService.getAnnotation(f.annotation.id).originSnapshot, before.originSnapshot);
    if (driver === 'sqlite') {
      const backup = createRuntimeBackup(store, root);
      const inspected = inspectRuntimeBackup(backup);
      assert.ok(inspected);
      const backupRoot = path.join(root, 'from-backup');
      restoreRuntimeBackup(backup, backupRoot);
      const backupStore = createSqliteDataStore(path.join(backupRoot, 'local.sqlite'));
      try {
        const bk = createAppContext({ dataStore: backupStore, storageRootDir: backupRoot }).modules.knowledge;
        const restoredNote = bk.noteService.getNote(note.id);
        save(bk, restoredNote, restoredNote.rawMarkdown.replace('父项', '备份恢复父项'));
        assert.equal(bk.contentAnnotationService.getAnnotation(f.annotation.id).anchorStatus, 'resolved');
        assert.match(bk.contentAnnotationService.getAnnotation(f.annotation.id).quoteText, /备份恢复父项/);
        assert.equal(bk.annotationScopeService.previewAnnotation(f.annotation.id).exclusions.length, 1);
      } finally {
        backupStore.close();
      }
    }
  });

for (const cloud of [
  'json',
  ...(process.env.KNOWRA_SYNC_TEST_DATABASE_URL && process.env.KNOWRA_SYNC_TEST_ALLOW_WRITES === '1'
    ? ['postgres']
    : [])
])
  test(`两个 SQLite 设备经 ${cloud} HTTP 同步列表及排除，另一设备编辑后返回来源状态`, async t => {
    const root = temporaryDirectory(t);
    const dataStore = createFileDataStore(path.join(root, 'cloud.json'));
    const database = cloud === 'postgres' ? await createPostgresTestDatabase() : null;
    if (database) t.after(() => database.close());
    const context =
      cloud === 'postgres'
        ? await createPostgresAppContext({ databaseUrl: database.databaseUrl, storageRootDir: root })
        : createAppContext({ dataStore, storageRootDir: root });
    if (cloud === 'postgres') t.after(() => context.close());
    const space = await context.modules.knowledge.knowledgeSpaceService.createDefaultKnowledgeSpace({ userId: 'demo' });
    const server = createServer({ appContext: context });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    t.after(() => new Promise(resolve => server.close(resolve)));
    const device = async name => {
      const directory = path.join(root, name),
        workspace = openWorkspace(directory);
      const engine = createSyncEngine(workspace.store, {
        autoSync: false,
        noteService: workspace.knowledge.noteService,
        entityTransfer: createAttachmentTransfer({
          uploadsDir: path.join(directory, 'uploads'),
          storageRootDir: directory
        })
      });
      t.after(async () => {
        await engine.close();
        workspace.store.close();
      });
      await engine.configure({ serverUrl: `http://127.0.0.1:${server.address().port}` });
      return { ...workspace, engine };
    };
    const a = await device('a'),
      b = await device('b');
    const f = createList(a.knowledge, space.id);
    await a.engine.sync();
    assert.equal(a.engine.status().error, null);
    await b.engine.sync();
    assert.equal(b.engine.status().error, null);
    const remote = b.knowledge.contentAnnotationService.getAnnotation(f.annotation.id);
    assert.equal(remote.scopeType, 'list');
    assert.deepEqual(remote.originSnapshot, f.annotation.originSnapshot);
    assert.equal(b.knowledge.annotationScopeService.previewAnnotation(remote.id).exclusions.length, 1);
    const note = b.knowledge.noteService.getNote(f.note.id);
    save(b.knowledge, note, note.rawMarkdown.replace('父项', '父项补充'));
    await b.engine.sync();
    assert.equal(b.engine.status().error, null);
    await a.engine.sync();
    assert.equal(a.engine.status().error, null);
    const returned = a.knowledge.contentAnnotationService.getAnnotation(remote.id);
    assert.equal(returned.anchorStatus, 'resolved');
    assert.match(returned.quoteText, /补充/);
    assert.equal(returned.anchor.tracking.rootId, remote.anchor.tracking.rootId);
  });

test('新版同步拒绝格式 5 的服务器，保留本地内容和待发送队列', async t => {
  const root = temporaryDirectory(t),
    workspace = openWorkspace(root);
  createList(workspace.knowledge, workspace.space.id);
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
