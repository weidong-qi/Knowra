import assert from 'node:assert/strict';
import path from 'node:path';
import { once } from 'node:events';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { createFileDataStore } from '../../api/src/infrastructure/file-data-store.ts';
import { createAppContext } from '../../api/src/app.factory.ts';
import { createServer } from '../../api/src/server.js';
import { createSyncEngine } from '../src/sync-engine.mjs';
import { createAttachmentTransfer } from '../../api/src/modules/sync/attachment-transfer.ts';
import { syncContract } from '../../api/src/modules/sync/protocol-contract.ts';
import { noteContent } from '../../api/src/modules/sync/journal.ts';
import { writeJsonFileAtomically } from '../../api/src/infrastructure/atomic-json-file.ts';
import { readMeta, writeMeta } from '../src/sync-state.mjs';
import { openWorkspace, temporaryDirectory, markText, inlineId } from './helpers.mjs';

function fullEngine(workspace, directory, options = {}) {
  const entityTransfer = createAttachmentTransfer({
    uploadsDir: path.join(directory, 'uploads'),
    storageRootDir: directory
  });
  return createSyncEngine(workspace.store, {
    autoSync: false,
    noteService: workspace.knowledge.noteService,
    entityTransfer,
    ...options
  });
}

function noteConflict(engine, noteId) {
  const conflict = engine.status().entityConflict;
  assert(conflict, '应保留完整实体冲突');
  const item = conflict.items.find(item => item.collection === 'notes' && item.id === noteId);
  assert(item, '实体冲突中应保留该笔记的三份快照');
  return { ...item, conflictId: conflict.id };
}

async function fixture(t, options = {}) {
  const root = temporaryDirectory(t);
  const dataStore = createFileDataStore(path.join(root, 'cloud.json'), options);
  const context = createAppContext({ dataStore, uploadsDir: path.join(root, 'uploads'), storageRootDir: root });
  const knowledge = context.modules.knowledge;
  const space = knowledge.knowledgeSpaceService.createDefaultKnowledgeSpace({ userId: 'demo' });
  const note = knowledge.noteService.createNote({ title: '同步样本', rawMarkdown: '共同基线', spaceId: space.id });
  const server = createServer({ appContext: context, logger: { error() {} } });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`;
  t.after(() => new Promise(resolve => server.close(resolve)));
  function device(name, fetcher) {
    const directory = path.join(root, name);
    const workspace = openWorkspace(directory);
    const engine = fullEngine(workspace, directory, { fetcher });
    t.after(async () => {
      await engine.close();
      workspace.store.close();
    });
    return { ...workspace, engine, connect: () => engine.configure({ serverUrl: origin }) };
  }
  return { root, dataStore, context, knowledge, space, note, origin, device };
}

test('真实 HTTP：网页、两个 SQLite 设备收敛；同事务版本日志与稳定修订', async t => {
  const cloud = await fixture(t);
  const a = cloud.device('a');
  const b = cloud.device('b');
  await a.connect();
  await b.connect();
  assert.equal(a.engine.status().error, null);
  assert.equal(a.knowledge.noteService.getNote(cloud.note.id).rawMarkdown, '共同基线');
  a.knowledge.noteService.updateNote(cloud.note.id, { rawMarkdown: '设备 A 离线正文' });
  await a.engine.sync();
  await b.engine.sync();
  assert.equal(a.engine.status().error, null);
  assert.equal(b.knowledge.noteService.getNote(cloud.note.id).rawMarkdown, '设备 A 离线正文');
  const remote = cloud.knowledge.noteService.getNote(cloud.note.id);
  const response = await fetch(`${cloud.origin}/api/knowledge/notes/${remote.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rawMarkdown: '网页更新', expectedUpdatedAt: remote.updatedAt })
  });
  assert.equal(response.status, 200);
  await a.engine.sync();
  await b.engine.sync();
  assert.equal(a.knowledge.noteService.getNote(remote.id).rawMarkdown, '网页更新');
  assert.equal(b.knowledge.noteService.getNote(remote.id).rawMarkdown, '网页更新');
  assert.equal(a.engine.status().pendingEntities, 0);
  const last = cloud.dataStore.getSyncJournal().changes.at(-1).items;
  assert(last.some(item => item.collection === 'notes'));
  assert(last.some(item => item.collection === 'noteVersions'));
  const stale = await fetch(`${cloud.origin}/api/knowledge/notes/${remote.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rawMarkdown: '旧客户端覆盖' })
  });
  assert.equal(stale.status, 428);
});

test('同步连接错误区分网络、超时与登录失败，恢复后清除错误', async t => {
  const cloud = await fixture(t);
  let responseMode = 'dns';
  const device = cloud.device('connection-errors', async (url, options) => {
    if (responseMode === 'dns') {
      throw new TypeError('fetch failed', {
        cause: Object.assign(new Error('name lookup failed'), { code: 'ENOTFOUND' })
      });
    }
    if (responseMode === 'timeout') throw new DOMException('request timed out', 'TimeoutError');
    if (responseMode === 'auth') return new Response(null, { status: 401 });
    if (responseMode === 'device')
      return new Response(
        JSON.stringify({ error: { code: 'SYNC_DEVICE_NOT_ENABLED', message: '此设备尚未获准同步。' } }),
        { status: 403 }
      );
    if (responseMode === 'offline') throw new TypeError('fetch failed');
    return fetch(url, options);
  });
  await assert.rejects(
    device.connect(),
    failure =>
      failure.code === 'SYNC_NETWORK_DNS' &&
      /无法解析云端服务地址/.test(failure.message) &&
      !failure.message.includes('fetch failed')
  );
  responseMode = 'timeout';
  await assert.rejects(
    device.connect(),
    failure => failure.code === 'SYNC_NETWORK_TIMEOUT' && /连接云端超时/.test(failure.message)
  );
  responseMode = 'auth';
  await assert.rejects(
    device.connect(),
    failure => failure.code === 'AUTH_REQUIRED' && /登录凭据/.test(failure.message)
  );
  responseMode = 'device';
  await assert.rejects(
    device.connect(),
    failure => failure.code === 'SYNC_DEVICE_NOT_ENABLED' && /设备尚未获准同步/.test(failure.message)
  );
  responseMode = 'online';
  await device.connect();
  responseMode = 'offline';
  await device.engine.sync();
  assert.equal(device.engine.status().phase, 'paused');
  assert.equal(device.engine.status().error.code, 'SYNC_NETWORK_UNAVAILABLE');
  assert.match(device.engine.status().error.message, /无法连接云端/);
  responseMode = 'online';
  await device.engine.sync();
  assert.equal(device.engine.status().phase, 'synced');
  assert.equal(device.engine.status().error, null);
});

test('同步传输接线在首次失败、重新配置和断开后读取当前连接凭据', async t => {
  const cloud = await fixture(t);
  const requests = [];
  let rejectConnection = true;
  const device = cloud.device('transport-connection', async (url, options) => {
    requests.push({ url, authorization: options.headers.Authorization, redirect: options.redirect });
    if (rejectConnection) return new Response(null, { status: 401 });
    return fetch(url, options);
  });
  const first = { serverUrl: cloud.origin, username: 'synthetic-user', password: 'first-synthetic-value' };
  await assert.rejects(device.engine.configure(first), error => error.code === 'AUTH_REQUIRED');
  assert.equal(requests[0].url, `${cloud.origin}/api/sync/status`);
  assert.equal(
    requests[0].authorization,
    `Basic ${Buffer.from('synthetic-user:first-synthetic-value').toString('base64')}`
  );
  assert.equal(
    device.store.readSync(db => readMeta(db, 'serverUrl')),
    null
  );
  rejectConnection = false;
  requests.length = 0;
  await device.engine.configure({ ...first, password: 'second-synthetic-value' });
  assert(requests.length > 1, '首次连接后的同步循环也应使用新凭据');
  for (const request of requests) {
    assert.equal(
      request.authorization,
      `Basic ${Buffer.from('synthetic-user:second-synthetic-value').toString('base64')}`
    );
    assert.equal(request.redirect, 'error');
  }
  await device.engine.disconnect();
  requests.length = 0;
  await device.engine.sync();
  assert.equal(requests.length, 0, '断开时不发起同步');
  await device.engine.configure({ serverUrl: cloud.origin });
  assert(requests.length > 1);
  assert(
    requests.every(request => request.authorization === undefined),
    '无用户名重新连接不能复用旧认证值'
  );
  assert.equal(device.engine.status().phase, 'synced');
});

test('丢失成功响应后持久暂停，不重发且保留发送期间的新编辑', async t => {
  const cloud = await fixture(t);
  let lose = true;
  let edited = false;
  const ids = [];
  const a = cloud.device('a', async (url, options) => {
    const response = await fetch(url, options);
    if (url.endsWith('/batch')) {
      ids.push(JSON.parse(options.body).operationId);
      if (!edited) {
        edited = true;
        a.knowledge.noteService.updateNote(cloud.note.id, { rawMarkdown: '发送期间继续编辑' });
      }
      if (lose) {
        lose = false;
        throw new Error('模拟响应丢失');
      }
    }
    return response;
  });
  await a.connect();
  a.knowledge.noteService.updateNote(cloud.note.id, { rawMarkdown: '已发送的第一版' });
  await a.engine.sync();
  assert.equal(a.engine.status().phase, 'paused');
  assert.equal(cloud.knowledge.noteService.getNote(cloud.note.id).rawMarkdown, '已发送的第一版');
  await a.engine.sync();
  assert.equal(a.engine.status().error.code, 'SYNC_RESULT_UNCERTAIN');
  assert.equal(ids.length, 1);
  assert.equal(a.knowledge.noteService.getNote(cloud.note.id).rawMarkdown, '发送期间继续编辑');
  assert.equal(cloud.knowledge.noteService.getNote(cloud.note.id).rawMarkdown, '已发送的第一版');
  assert(a.engine.status().pendingEntities > 0);
  assert.equal(cloud.dataStore.state.noteVersions.filter(version => version.content === '已发送的第一版').length, 1);
});

test('双端冲突持久保留三份快照，其他笔记继续同步，手动合并后收敛', async t => {
  const cloud = await fixture(t);
  const a = cloud.device('a');
  const b = cloud.device('b');
  await a.connect();
  await b.connect();
  a.knowledge.noteService.updateNote(cloud.note.id, { rawMarkdown: '本地分支 A' });
  b.knowledge.noteService.updateNote(cloud.note.id, { rawMarkdown: '本地分支 B' });
  await b.engine.sync();
  await a.engine.sync();
  const conflict = noteConflict(a.engine, cloud.note.id);
  assert.equal(conflict.base.rawMarkdown, '共同基线');
  assert.equal(conflict.local.rawMarkdown, '本地分支 A');
  assert.equal(conflict.remote.rawMarkdown, '本地分支 B');
  a.knowledge.noteService.createNote({ title: '独立笔记', rawMarkdown: '仍可上传', spaceId: cloud.space.id });
  await a.engine.sync();
  assert(cloud.dataStore.state.notes.some(note => note.title === '独立笔记'));
  await a.engine.resolve({ conflictId: conflict.conflictId, choice: 'manual', rawMarkdown: '合并 A 与 B' });
  await b.engine.sync();
  assert.equal(a.engine.status().error, null);
  assert.equal(a.engine.status().entityConflict, null);
  assert.equal(b.knowledge.noteService.getNote(cloud.note.id).rawMarkdown, '合并 A 与 B');
  assert.equal(
    a.store.readSync(db => db.prepare('SELECT COUNT(*) AS n FROM sync_recovery').get().n),
    1
  );
});

test('软删除与编辑冲突；永久删除的旧设备保留副本且不会复活旧 ID', async t => {
  const cloud = await fixture(t);
  const a = cloud.device('a');
  const clean = cloud.device('clean');
  await a.connect();
  await clean.connect();
  a.knowledge.noteService.updateNote(cloud.note.id, { rawMarkdown: '必须保留的离线内容' });
  cloud.knowledge.noteService.deleteNote(cloud.note.id);
  await a.engine.sync();
  assert.equal(noteConflict(a.engine, cloud.note.id).remote.deleted, true);
  cloud.context.http.knowledge.permanentlyDeleteNote({ id: cloud.note.id });
  await a.engine.sync();
  await clean.engine.sync();
  assert.equal(clean.engine.status().error, null);
  assert.equal(clean.store.state.notes.length, 0);
  const conflict = noteConflict(a.engine, cloud.note.id);
  assert.equal(conflict.remote, null);
  await assert.rejects(a.engine.resolve({ conflictId: conflict.conflictId, choice: 'local' }), /永久删除/);
  assert.equal(noteConflict(a.engine, cloud.note.id).local.rawMarkdown, '必须保留的离线内容');
  assert(
    a.engine
      .recovery()
      .find(record => record.kind === 'pending-local-data')
      .snapshot.notes.some(note => note.id === cloud.note.id && note.rawMarkdown === '必须保留的离线内容')
  );
  await a.engine.resolve({ conflictId: conflict.conflictId, choice: 'copy' });
  assert.equal(a.engine.status().error, null);
  assert.equal(a.engine.status().pendingEntities, 0);
  assert(!cloud.dataStore.state.notes.some(note => note.id === cloud.note.id));
  assert(cloud.dataStore.state.notes.some(note => note.rawMarkdown === '必须保留的离线内容'));
  const recovery = a.engine.recovery().find(record => record.kind === 'entity-conflict' && record.choice === 'copy');
  assert(recovery.local.notes.some(note => note.id === cloud.note.id && note.rawMarkdown === '必须保留的离线内容'));
  assert(
    recovery.local.noteVersions.some(
      version => version.noteId === cloud.note.id && version.content === '必须保留的离线内容'
    )
  );
});

test('快照固定分页、游标过期和世代变化保全本地分支；幂等 ID 不得换负载', async t => {
  const cloud = await fixture(t);
  const a = cloud.device('a');
  await a.connect();
  const service = cloud.context.http.sync;
  const start = service.bootstrap(syncContract());
  cloud.knowledge.noteService.updateNote(cloud.note.id, { rawMarkdown: '快照后的更新' });
  const page = service.snapshot({ ...syncContract(), snapshotId: start.snapshotId });
  assert.equal(page.entries.find(item => item.id === cloud.note.id).value.rawMarkdown, '共同基线');
  a.knowledge.noteService.updateNote(cloud.note.id, { rawMarkdown: '世代变化时未提交内容' });
  cloud.dataStore.commitImport(cloud.dataStore.exportSnapshot());
  await a.engine.sync();
  assert.equal(a.engine.status().error, null);
  assert.equal(noteConflict(a.engine, cloud.note.id).local.rawMarkdown, '世代变化时未提交内容');
  assert.throws(
    () => service.changes({ ...syncContract(), cursor: start.cursor }),
    error => error.code === 'DATASET_CHANGED'
  );
  const status = service.status();
  const current = service
    .snapshot({ ...syncContract(), snapshotId: service.bootstrap(syncContract()).snapshotId })
    .entries.find(item => item.id === cloud.note.id);
  const operation = {
    protocolVersion: 1,
    ...syncContract(),
    deviceId: a.store.getStatus().deviceId,
    operationId: randomUUID(),
    noteId: cloud.note.id,
    datasetEpoch: status.datasetEpoch,
    baseRevision: current.revision,
    value: noteContent(current.value)
  };
  const first = service.push(operation);
  assert.deepEqual(service.push(operation), first);
  assert.throws(
    () => service.push({ ...operation, value: { ...operation.value, rawMarkdown: '不同负载' } }),
    error => error.code === 'OPERATION_REUSED'
  );
});

test('JSON 云端提交失败回滚正文、版本、修订和幂等结果；原请求可重试', async t => {
  let fail = false;
  const cloud = await fixture(t, {
    writeJson: (...args) => {
      if (fail) throw new Error('磁盘故障');
      return writeJsonFileAtomically(...args);
    }
  });
  const a = cloud.device('failure-test');
  await a.connect();
  const service = cloud.context.http.sync;
  const start = service.bootstrap(syncContract());
  const entry = service
    .snapshot({ ...syncContract(), snapshotId: start.snapshotId })
    .entries.find(item => item.id === cloud.note.id);
  const operation = {
    protocolVersion: 1,
    ...syncContract(),
    deviceId: a.store.getStatus().deviceId,
    operationId: randomUUID(),
    noteId: cloud.note.id,
    datasetEpoch: start.datasetEpoch,
    baseRevision: entry.revision,
    value: { ...noteContent(cloud.note), rawMarkdown: '事务内容' }
  };
  const before = JSON.stringify({ state: cloud.dataStore.state, journal: cloud.dataStore.getSyncJournal() });
  fail = true;
  assert.throws(
    () => service.push(operation),
    failure => failure.code === 'STORAGE_WRITE_FAILED'
  );
  assert.equal(JSON.stringify({ state: cloud.dataStore.state, journal: cloud.dataStore.getSyncJournal() }), before);
  fail = false;
  assert.equal(service.push(operation).status, 'accepted');
});

test('未确认的新建被云端删除并换 epoch 后仍暂停保留本地，不复活云端', async t => {
  const cloud = await fixture(t);
  let lose = true;
  const a = cloud.device('a', async (url, options) => {
    const response = await fetch(url, options);
    if (url.endsWith('/batch') && lose) {
      lose = false;
      throw new Error('丢失新建确认');
    }
    return response;
  });
  await a.connect();
  const created = a.knowledge.noteService.createNote({
    title: '未确认的新建',
    rawMarkdown: '保留副本',
    spaceId: cloud.space.id
  });
  await a.engine.sync();
  cloud.knowledge.noteService.deleteNote(created.id);
  cloud.context.http.knowledge.permanentlyDeleteNote({ id: created.id });
  cloud.dataStore.commitImport(cloud.dataStore.exportSnapshot());
  await a.engine.sync();
  assert.equal(a.engine.status().error.code, 'SYNC_RESULT_UNCERTAIN');
  assert.equal(a.knowledge.noteService.getNote(created.id).rawMarkdown, '保留副本');
  assert(!cloud.dataStore.state.notes.some(note => note.id === created.id));
});

test('游标过期重建快照，最后一页已下载的恢复点无需重复请求', async t => {
  const cloud = await fixture(t);
  let snapshotRequests = 0;
  const a = cloud.device('a', (url, options) => {
    if (new URL(url).pathname === '/api/sync/snapshot') snapshotRequests++;
    return fetch(url, options);
  });
  await a.connect();
  cloud.knowledge.noteService.updateNote(cloud.note.id, { rawMarkdown: '过期后恢复的内容' });
  cloud.dataStore.runSyncTransaction(() => {
    cloud.dataStore.getSyncJournal().floor = cloud.dataStore.getSyncJournal().head;
  });
  await a.engine.sync();
  assert.equal(a.engine.status().error.code, 'CURSOR_EXPIRED');
  const start = cloud.context.http.sync.bootstrap(syncContract());
  const page = cloud.context.http.sync.snapshot({ ...syncContract(), snapshotId: start.snapshotId });
  a.store.syncTransaction(db => writeMeta(db, 'bootstrap', { ...start, entries: page.entries, offset: null }));
  const downloaded = snapshotRequests;
  await a.engine.sync();
  assert.equal(a.engine.status().error, null);
  assert.equal(a.knowledge.noteService.getNote(cloud.note.id).rawMarkdown, '过期后恢复的内容');
  assert.equal(
    a.store.readSync(db => readMeta(db, 'bootstrap')),
    null
  );
  assert.equal(snapshotRequests, downloaded, '已完整下载的恢复点不能重新请求快照页');
});

test('SQLite 拉取提交失败不推进游标、不覆盖本地正文，修复后可以继续', async t => {
  const cloud = await fixture(t);
  let fail = false;
  let workspace;
  workspace = openWorkspace(path.join(cloud.root, 'disk-failure'), {
    beforeCommit: () => {
      if (fail && workspace.store.state.notes.some(note => note.rawMarkdown === '远端新正文'))
        throw new Error('拉取落盘失败');
    }
  });
  const engine = fullEngine(workspace, path.join(cloud.root, 'disk-failure'));
  t.after(async () => {
    await engine.close();
    workspace.store.close();
  });
  await engine.configure({ serverUrl: cloud.origin });
  const cursor = workspace.store.readSync(db => readMeta(db, 'cursor'));
  cloud.knowledge.noteService.updateNote(cloud.note.id, { rawMarkdown: '远端新正文' });
  fail = true;
  await engine.sync();
  assert.equal(workspace.knowledge.noteService.getNote(cloud.note.id).rawMarkdown, '共同基线');
  assert.equal(
    workspace.store.readSync(db => readMeta(db, 'cursor')),
    cursor
  );
  fail = false;
  await engine.sync();
  assert.equal(engine.status().error, null);
  assert.equal(workspace.knowledge.noteService.getNote(cloud.note.id).rawMarkdown, '远端新正文');
});

test('采用云端与保留两篇都有可导出的恢复记录；再次并发必须重新处理', async t => {
  const cloud = await fixture(t);
  const a = cloud.device('a');
  await a.connect();
  for (const choice of ['remote', 'copy']) {
    a.knowledge.noteService.updateNote(cloud.note.id, { rawMarkdown: `本地 ${choice}` });
    cloud.knowledge.noteService.updateNote(cloud.note.id, { rawMarkdown: `云端 ${choice}` });
    await a.engine.sync();
    const conflict = noteConflict(a.engine, cloud.note.id);
    await a.engine.resolve({ conflictId: conflict.conflictId, choice });
    assert.equal(a.engine.status().error, null);
    assert.equal(a.knowledge.noteService.getNote(cloud.note.id).rawMarkdown, `云端 ${choice}`);
    if (choice === 'copy')
      assert(cloud.dataStore.state.notes.some(note => note.id !== cloud.note.id && note.rawMarkdown === '本地 copy'));
  }
  assert.equal(a.engine.recovery().filter(record => record.kind === 'entity-conflict').length, 2);
  a.knowledge.noteService.updateNote(cloud.note.id, { rawMarkdown: '本地解决意图' });
  cloud.knowledge.noteService.updateNote(cloud.note.id, { rawMarkdown: '云端第一次变化' });
  await a.engine.sync();
  const conflict = noteConflict(a.engine, cloud.note.id);
  cloud.knowledge.noteService.updateNote(cloud.note.id, { rawMarkdown: '处理期间的第二次变化' });
  await a.engine.resolve({ conflictId: conflict.conflictId, choice: 'local' });
  assert.equal(noteConflict(a.engine, cloud.note.id).remote.rawMarkdown, '处理期间的第二次变化');
  assert.equal(cloud.knowledge.noteService.getNote(cloud.note.id).rawMarkdown, '处理期间的第二次变化');
});

test('关闭并重新打开 SQLite 后，未确认请求仍暂停且不重发', async t => {
  const cloud = await fixture(t);
  const ids = [];
  let lose = true;
  const fetcher = async (url, options) => {
    const result = await fetch(url, options);
    if (url.endsWith('/batch')) {
      ids.push(JSON.parse(options.body).operationId);
      if (lose) {
        lose = false;
        throw new Error('重启前响应丢失');
      }
    }
    return result;
  };
  const directory = path.join(cloud.root, 'restart');
  let workspace = openWorkspace(directory);
  let engine = fullEngine(workspace, directory, { fetcher });
  t.after(async () => {
    await engine.close();
    workspace.store.close();
  });
  await engine.configure({ serverUrl: cloud.origin });
  workspace.knowledge.noteService.updateNote(cloud.note.id, { rawMarkdown: '重启后继续确认' });
  await engine.sync();
  await engine.close();
  workspace.store.close();
  workspace = openWorkspace(directory);
  engine = fullEngine(workspace, directory, { fetcher });
  await engine.sync();
  assert.equal(engine.status().error.code, 'SYNC_RESULT_UNCERTAIN');
  assert.equal(ids.length, 1);
  assert(engine.status().pendingEntities > 0);
  assert.equal(workspace.knowledge.noteService.getNote(cloud.note.id).rawMarkdown, '重启后继续确认');
  assert(workspace.store.readOutbox().some(row => row.state !== 'acknowledged'));
});

test('冻结目录冲突丢响应后暂停整个同步，保留关联与独立笔记', async t => {
  const cloud = await fixture(t);
  let lose = true;
  const ids = [];
  const results = [];
  const folder = cloud.knowledge.folderService.createFolder({ spaceId: cloud.space.id, name: '共同目录' });
  const a = cloud.device('a', async (url, options) => {
    const batch = url.endsWith('/batch');
    if (batch) {
      ids.push(JSON.parse(options.body).operationId);
      if (lose) cloud.knowledge.folderService.updateFolder(folder.id, { name: '云端并发目录' });
    }
    const response = await fetch(url, options);
    if (batch) results.push((await response.clone().json()).data?.status);
    if (batch && lose) {
      lose = false;
      throw new Error('丢失目录冲突响应');
    }
    return response;
  });
  await a.connect();
  a.knowledge.folderService.updateFolder(folder.id, { name: '本地目录' });
  const blocked = a.knowledge.noteService.createNote({
    title: '等待目录的笔记',
    rawMarkdown: '不丢失',
    spaceId: cloud.space.id,
    folderId: folder.id
  });
  await a.engine.sync();
  assert.equal(a.engine.status().phase, 'paused');
  assert.equal(results[0], 'conflict', '必须由真实云端检测目录修订冲突');
  assert(!cloud.dataStore.state.notes.some(note => note.id === blocked.id), '冲突组不能部分接纳笔记');
  assert(
    a.store.readSync(db => readMeta(db, 'entityUpload')),
    '丢响应后应保留冻结请求'
  );
  a.knowledge.noteService.createNote({ title: '没有依赖的笔记', rawMarkdown: '继续同步', spaceId: cloud.space.id });
  await a.engine.sync();
  assert.equal(a.engine.status().error.code, 'SYNC_RESULT_UNCERTAIN');
  assert.equal(ids.length, 1, '未知结果不得以原 ID 或新 ID 再提交');
  assert.equal(a.knowledge.noteService.getNote(blocked.id).rawMarkdown, '不丢失');
  assert(a.store.state.notes.some(note => note.title === '没有依赖的笔记'));
  assert(!cloud.dataStore.state.notes.some(note => note.title === '没有依赖的笔记'));
  a.knowledge.noteService.updateNote(blocked.id, { folderId: null });
  await a.engine.retry();
  assert.equal(a.engine.status().error.code, 'SYNC_RESULT_UNCERTAIN');
  assert.equal(ids.length, 1);
  assert.equal(a.knowledge.noteService.getNote(blocked.id).folderId, null);
});

test('已有标注与知识证据随正文事务同步，保持不可变来源引用和失效状态', async t => {
  const cloud = await fixture(t);
  const plain = cloud.note.rawMarkdown;
  cloud.knowledge.noteService.updateNote(cloud.note.id, {
    rawMarkdown: `${markText(plain.slice(0, 4), 'sync-source')}${plain.slice(4)}`
  });
  const annotation = cloud.knowledge.contentAnnotationService.getAnnotation(inlineId(cloud.note.id, 'sync-source'));
  cloud.knowledge.knowledgeItemService.createCandidate({
    title: '来源同步验证',
    canonicalStatement: '保持已有来源关系',
    sourceMode: 'selection',
    evidence: [{ sourceType: 'annotation', annotationId: annotation.id }]
  });
  const a = cloud.device('a');
  await a.connect();
  assert.equal(a.engine.status().error, null);
  a.knowledge.noteService.updateNote(cloud.note.id, { rawMarkdown: '' });
  await a.engine.sync();
  assert.equal(a.engine.status().error, null);
  assert.equal(a.store.state.contentAnnotations[0].anchorStatus, 'missing');
  assert.equal(
    a.store.state.contentAnnotations[0].anchorStatus,
    cloud.dataStore.state.contentAnnotations[0].anchorStatus
  );
  assert.equal(a.store.state.knowledgeEvidence[0].status, 'insufficient');
  assert.equal(a.store.state.knowledgeEvidence[0].status, cloud.dataStore.state.knowledgeEvidence[0].status);
  assert(a.store.state.noteVersions.some(version => version.id === a.store.state.knowledgeEvidence[0].noteVersionId));
  const items = cloud.dataStore.getSyncJournal().changes.at(-1).items;
  assert(items.some(item => item.collection === 'contentAnnotations'));
  assert(items.some(item => item.collection === 'knowledgeEvidence'));
});
