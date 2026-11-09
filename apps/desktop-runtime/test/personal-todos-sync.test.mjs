import assert from 'node:assert/strict';
import path from 'node:path';
import { once } from 'node:events';
import { test } from 'node:test';
import { createFileDataStore } from '../../api/src/infrastructure/file-data-store.js';
import { createAppContext } from '../../api/src/app.factory.js';
import { createServer } from '../../api/src/server.js';
import { createAttachmentTransfer } from '../../api/src/modules/sync/attachment-transfer.ts';
import { prepareBatchState } from '../../api/src/modules/sync/batch-domain.ts';
import { createPersonalTodoService, createStateBackedTodoStore } from '../../api/src/modules/personal-todos/service.ts';
import { createSyncEngine } from '../src/sync-engine.mjs';
import { selectEntityBatch } from '../src/entity-batches.mjs';
import { temporaryDirectory, openWorkspace } from './helpers.mjs';

async function fixture(t) {
  const root = temporaryDirectory(t);
  const store = createFileDataStore(path.join(root, 'cloud.json'));
  const context = createAppContext({ dataStore: store, uploadsDir: path.join(root, 'uploads'), storageRootDir: root });
  await context.modules.knowledge.knowledgeSpaceService.createDefaultKnowledgeSpace({ userId: 'demo' });
  const server = createServer({ appContext: context, logger: { error() {} } });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`;
  function device(name) {
    const directory = path.join(root, name);
    const target = {};
    const open = () => {
      Object.assign(target, openWorkspace(directory));
      target.todos = createPersonalTodoService({ store: createStateBackedTodoStore(target.store) });
      target.engine = createSyncEngine(target.store, {
        autoSync: false,
        fetcher: fetch,
        noteService: target.knowledge.noteService,
        entityTransfer: createAttachmentTransfer({
          uploadsDir: path.join(directory, 'uploads'),
          storageRootDir: directory
        })
      });
    };
    open();
    target.connect = () => target.engine.configure({ serverUrl: origin });
    target.restart = async () => {
      await target.engine.close();
      target.store.close();
      open();
    };
    target.rev = async id => (await target.todos.list()).find(todo => todo.id === id).revision;
    t.after(async () => {
      await target.engine.close();
      target.store.close();
    });
    return target;
  }
  return { store, context, device, cloudTodos: () => store.state.personalTodos };
}

function clean(device) {
  const status = device.engine.status();
  assert.equal(status.error, null, JSON.stringify(status));
  assert.equal(status.entityConflict, null, JSON.stringify(status));
  assert.equal(status.pendingEntities, 0, JSON.stringify(status));
}

const byId = todos => Object.fromEntries(todos.map(todo => [todo.id, todo]));

test('待办在两台 SQLite 设备之间通过真实 HTTP 收敛，暂停继承整批提交并跨重启保留', async t => {
  const cloud = await fixture(t);
  const a = cloud.device('a');
  const b = cloud.device('b');
  await a.connect();
  await b.connect();
  await a.todos.execute({ type: 'create', id: 'm1', parentId: null, kind: 'mainline', title: '完成分类项目' });
  await a.todos.execute({ type: 'create', id: 'c1', parentId: 'm1', title: '准备数据' });
  await a.todos.execute({ type: 'create', id: 'c2', parentId: 'm1', title: '训练模型' });
  await a.engine.sync();
  clean(a);
  await b.engine.sync();
  clean(b);
  assert.deepEqual(byId(await b.todos.list()), byId(cloud.cloudTodos()));

  await b.todos.execute({ type: 'pause', id: 'm1', expectedRevision: await b.rev('m1'), reason: '等数据' });
  await b.engine.sync();
  clean(b);
  const group = cloud.store
    .getSyncJournal()
    .changes.at(-1)
    .items.filter(item => item.collection === 'personalTodos');
  assert.deepEqual(group.map(item => item.id).sort(), ['c1', 'c2', 'm1']);

  await a.restart();
  await a.engine.sync();
  clean(a);
  const synced = byId(await a.todos.list());
  assert.equal(synced.m1.status, 'paused');
  assert.equal(synced.c2.pausedBy, 'parent');
});

test('两端改同一条待办形成实体冲突，只能采用本地或云端，不能保留两份', async t => {
  const cloud = await fixture(t);
  const a = cloud.device('a');
  const b = cloud.device('b');
  await a.connect();
  await b.connect();
  await a.todos.execute({ type: 'create', id: 's1', parentId: null, title: '办理报销' });
  await a.engine.sync();
  await b.engine.sync();
  await a.todos.execute({ type: 'update', id: 's1', expectedRevision: 1, patch: { title: '办理差旅报销' } });
  await b.todos.execute({ type: 'update', id: 's1', expectedRevision: 1, patch: { starred: true } });
  await a.engine.sync();
  clean(a);
  await b.engine.sync();
  const conflict = b.engine.status().entityConflict;
  assert(conflict, JSON.stringify(b.engine.status()));
  await assert.rejects(b.engine.resolve({ conflictId: conflict.id, choice: 'copy' }), /待办/);
  await b.engine.resolve({ conflictId: conflict.id, choice: 'remote' });
  await b.engine.sync();
  clean(b);
  const [todo] = await b.todos.list();
  assert.equal(todo.title, '办理差旅报销');
  assert.equal(todo.starred, false);
});

test('云端批次拒绝修改已归档待办、硬删除待办以及把未完成项放进已完成上级', () => {
  const at = '2026-11-09T02:00:00.000Z';
  const base = {
    parentId: null,
    kind: 'sideline',
    title: '归档支线',
    note: '',
    goal: '',
    order: 'V',
    starred: false,
    status: 'done',
    pausedBy: null,
    pauseReason: null,
    plannedDate: null,
    dueDate: null,
    completedAt: at,
    archivedAt: at,
    deletedAt: null,
    reminder: null,
    revision: 3,
    createdAt: at,
    updatedAt: at
  };
  const archived = { ...base, id: 'arch' };
  const done = { ...base, id: 'done', archivedAt: null };
  const store = createFileDataStore(path.join(temporaryDirectory({ after() {} }), 'cloud.json'));
  const state = { ...store.state, personalTodos: [archived, done] };
  const change = (id, value) => ({ collection: 'personalTodos', id, baseRevision: 1, value });
  assert.throws(
    () => prepareBatchState(state, [change('arch', { ...archived, title: '偷偷改名' })], 'demo'),
    error => error.code === 'TODO_ARCHIVED'
  );
  assert.throws(
    () => prepareBatchState(state, [change('done', null)], 'demo'),
    error => error.code === 'TODO_SYNC_DELETE_UNSUPPORTED'
  );
  const child = {
    ...base,
    id: 'child',
    parentId: 'done',
    kind: 'item',
    status: 'active',
    completedAt: null,
    archivedAt: null,
    revision: 1
  };
  assert.throws(() => prepareBatchState(state, [change('child', child)], 'demo'), /已完成上级/);
});

test('待办变更总在同一个同步批次内，避免整棵树被拆开校验', () => {
  const todo = (id, parentId) => ({ id, parentId, value: null });
  const changes = ['a', 'b', 'c'].map(id => ({
    collection: 'personalTodos',
    id,
    baseRevision: null,
    value: { ...todo(id, id === 'a' ? null : 'a'), deletedAt: null }
  }));
  const state = { contentAnnotations: [], noteVersions: [], personalTodos: changes.map(entry => entry.value) };
  const selected = selectEntityBatch(changes, state, new Map(), { targetEntries: 1, maxEntries: 10 });
  assert.equal(selected.length, 3);
});
