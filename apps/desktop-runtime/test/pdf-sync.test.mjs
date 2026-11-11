import assert from 'node:assert/strict';
import path from 'node:path';
import { Readable } from 'node:stream';
import { once } from 'node:events';
import { test } from 'node:test';
import { createPostgresTestDatabase } from '../../../scripts/test-support/postgres-test-database.mjs';
import { createPostgresAppContext } from '../../api/src/postgres-app.factory.js';
import { createAppContext } from '../../api/src/app.factory.js';
import { createFileDataStore } from '../../api/src/infrastructure/file-data-store.ts';
import { createServer } from '../../api/src/server.js';
import { createSqliteDataStore } from '../src/sqlite-data-store.mjs';
import { createSyncEngine } from '../src/sync-engine.mjs';
import { createAttachmentTransfer } from '../../api/src/modules/sync/attachment-transfer.ts';
import { temporaryDirectory } from './helpers.mjs';
import { syntheticPdf } from '../../../scripts/test-support/pdf-fixtures.mjs';
import { createRuntimeBackup, inspectRuntimeBackup, restoreRuntimeBackup } from '../src/backup.mjs';
import { prepareBatchState } from '../../api/src/modules/sync/batch-domain.ts';

async function runPdfSync(t, postgres = false) {
  const root = temporaryDirectory(t);
  let database;
  if (postgres) {
    database = await createPostgresTestDatabase();
    t.after(() => database.close());
  }
  const options = { uploadsDir: path.join(root, 'cloud-uploads'), storageRootDir: root };
  const cloud = postgres
    ? await createPostgresAppContext({ ...options, databaseUrl: database.databaseUrl })
    : createAppContext({ ...options, dataStore: createFileDataStore(path.join(root, 'cloud.json')) });
  if (postgres) t.after(() => cloud.close());
  const space = await cloud.modules.knowledge.knowledgeSpaceService.createDefaultKnowledgeSpace({ userId: 'demo' });
  const server = createServer({ appContext: cloud, logger: { error() {} } });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`;
  t.after(() => new Promise(resolve => server.close(resolve)));
  function device(name) {
    const directory = path.join(root, name),
      store = createSqliteDataStore(path.join(directory, 'local.sqlite'));
    const context = createAppContext({
      dataStore: store,
      storageRootDir: directory,
      uploadsDir: path.join(directory, 'uploads')
    });
    const transfer = createAttachmentTransfer({
      allowRepair: true,
      storageRootDir: directory,
      uploadsDir: path.join(directory, 'uploads')
    });
    const engine = createSyncEngine(store, {
      autoSync: false,
      noteService: context.modules.knowledge.noteService,
      entityTransfer: transfer
    });
    t.after(async () => {
      await engine.close();
      store.close();
    });
    return { directory, store, context, engine, transfer };
  }
  const a = device('a'),
    b = device('b');
  await a.engine.configure({ serverUrl: origin });
  await b.engine.configure({ serverUrl: origin });
  const bytes = syntheticPdf({ padding: 7 * 1024 * 1024 });
  const note = await a.context.http.pdf.importPdf(
    { operationId: 'device-a', spaceId: space.id, fileName: '大文件.pdf' },
    Readable.from([bytes])
  );
  await a.context.http.pdf.mutate(note.id, 'region', {
    operationId: 'first',
    expectedRevision: 0,
    type: 'region',
    segments: [{ pageIndex: 0, rect: [10, 20, 40, 60] }],
    comment: '设备 A 标注'
  });
  a.context.modules.knowledge.noteService.updateNote(note.id, { title: '大文件重命名' });
  await a.engine.sync();
  assert.equal(a.engine.status().error, null);
  await b.engine.sync();
  assert.equal(b.engine.status().error, null);
  assert.equal(b.transfer.read(b.store.state.attachments.find(file => file.noteId === note.id)).length, bytes.length);
  assert.equal((await b.context.http.pdf.list(note.id))[0].comment, '设备 A 标注');
  const backup = createRuntimeBackup(b.store, b.directory);
  const inspected = inspectRuntimeBackup(backup);
  assert.equal(inspected.valid, true);
  const restoreDirectory = path.join(root, 'restored');
  restoreRuntimeBackup(backup, restoreDirectory);
  const reopened = createSqliteDataStore(path.join(restoreDirectory, 'local.sqlite'));
  assert.equal(reopened.state.pdfAnnotations.length, 1);
  reopened.close();
  a.context.modules.knowledge.noteService.updateNote(note.id, { title: '资料生命周期' });
  a.context.modules.knowledge.noteService.deleteNote(note.id);
  await a.engine.sync();
  await b.engine.sync();
  assert.equal(b.store.state.notes.find(item => item.id === note.id).deleted, true);
  assert.equal(b.store.state.pdfAnnotations.length, 1);
  a.context.modules.knowledge.noteService.restoreNote(note.id);
  await a.engine.sync();
  await b.engine.sync();
  await a.context.http.pdf.mutate(note.id, 'region', {
    operationId: 'a-edit',
    expectedRevision: 1,
    comment: 'A 离线修改'
  });
  await b.context.http.pdf.mutate(note.id, 'region', {
    operationId: 'b-edit',
    expectedRevision: 1,
    comment: 'B 离线修改'
  });
  await a.engine.sync();
  await b.engine.sync();
  assert(b.engine.status().entityConflict, '同一标注不能静默覆盖');
  const conflictId = b.engine.status().entityConflict.id;
  await b.engine.resolve({ conflictId, choice: 'remote' });
  await b.engine.sync();
  assert.equal((await b.context.http.pdf.list(note.id))[0].comment, 'A 离线修改');
  await a.context.http.pdf.mutate(note.id, 'region', {
    operationId: 'a-again',
    expectedRevision: 2,
    comment: 'A 第二次修改'
  });
  await b.context.http.pdf.mutate(note.id, 'region', {
    operationId: 'b-again',
    expectedRevision: 2,
    comment: 'B 保留副本'
  });
  await a.engine.sync();
  await b.engine.sync();
  await b.engine.resolve({ conflictId: b.engine.status().entityConflict.id, choice: 'copy' });
  assert.equal(b.engine.status().error, null);
  const copy = b.store.state.notes.find(item => item.contentKind === 'pdf' && item.id !== note.id);
  assert(copy);
  assert.notEqual(copy.pdfSource.attachmentId, note.pdfSource.attachmentId);
  assert.equal((await b.context.http.pdf.list(copy.id))[0].comment, 'B 保留副本');
  await b.engine.sync();
  await a.engine.sync();
  assert.equal(b.engine.status().error, null);
  assert.equal(a.engine.status().error, null);
  assert.equal((await a.context.http.pdf.list(copy.id))[0].comment, 'B 保留副本');
  assert.equal(a.transfer.verify(a.store.state.attachments.find(file => file.noteId === copy.id)).size, bytes.length);
  await a.context.http.pdf.mutate(note.id, 'region', {
    operationId: 'a-third',
    expectedRevision: 3,
    comment: 'A 最后修改'
  });
  await b.context.http.pdf.mutate(note.id, 'region', {
    operationId: 'b-third',
    expectedRevision: 3,
    comment: 'B 采用本机'
  });
  await a.engine.sync();
  await b.engine.sync();
  await b.engine.resolve({ conflictId: b.engine.status().entityConflict.id, choice: 'local' });
  await b.engine.sync();
  await a.engine.sync();
  assert.equal((await a.context.http.pdf.list(note.id))[0].comment, 'B 采用本机');
  a.context.modules.knowledge.noteService.updateNote(note.id, { title: '资料生命周期' });
  a.context.modules.knowledge.noteService.deleteNote(note.id);
  await a.engine.sync();
  await b.engine.sync();
  await cloud.http.knowledge.permanentlyDeleteNote({ id: note.id });
  await a.engine.sync();
  await b.engine.sync();
  assert.equal(
    a.store.state.notes.some(item => item.id === note.id),
    false
  );
  assert.equal(
    b.store.state.pdfAnnotations.some(item => item.noteId === note.id),
    false
  );
  assert.equal((await b.context.http.pdf.list(copy.id)).length, 1);
  // 便签位置可编辑：多次离线拖动和评论必须一起穿过真实 HTTP 同步队列。
  const segments = rect => [{ pageIndex: 0, rect }];
  await a.context.http.pdf.mutate(copy.id, 'movable-note', {
    operationId: 'note-create',
    expectedRevision: 0,
    type: 'note',
    segments: segments([10, 20, 28, 38]),
    comment: '原便签'
  });
  await a.engine.sync();
  await b.engine.sync();
  for (const [revision, rect] of [
    [1, [30, 40, 48, 58]],
    [2, [50, 60, 68, 78]]
  ]) {
    await a.context.http.pdf.mutate(copy.id, 'movable-note', {
      operationId: `note-move-${revision}`,
      expectedRevision: revision,
      segments: segments(rect),
      comment: '拖动后继续编辑'
    });
  }
  await a.engine.sync();
  assert.equal(a.engine.status().error, null, JSON.stringify(a.engine.status()));
  await b.engine.sync();
  assert.equal(b.engine.status().error, null);
  const moved = (await b.context.http.pdf.list(copy.id)).find(item => item.id === 'movable-note');
  assert.deepEqual(moved.segments, segments([50, 60, 68, 78]));
  assert.equal(moved.comment, '拖动后继续编辑');
  assert.equal(a.engine.status().pendingEntities, 0);
  // 只放开便签的坐标；来源、原文和类型继续保持不可变，修订不能倒退。
  for (const fields of [
    { noteId: 'another-note' },
    { spaceId: 'another-space' },
    { attachmentId: 'another-file' },
    { sha256: 'b'.repeat(64) },
    { type: 'region' },
    { quoteText: '改换原文' }
  ]) {
    assert.throws(
      () =>
        prepareBatchState(
          a.store.state,
          [
            {
              collection: 'pdfAnnotations',
              id: moved.id,
              value: { ...moved, ...fields }
            }
          ],
          'demo'
        ),
      { code: 'PDF_SOURCE_IMMUTABLE' }
    );
  }
  assert.throws(
    () =>
      prepareBatchState(
        a.store.state,
        [
          {
            collection: 'pdfAnnotations',
            id: moved.id,
            value: { ...moved, revision: moved.revision - 1 }
          }
        ],
        'demo'
      ),
    { code: 'PDF_ANNOTATION_CONFLICT' }
  );
  const fixed = a.store.state.pdfAnnotations.find(item => item.noteId === copy.id && item.type === 'region');
  for (const type of ['highlight', 'underline', 'region']) {
    const before = structuredClone(a.store.state);
    const mark = before.pdfAnnotations.find(item => item.id === fixed.id);
    Object.assign(mark, { type, quoteText: '固定原文' });
    assert.throws(
      () =>
        prepareBatchState(
          before,
          [
            {
              collection: 'pdfAnnotations',
              id: mark.id,
              value: { ...mark, segments: segments([60, 70, 90, 100]) }
            }
          ],
          'demo'
        ),
      { code: 'PDF_SOURCE_IMMUTABLE' }
    );
  }
  // 两端同时移动同一便签仍需核对，不能靠放开坐标绕过并发保护。
  for (const [device, rect] of [
    [a, [70, 80, 88, 98]],
    [b, [90, 100, 108, 118]]
  ]) {
    await device.context.http.pdf.mutate(copy.id, moved.id, {
      operationId: `concurrent-${rect[0]}`,
      expectedRevision: moved.revision,
      segments: segments(rect)
    });
  }
  await a.engine.sync();
  await b.engine.sync();
  assert(b.engine.status().entityConflict);
  await b.engine.resolve({ conflictId: b.engine.status().entityConflict.id, choice: 'remote' });
  await b.engine.sync();
  assert.equal(b.engine.status().error, null);
  assert.deepEqual(
    (await b.context.http.pdf.list(copy.id)).find(item => item.id === moved.id).segments,
    segments([70, 80, 88, 98])
  );
}
test('PDF 真实双 SQLite / HTTP：二进制文件、标注、重启、回收站、三种冲突与完整备份', { timeout: 60000 }, t =>
  runPdfSync(t)
);
const postgresEnabled = Boolean(
  process.env.KNOWRA_SYNC_TEST_DATABASE_URL && process.env.KNOWRA_SYNC_TEST_ALLOW_WRITES === '1'
);
test(
  'PDF 真实 PostgreSQL / HTTP 双设备：文件、三种冲突、备份及永久删除',
  { skip: !postgresEnabled, timeout: 90000 },
  t => runPdfSync(t, true)
);
