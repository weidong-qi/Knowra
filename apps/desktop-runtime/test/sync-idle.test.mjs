import { syncContract } from '../../api/src/modules/sync/protocol-contract.ts';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  applyEntityRemote,
  getEntitySyncState,
  nextEntityUpload,
  acknowledgeEntityUpload
} from '../src/entity-sync-state.mjs';
import { createSyncEngine } from '../src/sync-engine.mjs';
import { readMeta, writeMeta } from '../src/sync-state.mjs';
import { openWorkspace, temporaryDirectory, createNote } from './helpers.mjs';

function fixture(t, count = 1, options) {
  const workspace = openWorkspace(temporaryDirectory(t), options);
  const { store } = workspace;
  t.after(() => store.close());
  const note = createNote(workspace);
  store.syncTransaction((db, state) => {
    const version = state.noteVersions.find(item => item.noteId === note.id);
    for (let index = 1; index < count; index++) {
      const id = `idle-note-${index}`;
      state.notes.push({ ...note, id });
      state.noteVersions.push({ ...version, id: `idle-version-${index}`, noteId: id });
    }
    const insert = db.prepare('INSERT OR REPLACE INTO sync_base VALUES (?, ?, ?, ?)');
    for (const [collection, items] of Object.entries(state))
      for (const value of items) insert.run(collection, value.id, 1, JSON.stringify(value));
    writeMeta(db, 'epoch', 'epoch');
    writeMeta(db, 'cursor', 'cursor');
    writeMeta(db, 'serverUrl', 'http://localhost');
    db.prepare("UPDATE sync_outbox SET state = 'acknowledged'").run();
  });
  return {
    ...workspace,
    note,
    rows: () => store.readSync(db => db.prepare('SELECT total_changes() AS count').get().count)
  };
}

function engineFor(t, workspace) {
  const engine = createSyncEngine(workspace.store, {
    autoSync: false,
    entityTransfer: {},
    fetcher: async url => {
      const data = url.endsWith('/status')
        ? { protocolVersion: 1, scope: 'notes', ...syncContract(), ownerId: 'demo', datasetEpoch: 'epoch' }
        : url.includes('/device?')
          ? { sequence: 0 }
          : { ...syncContract(), ownerId: 'demo', groups: [], cursor: 'cursor', datasetEpoch: 'epoch', hasMore: false };
      return new Response(JSON.stringify({ data }));
    }
  });
  t.after(() => engine.close());
  return engine;
}

for (const count of [3600, 7200])
  test(`${count * 2 + 1} 条基线：预热后空同步及状态查询零全量扫描、零行写入`, async t => {
    const f = fixture(t, count);
    const engine = engineFor(t, f);
    await engine.sync();
    engine.status();
    const beforeRows = f.rows();
    const beforeGeneration = engine.status().generation;
    const read = f.store.readSync;
    f.store.readSync = callback =>
      read((db, state) =>
        callback(
          new Proxy(db, {
            get(target, key) {
              if (key === 'prepare')
                return sql => {
                  assert.doesNotMatch(sql, /SELECT \* FROM sync_base/i, '空闲时不应重新读取全部基线');
                  return target.prepare(sql);
                };
              return Reflect.get(target, key, target);
            }
          }),
          state
        )
      );
    const original = { ...f.store.state };
    for (const [key, values] of Object.entries(original))
      f.store.state[key] = new Proxy(values, {
        get(target, property) {
          if (
            ['map', 'filter', 'find', 'forEach', 'reduce', 'slice'].includes(property) ||
            property === Symbol.iterator
          )
            throw new Error(`空闲扫描了 ${key}`);
          return Reflect.get(target, property);
        }
      });
    try {
      for (let round = 0; round < 20; round++) {
        await engine.sync();
        for (let poll = 0; poll < 10; poll++) assert.equal(engine.status().error, null);
      }
      assert.equal(f.rows(), beforeRows);
      assert.equal(engine.status().generation, beforeGeneration);
      assert.ok(engine.status().lastCheckedAt);
    } finally {
      Object.assign(f.store.state, original);
      f.store.readSync = read;
    }
  });

test('空闲同步仅请求状态；游标落后才拉取，有待传修改时才校准设备序号', async t => {
  const f = fixture(t);
  const urls = [];
  const engine = createSyncEngine(f.store, {
    autoSync: false,
    entityTransfer: {},
    fetcher: async url => {
      urls.push(new URL(url).pathname.replace('/api/sync/', ''));
      const data = url.endsWith('/status')
        ? {
            protocolVersion: 1,
            scope: 'notes',
            ...syncContract(),
            ownerId: 'demo',
            datasetEpoch: 'epoch',
            cursor: head
          }
        : url.includes('/device?')
          ? { sequence: 0 }
          : { ...syncContract(), ownerId: 'demo', groups: [], cursor: head, datasetEpoch: 'epoch', hasMore: false };
      return new Response(JSON.stringify({ data }));
    }
  });
  t.after(() => engine.close());
  let head = 'cursor';
  await engine.sync();
  assert.deepEqual(urls.splice(0), ['status']);
  head = 'cursor-2';
  await engine.sync();
  assert.deepEqual(urls.splice(0), ['status', 'changes']);
  f.knowledge.noteService.updateNote(f.note.id, { title: '待上传修改' });
  await engine.sync();
  assert.deepEqual(urls.splice(0).slice(0, 3), ['status', 'device', 'batch']);
});

test('空页只推进游标，重复实体与仅基线修订变化不刷新资料', t => {
  const f = fixture(t);
  const { store, note } = f;
  const generation = () => store.readSync(db => readMeta(db, 'generation'));
  const before = generation();
  const entityKey = store.getEntityCacheKey();
  assert.equal(applyEntityRemote(store, [], 'cursor-2', 'epoch'), true);
  assert.equal(store.getEntityCacheKey(), entityKey);
  assert.equal(generation(), before);
  const entry = { collection: 'notes', id: note.id, revision: 1, value: note };
  const rows = f.rows();
  applyEntityRemote(store, [entry], 'cursor-2', 'epoch');
  assert.equal(f.rows(), rows);
  applyEntityRemote(store, [{ ...entry, revision: 2 }], 'cursor-3', 'epoch');
  assert.equal(generation(), before);
  assert.equal(
    store.readSync(
      db =>
        db.prepare("SELECT server_revision FROM sync_base WHERE collection = 'notes' AND id = ?").get(note.id)
          .server_revision
    ),
    2
  );
});

test('冲突空页不反复写库；本地新编辑后重新计算，保留三份资料', t => {
  const f = fixture(t);
  const { store, note } = f;
  f.knowledge.noteService.updateNote(note.id, { title: '本地修改' });
  const entry = { collection: 'notes', id: note.id, revision: 2, value: { ...note, title: '云端修改' } };
  assert.equal(applyEntityRemote(store, [entry], 'conflict-cursor', 'epoch'), false);
  const before = f.rows();
  assert.equal(applyEntityRemote(store, [], 'conflict-cursor', 'epoch'), false);
  assert.equal(applyEntityRemote(store, [entry], 'conflict-cursor', 'epoch'), false);
  assert.equal(f.rows(), before);
  f.knowledge.noteService.updateNote(note.id, { title: '本地后续修改' });
  assert.equal(applyEntityRemote(store, [], 'conflict-cursor', 'epoch'), false);
  const item = getEntitySyncState(store).entityConflict.items.find(item => item.id === note.id);
  assert.equal(item.local.title, '本地后续修改');
  assert.equal(item.remote.title, '云端修改');
  assert.equal(item.base.title, note.title);
});

test('元数据事务无状态参数，同值不写；失败不改变版本或缓存', t => {
  let fail = false;
  const f = fixture(t, 1, {
    beforeCommit() {
      if (fail) throw new Error('注入失败');
    }
  });
  const { store } = f;
  const beforeStatus = getEntitySyncState(store);
  const key = store.getSyncCacheKey();
  const entityKey = store.getEntityCacheKey();
  const rows = f.rows();
  store.metadataTransaction((db, state) => {
    assert.equal(state, undefined);
    writeMeta(db, 'epoch', 'epoch');
  });
  assert.equal(f.rows(), rows);
  fail = true;
  assert.throws(() => store.metadataTransaction(db => writeMeta(db, 'cursor', 'bad')), /注入失败/);
  assert.equal(store.getSyncCacheKey(), key);
  assert.equal(store.getEntityCacheKey(), entityKey);
  assert.equal(getEntitySyncState(store), beforeStatus);
  assert.equal(
    store.readSync(db => readMeta(db, 'cursor')),
    'cursor'
  );
  assert.throws(() => store.metadataTransaction(async () => {}), /异步/);
});

test('关联校验失败后重复空页不能推进尚未接受的游标', t => {
  const f = fixture(t);
  const entry = { collection: 'notes', id: f.note.id, revision: 2, value: { ...f.note, spaceId: 'missing-space' } };
  assert.equal(applyEntityRemote(f.store, [entry], 'invalid-cursor', 'epoch'), false);
  const before = f.rows();
  assert.equal(applyEntityRemote(f.store, [], 'invalid-cursor', 'epoch'), false);
  assert.equal(f.rows(), before);
  assert.equal(
    f.store.readSync(db => readMeta(db, 'cursor')),
    'cursor'
  );
  assert.equal(f.knowledge.noteService.getNote(f.note.id).spaceId, f.note.spaceId);
});

test('缓存中的冲突快照不受失败事务内对象修改污染', t => {
  const f = fixture(t);
  f.knowledge.noteService.updateNote(f.note.id, { title: '本地标题' });
  applyEntityRemote(
    f.store,
    [{ collection: 'notes', id: f.note.id, revision: 2, value: { ...f.note, title: '云端标题' } }],
    'conflict-cursor',
    'epoch'
  );
  getEntitySyncState(f.store);
  assert.throws(
    () =>
      f.store.runTransaction(() => {
        f.store.state.notes.find(note => note.id === f.note.id).title = '失败修改';
        throw new Error('回滚');
      }),
    /回滚/
  );
  assert.equal(
    getEntitySyncState(f.store).entityConflict.items.find(item => item.id === f.note.id).local.title,
    '本地标题'
  );
});

test('本地提交通知仅在成功提交可同步修改后发出，失败不丢失缓存', t => {
  let fail = false;
  const f = fixture(t, 1, {
    beforeCommit() {
      if (fail) throw new Error('保存失败');
    }
  });
  let calls = 0;
  const unsubscribe = f.store.onLocalCommit(() => calls++);
  const key = f.store.getEntityCacheKey();
  getEntitySyncState(f.store);
  fail = true;
  assert.throws(() => f.knowledge.noteService.updateNote(f.note.id, { title: '失败修改' }), /保存失败/);
  assert.equal(calls, 0);
  assert.equal(f.store.getEntityCacheKey(), key);
  assert.equal(getEntitySyncState(f.store).pendingEntities, 0);
  fail = false;
  f.knowledge.noteService.updateNote(f.note.id, { title: '成功修改' });
  assert.equal(calls, 1);
  assert.ok(getEntitySyncState(f.store).pendingEntities);
  f.store.metadataTransaction(db => writeMeta(db, 'lastSyncedAt', 'now'));
  assert.equal(calls, 1);
  unsubscribe();
});

test('上传确认只写变化基线，保留无关行和并发新编辑', t => {
  const f = fixture(t, 20);
  f.knowledge.noteService.updateNote(f.note.id, { title: '已提交标题' });
  const operation = nextEntityUpload(f.store);
  const entries = operation.changes.map(entry => ({ ...entry, revision: 2 }));
  f.knowledge.noteService.updateNote(f.note.id, { title: '后续标题' });
  const untouched = f.store.readSync(db =>
    db.prepare("SELECT rowid, payload FROM sync_base WHERE id = 'idle-note-1'").get()
  );
  acknowledgeEntityUpload(f.store, operation, { status: 'accepted', entries });
  assert.deepEqual(
    f.store.readSync(db => db.prepare("SELECT rowid, payload FROM sync_base WHERE id = 'idle-note-1'").get()),
    untouched
  );
  assert.equal(f.knowledge.noteService.getNote(f.note.id).title, '后续标题');
  assert.ok(getEntitySyncState(f.store).pendingEntities);
});
