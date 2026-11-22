import assert from 'node:assert/strict';
import { once } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { createAppContext } from '../../api/src/app.factory.ts';
import { createFileDataStore } from '../../api/src/infrastructure/file-data-store.ts';
import { createServer } from '../../api/src/server.ts';
import { startLocalRuntime } from '../src/runtime-server.mjs';
import { readMeta } from '../src/sync-state.mjs';
import { temporaryDirectory } from './helpers.mjs';

test('桌面自建空间原子排队，兼容云端同步；旧端和同名冲突保留两端资料', async t => {
  const root = temporaryDirectory(t);
  const distRoot = path.join(root, 'dist');
  fs.mkdirSync(distRoot);
  fs.writeFileSync(path.join(distRoot, 'index.html'), '<html><head></head><body>Knowra</body></html>');
  const cloud = createAppContext({
    dataStore: createFileDataStore(path.join(root, 'cloud.json')),
    storageRootDir: root
  });
  cloud.http.knowledge.createDefaultKnowledgeSpace();
  const server = createServer({ appContext: cloud, logger: { error() {} } });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  const serverUrl = `http://127.0.0.1:${server.address().port}`;
  const spaces = '/api/knowledge/spaces';
  const sync = '/api/local-runtime/sync';

  async function desktop(name, adaptStatus) {
    let batches = 0;
    const runtime = await startLocalRuntime({
      dataDirectory: path.join(root, name),
      distRoot,
      syncOptions: {
        autoSync: false,
        async fetcher(url, options) {
          if (String(url).endsWith('/batch')) batches++;
          const response = await fetch(url, options);
          if (!adaptStatus || !String(url).endsWith('/status')) return response;
          const payload = await response.json();
          adaptStatus(payload.data);
          return Response.json(payload, { status: response.status });
        }
      }
    });
    t.after(() => runtime.close());
    const cookie = (await fetch(runtime.launchUrl, { redirect: 'manual' })).headers.get('set-cookie').split(';')[0];
    async function call(route, body, method = body === undefined ? 'GET' : 'POST') {
      const response = await fetch(`${runtime.origin}${route}`, {
        method,
        headers: {
          Cookie: cookie,
          'Content-Type': 'application/json',
          'X-Knowra-Dataset': runtime.store.getStatus().datasetId
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) })
      });
      return { status: response.status, ...(await response.json()) };
    }
    return { runtime, call, batchCount: () => batches };
  }

  const omitCapability = status => delete status.customSpaceCreation;
  let cloudDowngraded = false;
  const a = await desktop('a', status => {
    if (cloudDowngraded) omitCapability(status);
  });
  assert.equal((await a.call(sync)).data.customSpaceCreation, true);
  const primary = (await a.call(`${spaces}/default`, {})).data;
  const added = await a.call(spaces, { name: '等待同步', userId: 'ignored' });
  assert.equal(added.status, 201);
  assert.equal(added.data.defaultFlag, false);
  assert.equal(added.data.userId, 'demo');
  const changes = a.runtime.store
    .readOutbox()
    .find(op => op.changes.some(change => change.entityId === added.data.id)).changes;
  assert(changes.some(change => change.collection === 'tagGroups' && change.value.spaceId === added.data.id));
  const note = await a.call('/api/knowledge/notes', {
    spaceId: added.data.id,
    title: '自建空间内的离线笔记',
    rawMarkdown: '合成笔记内容'
  });
  assert.equal(note.status, 201, JSON.stringify(note));
  const target = await a.call(spaces, { name: '预览用空目标' });
  assert.equal(target.status, 201);
  const outboxBefore = a.runtime.store.readOutbox();
  const preview = await a.call(`${spaces}/${added.data.id}/migration-preview?targetSpaceId=${target.data.id}`);
  assert.equal(preview.status, 200, JSON.stringify(preview));
  assert.equal(preview.data.counts.notes, 1);
  assert.equal(preview.data.decision, 'can-migrate');
  assert.deepEqual(a.runtime.store.readOutbox(), outboxBefore);
  assert.equal(a.runtime.store.state.notes.find(row => row.id === note.data.id)?.spaceId, added.data.id);
  assert.equal((await a.call(`${spaces}/${added.data.id}`, {}, 'DELETE')).status, 409);
  assert.equal((await a.call(`${spaces}/${added.data.id}/migrate`, {})).status, 409);
  assert.equal((await a.call(`${sync}/configure`, { serverUrl })).data.phase, 'synced');
  assert.equal(cloud.http.knowledge.listKnowledgeSpaces().find(space => space.id === added.data.id)?.name, '等待同步');
  assert.equal(cloud.http.knowledge.getNote({ id: note.data.id }).spaceId, added.data.id);

  const later = await a.call(spaces, { name: '后续云端升级' });
  assert.equal(later.status, 201);
  const held = await a.call('/api/knowledge/notes', {
    spaceId: later.data.id,
    title: '随空间暂缓',
    rawMarkdown: '留在本机'
  });
  const independentNote = await a.call('/api/knowledge/notes', {
    spaceId: primary.id,
    title: '默认空间',
    rawMarkdown: '先上传'
  });
  assert.equal(held.status, 201);
  assert.equal(independentNote.status, 201);
  cloudDowngraded = true;
  const beforeDowngrade = a.batchCount();
  const unavailable = (await a.call(`${sync}/retry`, {})).data;
  assert.equal(unavailable.error.code, 'SYNC_CUSTOM_SPACE_UNSUPPORTED');
  assert(a.batchCount() > beforeDowngrade);
  assert.equal(cloud.http.knowledge.getNote({ id: independentNote.data.id }).rawMarkdown, '先上传');
  assert(!cloud.dataStore.state.spaces.some(row => row.id === later.data.id));
  assert(!cloud.dataStore.state.notes.some(row => row.id === held.data.id));
  const afterIndependent = a.batchCount();
  await a.call(`${sync}/retry`, {});
  assert.equal(a.batchCount(), afterIndependent);
  assert.equal(
    a.runtime.store.readSync(db => readMeta(db, 'entityUpload')),
    null
  );
  cloudDowngraded = false;
  assert.equal((await a.call(`${sync}/retry`, {})).data.phase, 'synced');
  assert(cloud.http.knowledge.listKnowledgeSpaces().some(space => space.id === later.data.id));

  assert.equal(cloud.http.knowledge.getNote({ id: held.data.id }).rawMarkdown, '留在本机');

  const old = await desktop('old', omitCapability);
  await old.call(spaces, { name: '仅本机留存' });
  assert.equal((await old.call(`${sync}/configure`, { serverUrl })).error.code, 'SYNC_CUSTOM_SPACE_UNSUPPORTED');
  assert.equal((await old.call(sync)).data.serverUrl, null);
  assert.equal(old.batchCount(), 0);
  assert.equal((await old.call(spaces)).data[0].name, '仅本机留存');
  const boundOld = await desktop('bound-old', omitCapability);
  assert.equal((await boundOld.call(`${sync}/configure`, { serverUrl })).data.customSpaceCreation, false);
  assert.equal((await boundOld.call(spaces, { name: '不应保存' })).error.code, 'LOCAL_CUSTOM_SPACE_UNAVAILABLE');
  assert(!boundOld.runtime.store.state.spaces.some(space => space.name === '不应保存'));

  const mismatch = await desktop('mismatch', status => {
    status.ownerId = 'another-owner';
  });
  await mismatch.call(spaces, { name: '不应交给其他所有者' });
  assert.equal((await mismatch.call(`${sync}/configure`, { serverUrl })).error.code, 'SYNC_CUSTOM_SPACE_UNSUPPORTED');
  assert.equal(mismatch.batchCount(), 0);

  const b = await desktop('b');
  const sameName = await b.call(spaces, { name: '等待同步' });
  const heldNote = await b.call('/api/knowledge/notes', {
    spaceId: sameName.data.id,
    title: '冲突空间的笔记',
    rawMarkdown: '保留在本机'
  });
  assert.equal(heldNote.status, 201);
  const conflicted = (await b.call(`${sync}/configure`, { serverUrl })).data;
  assert.equal(conflicted.error.code, 'KNOWLEDGE_SPACE_NAME_CONFLICT');
  assert.equal(conflicted.safetyPaused, false);
  const defaultSpace = await b.call(`${spaces}/default`, {});
  const independent = await b.call('/api/knowledge/notes', {
    spaceId: defaultSpace.data.id,
    title: '独立笔记',
    rawMarkdown: '应同步'
  });
  assert.equal(independent.status, 201);
  const retried = (await b.call(`${sync}/retry`, {})).data;
  assert.equal(retried.error.code, 'KNOWLEDGE_SPACE_NAME_CONFLICT');
  assert.equal(cloud.http.knowledge.getNote({ id: independent.data.id }).rawMarkdown, '应同步');
  assert(b.runtime.store.state.notes.some(row => row.id === heldNote.data.id && row.spaceId === sameName.data.id));
  assert(!cloud.dataStore.state.notes.some(row => row.id === heldNote.data.id));
  const sentBatches = b.batchCount();
  await b.call(`${sync}/retry`, {});
  assert.equal(b.batchCount(), sentBatches);
  assert(b.runtime.store.state.spaces.some(space => space.id === sameName.data.id));
  assert.deepEqual(
    cloud.http.knowledge
      .listKnowledgeSpaces()
      .filter(space => space.name === '等待同步')
      .map(space => space.id),
    [added.data.id]
  );
});
