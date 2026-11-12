import assert from 'node:assert/strict';
import path from 'node:path';
import { once } from 'node:events';
import { test } from 'node:test';
import { createFileDataStore } from '../../api/src/infrastructure/file-data-store.ts';
import { createAppContext } from '../../api/src/app.factory.ts';
import { createServer } from '../../api/src/server.js';
import { createSyncEngine } from '../src/sync-engine.mjs';
import { createAttachmentTransfer } from '../../api/src/modules/sync/attachment-transfer.ts';
import { syncContract } from '../../api/src/modules/sync/protocol-contract.ts';
import { requestHash } from '../../api/src/modules/sync/journal.ts';
import { readMeta, writeMeta, nextUpload, acknowledge } from '../src/sync-state.mjs';
import { acknowledgeEntityUpload, nextEntityUpload } from '../src/entity-sync-state.mjs';
import { beginUpload } from '../src/sync-safety.mjs';
import { temporaryDirectory, openWorkspace } from './helpers.mjs';

async function fixture(t, intercept, options = {}) {
  const root = temporaryDirectory(t);
  const dataStore = createFileDataStore(path.join(root, 'synthetic-cloud.json'));
  const context = createAppContext({ dataStore, uploadsDir: path.join(root, 'uploads'), storageRootDir: root });
  const knowledge = context.modules.knowledge;
  const space = knowledge.knowledgeSpaceService.createDefaultKnowledgeSpace({ userId: 'demo' });
  const note = knowledge.noteService.createNote({ title: '合成同步样本', rawMarkdown: '基线 B', spaceId: space.id });
  const server = createServer({ appContext: context, logger: { error() {} } });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`;
  t.after(() => new Promise(resolve => server.close(resolve)));
  const localRoot = path.join(root, 'synthetic-local');
  const a = openWorkspace(localRoot);
  const engine = createSyncEngine(a.store, {
    autoSync: false,
    noteService: a.knowledge.noteService,
    entityTransfer: createAttachmentTransfer({
      uploadsDir: path.join(localRoot, 'uploads'),
      storageRootDir: localRoot
    }),
    fetcher: intercept ?? fetch,
    ...options
  });
  let closed = false;
  const close = async () => {
    if (closed) return;
    await engine.close();
    a.store.close();
    closed = true;
  };
  t.after(close);
  await engine.configure({ serverUrl: origin });
  const meta = key => a.store.readSync(db => readMeta(db, key));
  return { root, dataStore, context, knowledge, note, a, engine, meta, origin, close };
}

for (const mode of ['receipt-expired', 'epoch-changed', 'operation-reused']) {
  test(`${mode}：上传确认丢失后撤回收藏，不重发、不清理、不被云端覆盖`, async t => {
    let lose = true;
    let writes = 0;
    let original;
    const cloud = await fixture(t, async (url, init) => {
      if (url.endsWith('/batch')) {
        writes++;
        if (!lose && mode === 'operation-reused')
          return new Response(JSON.stringify({ error: { code: 'OPERATION_REUSED', message: '不应到达的重试' } }), {
            status: 422
          });
      }
      const response = await fetch(url, init);
      if (url.endsWith('/batch') && lose) {
        original = JSON.parse(init.body);
        lose = false;
        throw new Error('合成确认丢失');
      }
      return response;
    });
    cloud.a.knowledge.noteService.updateNote(cloud.note.id, { favorite: true });
    await cloud.engine.sync();
    cloud.a.knowledge.noteService.updateNote(cloud.note.id, { favorite: false });
    const blocked = { synthetic: { noteId: 'synthetic', value: '保留的阻塞记录' } };
    cloud.a.store.metadataTransaction(db => writeMeta(db, 'blocked', blocked));
    const outbox = cloud.a.store.readOutbox();
    const base = cloud.a.store.readSync(db => db.prepare('SELECT * FROM sync_base').all());
    if (mode === 'receipt-expired')
      cloud.dataStore.runSyncTransaction(() => {
        delete cloud.dataStore.getSyncJournal().receipts[JSON.stringify([original.deviceId, original.operationId])];
      });
    if (mode === 'epoch-changed') cloud.dataStore.commitImport(cloud.dataStore.exportSnapshot());
    for (const action of [() => cloud.engine.sync(), () => cloud.engine.retry()]) await action();
    await cloud.engine.disconnect();
    assert.equal(cloud.engine.status().error.code, 'SYNC_RESULT_UNCERTAIN');
    await assert.rejects(cloud.engine.configure({ serverUrl: cloud.origin }), { code: 'SYNC_RESULT_UNCERTAIN' });
    await assert.rejects(cloud.engine.resolve({ conflictId: 'synthetic', choice: 'remote' }), {
      code: 'SYNC_RESULT_UNCERTAIN'
    });
    cloud.engine.wake('online');
    assert.equal(writes, 1);
    assert.equal(cloud.a.knowledge.noteService.getNote(cloud.note.id).favorite, false);
    assert.deepEqual(cloud.meta('entityUpload'), original);
    assert.deepEqual(cloud.a.store.readOutbox(), outbox);
    assert.deepEqual(cloud.meta('blocked'), blocked);
    assert.deepEqual(
      cloud.a.store.readSync(db => db.prepare('SELECT * FROM sync_base').all()),
      base
    );
    const recovery = cloud.engine.recovery()[0];
    assert.equal(recovery.snapshot.notes.find(note => note.id === cloud.note.id).favorite, false);
    assert.deepEqual(recovery.upload, original);
    assert.equal(recovery.safetyPause.code, 'SYNC_RESULT_UNCERTAIN');
  });
}

test('首轮提交返回 OPERATION_REUSED 时也保留原请求并持久暂停', async t => {
  let writes = 0;
  const cloud = await fixture(t, (url, init) => {
    if (url.endsWith('/batch')) {
      writes++;
      return new Response(JSON.stringify({ error: { code: 'OPERATION_REUSED', message: '合成重复 ID' } }), {
        status: 422
      });
    }
    return fetch(url, init);
  });
  cloud.a.knowledge.noteService.updateNote(cloud.note.id, { favorite: true });
  await cloud.engine.sync();
  const frozen = cloud.meta('entityUpload');
  assert(frozen);
  assert.equal(cloud.meta('safetyPause').reason, 'OPERATION_REUSED');
  cloud.a.knowledge.noteService.updateNote(cloud.note.id, { favorite: false });
  await cloud.engine.retry();
  assert.equal(writes, 1);
  assert.deepEqual(cloud.meta('entityUpload'), frozen);
  assert.equal(cloud.a.knowledge.noteService.getNote(cloud.note.id).favorite, false);
});

for (const mode of ['missing', 'operation-reused']) {
  test(`legacy v1 ${mode}：不查询或重放旧请求，恢复导出保留原队列`, async t => {
    let requests = 0;
    const cloud = await fixture(t, (url, init) => {
      requests++;
      return fetch(url, init);
    });
    cloud.a.knowledge.noteService.updateNote(cloud.note.id, { favorite: true });
    const old = nextUpload(cloud.a.store);
    if (mode === 'operation-reused')
      assert.equal(cloud.context.http.sync.push({ ...old, ...syncContract() }).status, 'accepted');
    else
      assert.equal(
        cloud.context.http.sync.operationReceipt({
          ...syncContract(),
          datasetEpoch: old.datasetEpoch,
          deviceId: old.deviceId,
          operationId: old.operationId,
          requestHash: requestHash(old)
        }).status,
        'missing'
      );
    cloud.a.knowledge.noteService.updateNote(cloud.note.id, { favorite: false });
    const before = requests;
    await cloud.engine.sync();
    await cloud.engine.retry();
    assert.equal(requests, before);
    assert.equal(cloud.engine.status().error.code, 'SYNC_RESULT_UNCERTAIN');
    assert.equal(cloud.a.knowledge.noteService.getNote(cloud.note.id).favorite, false);
    assert.deepEqual(cloud.engine.recovery()[0].legacyUploads, [old]);
    assert.throws(() => nextEntityUpload(cloud.a.store), { code: 'SYNC_RESULT_UNCERTAIN' });
    if (mode === 'missing') {
      assert.equal(cloud.context.http.sync.push({ ...old, ...syncContract() }).status, 'accepted');
      await cloud.engine.sync();
      assert.equal(cloud.a.knowledge.noteService.getNote(cloud.note.id).favorite, false);
    }
  });
}

for (const mode of ['new-operation', 'new-epoch']) {
  test(`迟到确认 ${mode}：不更改基线、删除事实或后续冻结请求`, async t => {
    const cloud = await fixture(t);
    cloud.a.knowledge.noteService.updateNote(cloud.note.id, { favorite: true });
    const old = nextEntityUpload(cloud.a.store);
    const accepted = await cloud.context.http.sync.pushBatch(old);
    if (mode === 'new-operation') {
      acknowledgeEntityUpload(cloud.a.store, old, accepted);
      cloud.a.knowledge.noteService.updateNote(cloud.note.id, { favorite: false });
      nextEntityUpload(cloud.a.store);
    } else cloud.a.store.metadataTransaction(db => writeMeta(db, 'epoch', 'synthetic-new-epoch'));
    const frozen = cloud.meta('entityUpload');
    const before = cloud.a.store.readSync(db => ({
      base: db.prepare('SELECT * FROM sync_base').all(),
      facts: db.prepare('SELECT * FROM deletion_facts').all()
    }));
    await assert.rejects(async () => acknowledgeEntityUpload(cloud.a.store, old, accepted), {
      code: 'SYNC_RESULT_UNCERTAIN'
    });
    assert.deepEqual(cloud.meta('entityUpload'), frozen);
    assert.deepEqual(
      cloud.a.store.readSync(db => ({
        base: db.prepare('SELECT * FROM sync_base').all(),
        facts: db.prepare('SELECT * FROM deletion_facts').all()
      })),
      before
    );
    assert.equal(cloud.meta('safetyPause').code, 'SYNC_RESULT_UNCERTAIN');
  });
}

test('旧版留下的当前格式请求没有准备标记时，不换新 ID 或跨 epoch 重发', async t => {
  let writes = 0;
  const cloud = await fixture(t, (url, init) => {
    if (url.endsWith('/batch')) writes++;
    return fetch(url, init);
  });
  cloud.a.knowledge.noteService.updateNote(cloud.note.id, { favorite: true });
  const old = nextEntityUpload(cloud.a.store);
  cloud.a.store.metadataTransaction(db => writeMeta(db, 'preparedUpload', null));
  cloud.dataStore.commitImport(cloud.dataStore.exportSnapshot());
  cloud.a.knowledge.noteService.updateNote(cloud.note.id, { favorite: false });
  await cloud.engine.sync();
  assert.equal(writes, 0);
  assert.equal(cloud.a.knowledge.noteService.getNote(cloud.note.id).favorite, false);
  assert.deepEqual(cloud.meta('entityUpload'), old);
  assert.equal(cloud.engine.status().error.code, 'SYNC_RESULT_UNCERTAIN');
});

test('服务端 v2 更高序号的新 ID 成功后，迟到旧请求仍被拒绝', async t => {
  const cloud = await fixture(t);
  cloud.a.knowledge.noteService.updateNote(cloud.note.id, { favorite: true });
  const delayed = nextEntityUpload(cloud.a.store);
  cloud.a.store.metadataTransaction(db => writeMeta(db, 'entityUpload', null));
  cloud.a.knowledge.noteService.updateNote(cloud.note.id, { favorite: false, title: '后续明确修改' });
  const next = nextEntityUpload(cloud.a.store);
  assert.notEqual(delayed.operationId, next.operationId);
  assert(next.sequence > delayed.sequence);
  assert.equal((await cloud.context.http.sync.pushBatch(next)).status, 'accepted');
  await assert.rejects(cloud.context.http.sync.pushBatch(delayed), { code: 'SYNC_OPERATION_EXPIRED' });
  assert.equal(cloud.knowledge.noteService.getNote(cloud.note.id).favorite, false);
});

test('发送标记已落库但暂停尚未落库的崩溃窗口，下次同步不重发', async t => {
  let writes = 0;
  const cloud = await fixture(t, (url, init) => {
    if (url.endsWith('/batch')) writes++;
    return fetch(url, init);
  });
  cloud.a.knowledge.noteService.updateNote(cloud.note.id, { favorite: true });
  const operation = nextEntityUpload(cloud.a.store);
  assert.equal(
    cloud.a.store.metadataTransaction(db => beginUpload(db, operation)),
    null
  );
  assert.equal(cloud.meta('safetyPause'), null);
  await cloud.engine.sync();
  assert.equal(cloud.engine.status().error.code, 'SYNC_RESULT_UNCERTAIN');
  assert.equal(writes, 0);
  assert.deepEqual(cloud.meta('entityUpload'), operation);
  assert.equal(
    cloud.a.store.readSync(db => db.prepare('PRAGMA user_version').get().user_version),
    8
  );
});

test('两个发送入口争用同一冻结请求时，第二入口持久暂停且不再次发送', async t => {
  const cloud = await fixture(t);
  cloud.a.knowledge.noteService.updateNote(cloud.note.id, { favorite: true });
  const operation = nextEntityUpload(cloud.a.store);
  assert.equal(
    cloud.a.store.metadataTransaction(db => beginUpload(db, operation)),
    null
  );
  const failure = cloud.a.store.metadataTransaction(db => beginUpload(db, operation));
  assert.equal(failure.code, 'SYNC_RESULT_UNCERTAIN');
  assert.equal(cloud.meta('safetyPause').reason, 'concurrent-or-unprepared-upload');
  assert.deepEqual(cloud.meta('entityUpload'), operation);
});

test('畸形成功响应不清除队列，也不推进基线', async t => {
  const cloud = await fixture(t, (url, init) =>
    url.endsWith('/batch') ? new Response(JSON.stringify({ data: { status: 'accepted' } })) : fetch(url, init)
  );
  const before = cloud.a.store.readSync(db => db.prepare('SELECT * FROM sync_base').all());
  cloud.a.knowledge.noteService.updateNote(cloud.note.id, { favorite: true });
  await cloud.engine.sync();
  assert.equal(cloud.engine.status().error.code, 'SYNC_RESULT_UNCERTAIN');
  assert(cloud.meta('entityUpload'));
  assert.deepEqual(
    cloud.a.store.readSync(db => db.prepare('SELECT * FROM sync_base').all()),
    before
  );
});

test('暂停后的自动定时、前台与联网唤醒均不安排重发', async t => {
  let writes = 0;
  let id = 0;
  const timers = new Map();
  const clock = {
    now: () => 0,
    setTimeout(fn) {
      timers.set(++id, fn);
      return id;
    },
    clearTimeout(key) {
      timers.delete(key);
    }
  };
  const cloud = await fixture(
    t,
    async (url, init) => {
      const response = await fetch(url, init);
      if (url.endsWith('/batch')) {
        writes++;
        throw new Error('合成确认丢失');
      }
      return response;
    },
    { autoSync: true, clock }
  );
  cloud.a.knowledge.noteService.updateNote(cloud.note.id, { favorite: true });
  await cloud.engine.sync();
  cloud.engine.wake('focus');
  cloud.engine.wake('online');
  cloud.a.knowledge.noteService.updateNote(cloud.note.id, { favorite: false });
  assert.equal(timers.size, 0);
  assert.equal(writes, 1);
  assert.equal(cloud.engine.status().error.code, 'SYNC_RESULT_UNCERTAIN');
});

test('v1 迟到确认 epoch 不匹配时，保留旧队列且不覆盖本地状态', async t => {
  const cloud = await fixture(t);
  cloud.a.knowledge.noteService.updateNote(cloud.note.id, { favorite: true });
  const old = nextUpload(cloud.a.store);
  const accepted = cloud.context.http.sync.push({ ...old, ...syncContract() });
  cloud.a.knowledge.noteService.updateNote(cloud.note.id, { favorite: false });
  cloud.a.store.metadataTransaction(db => writeMeta(db, 'epoch', 'synthetic-new-epoch'));
  assert.throws(() => acknowledge(cloud.a.store, old, accepted), { code: 'SYNC_RESULT_UNCERTAIN' });
  assert.equal(cloud.a.knowledge.noteService.getNote(cloud.note.id).favorite, false);
  assert.deepEqual(cloud.engine.recovery()[0].legacyUploads, [old]);
  assert.equal(cloud.meta('safetyPause').code, 'SYNC_RESULT_UNCERTAIN');
});

for (const malformed of [
  'empty-accepted',
  'partial-accepted',
  'duplicate-accepted',
  'wrong-alias',
  'bad-revision',
  'wrong-value-id',
  'unexpected-tombstone',
  'empty-conflict'
]) {
  test(`不完整或非法回执 ${malformed} 保留请求并暂停，不能换新 ID`, async t => {
    let writes = 0;
    const cloud = await fixture(t, (url, init) => {
      if (!url.endsWith('/batch')) return fetch(url, init);
      writes++;
      const operation = JSON.parse(init.body);
      let entries = operation.changes.map(entry => ({
        collection: entry.collection,
        id: entry.id,
        revision: Math.max(1, entry.baseRevision ?? 0),
        value: entry.value
      }));
      let result = { status: 'accepted', entries };
      if (malformed === 'empty-accepted') result.entries = [];
      if (malformed === 'partial-accepted') result.entries = entries.slice(1);
      if (malformed === 'duplicate-accepted') result.entries[1] = entries[0];
      if (malformed === 'wrong-alias')
        result.aliases = {
          [operation.changes.find(entry => entry.collection === 'noteVersions').id]: 'synthetic-alias'
        };
      if (malformed === 'bad-revision') result.entries[0].revision = 0;
      if (malformed === 'wrong-value-id') result.entries[0].value = { ...result.entries[0].value, id: 'mismatched' };
      if (malformed === 'unexpected-tombstone') result.entries[0].value = null;
      if (malformed === 'empty-conflict') result = { status: 'conflict', conflicts: [] };
      return new Response(JSON.stringify({ data: result }));
    });
    cloud.a.knowledge.noteService.updateNote(cloud.note.id, { favorite: true });
    cloud.a.knowledge.noteService.createNote({
      title: '另一个合成待传笔记',
      rawMarkdown: '原文保留',
      spaceId: cloud.a.space.id
    });
    const base = cloud.a.store.readSync(db => db.prepare('SELECT * FROM sync_base').all());
    await cloud.engine.sync();
    const frozen = cloud.meta('entityUpload');
    assert(frozen);
    assert.equal(cloud.engine.status().error.code, 'SYNC_RESULT_UNCERTAIN');
    await cloud.engine.retry();
    assert.equal(writes, 1);
    assert.deepEqual(cloud.meta('entityUpload'), frozen);
    assert.deepEqual(
      cloud.a.store.readSync(db => db.prepare('SELECT * FROM sync_base').all()),
      base
    );
    assert.throws(() => nextEntityUpload(cloud.a.store), { code: 'SYNC_RESULT_UNCERTAIN' });
  });
}

test('崩溃重开后首次直接解决无关冲突，也不能清除待确认发送及恢复证据', async t => {
  const cloud = await fixture(t);
  const other = cloud.knowledge.noteService.createNote({
    title: '合成无关笔记',
    rawMarkdown: '共同正文',
    spaceId: cloud.note.spaceId
  });
  await cloud.engine.sync();
  cloud.a.knowledge.noteService.updateNote(other.id, { rawMarkdown: '本地分支' });
  cloud.knowledge.noteService.updateNote(other.id, { rawMarkdown: '云端分支' });
  await cloud.engine.sync();
  const conflict = cloud.engine.status().entityConflict;
  assert(conflict);
  cloud.a.knowledge.noteService.updateNote(cloud.note.id, { favorite: true });
  const frozen = nextEntityUpload(cloud.a.store);
  assert(frozen);
  assert.equal(
    cloud.a.store.metadataTransaction(db => beginUpload(db, frozen)),
    null
  );
  assert.equal(cloud.meta('safetyPause'), null);
  await cloud.close();
  const directory = path.join(cloud.root, 'synthetic-local');
  const workspace = openWorkspace(directory);
  const engine = createSyncEngine(workspace.store, {
    autoSync: false,
    noteService: workspace.knowledge.noteService,
    entityTransfer: createAttachmentTransfer({
      uploadsDir: path.join(directory, 'uploads'),
      storageRootDir: directory
    }),
    fetcher: () => {
      throw new Error('重启首次普通操作不应联网');
    }
  });
  t.after(async () => {
    await engine.close();
    workspace.store.close();
  });
  assert.equal(engine.status().error.code, 'SYNC_RESULT_UNCERTAIN');
  await assert.rejects(engine.resolve({ conflictId: conflict.id, choice: 'remote' }), {
    code: 'SYNC_RESULT_UNCERTAIN'
  });
  assert.deepEqual(engine.recovery()[0].upload, frozen);
  assert.equal(engine.status().entityConflict.id, conflict.id);
  assert.equal(workspace.knowledge.noteService.getNote(other.id).rawMarkdown, '本地分支');
});

test('真实服务附带本批未修改的历史去重 alias 时，正常收藏同步不误暂停', async t => {
  const cloud = await fixture(t);
  const original = cloud.dataStore.state.noteVersions.find(version => version.noteId === cloud.note.id);
  assert(original);
  cloud.dataStore.runTransaction(() => {
    cloud.dataStore.state.noteVersions.push({ ...structuredClone(original), id: 'synthetic-duplicate-history' });
  });
  await cloud.engine.sync();
  cloud.a.knowledge.noteService.updateNote(cloud.note.id, { favorite: true });
  await cloud.engine.sync();
  assert.equal(cloud.engine.status().error, null);
  assert.equal(cloud.engine.status().phase, 'synced');
  assert.equal(cloud.a.knowledge.noteService.getNote(cloud.note.id).favorite, true);
  assert.equal(cloud.knowledge.noteService.getNote(cloud.note.id).favorite, true);
});

test('无法识别的 422 不能作为未执行证明，不清理原请求', async t => {
  let writes = 0;
  const cloud = await fixture(t, async (url, init) => {
    const response = await fetch(url, init);
    if (url.endsWith('/batch')) {
      writes++;
      return new Response(JSON.stringify({ error: { message: '合成无法识别的错误封装' } }), { status: 422 });
    }
    return response;
  });
  cloud.a.knowledge.noteService.updateNote(cloud.note.id, { favorite: true });
  await cloud.engine.sync();
  const frozen = cloud.meta('entityUpload');
  assert(frozen);
  cloud.a.knowledge.noteService.updateNote(cloud.note.id, { favorite: false });
  await cloud.engine.retry();
  assert.equal(writes, 1);
  assert.equal(cloud.engine.status().error.code, 'SYNC_RESULT_UNCERTAIN');
  assert.deepEqual(cloud.meta('entityUpload'), frozen);
  assert.equal(cloud.a.knowledge.noteService.getNote(cloud.note.id).favorite, false);
});
