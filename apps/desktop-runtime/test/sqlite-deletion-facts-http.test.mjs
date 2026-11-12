import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { once } from 'node:events';
import test from 'node:test';
import { createAppContext } from '../../api/src/app.factory.js';
import { createServer } from '../../api/src/server.js';
import { createUnavailableAiRuntime } from '../../api/src/modules/ai/runtime.ts';
import { createSqliteDataStore } from '../src/sqlite-data-store.mjs';
import { startLocalRuntime } from '../src/runtime-server.mjs';
import { temporaryDirectory } from './helpers.mjs';

const conflict = {
  error: {
    code: 'LOCAL_DELETION_FACT_CONFLICT',
    message: '已永久删除的对象不能用原 ID 重新写入；原数据和删除事实已保留。'
  }
};

function rows(store) {
  return store.readSync(db =>
    Object.fromEntries(
      ['entities', 'local_revisions', 'sync_outbox', 'deletion_facts', 'metadata'].map(table => [
        table,
        db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()
      ])
    )
  );
}

async function fixture(t, { desktop = false } = {}) {
  const root = temporaryDirectory(t);
  let store, origin, cookie;
  if (desktop) {
    const distRoot = path.join(root, 'dist');
    fs.mkdirSync(distRoot);
    fs.writeFileSync(path.join(distRoot, 'index.html'), '<html><body>合成 C1 HTTP 验证</body></html>');
    const runtime = await startLocalRuntime({
      dataDirectory: path.join(root, 'data'),
      distRoot,
      syncOptions: { autoSync: false },
      logger: { error() {}, warn() {} },
      aiRuntimeFactory: () => createUnavailableAiRuntime('合成验证关闭 AI。')
    });
    t.after(() => runtime.close());
    store = runtime.store;
    origin = runtime.origin;
    const session = await fetch(runtime.launchUrl, { redirect: 'manual' });
    assert.equal(session.status, 303);
    cookie = session.headers.get('set-cookie').split(';')[0];
  } else {
    store = createSqliteDataStore(path.join(root, 'local.sqlite'));
    t.after(() => store.close());
    const app = createAppContext({
      dataStore: store,
      ownerId: 'demo',
      storageRootDir: root,
      uploadsDir: path.join(root, 'uploads')
    });
    const server = createServer({ appContext: app, logger: { error() {} } });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    t.after(() => new Promise(resolve => server.close(resolve)));
    origin = `http://127.0.0.1:${server.address().port}`;
  }
  async function call(route, method = 'GET', body) {
    const response = await fetch(`${origin}${route}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(cookie ? { Cookie: cookie, 'X-Knowra-Dataset': store.getStatus().datasetId } : {})
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    });
    return { status: response.status, body: await response.json() };
  }
  const created = await call('/api/knowledge/spaces/default', 'POST', {});
  assert.equal(created.status, 201, JSON.stringify(created));
  return { store, call, space: created.body.data };
}

test('C1 API HTTP 旧快照导入返回删除冲突并保留数据/事实/队列，合法新 ID 导入成功', async t => {
  const { store, call, space } = await fixture(t);
  const input = { id: 'synthetic-http-import-deleted', name: '合成已删除标签', spaceId: space.id };
  assert.equal((await call('/api/knowledge/tags', 'POST', input)).status, 201);
  const exported = await call('/api/storage/export');
  assert.equal(exported.status, 200);
  const oldSnapshot = exported.body.data;
  assert(oldSnapshot.data.tags.some(record => record.id === input.id));
  assert.equal((await call(`/api/knowledge/tags/${input.id}`, 'DELETE')).status, 200);
  assert.equal(store.deletionFacts.has('tags', input.id), true);
  const before = rows(store),
    data = store.exportSnapshot().data;
  assert(before.sync_outbox.length > 0);
  const rejected = await call('/api/storage/import', 'POST', oldSnapshot);
  assert.deepEqual(rows(store), before);
  assert.deepEqual(store.exportSnapshot().data, data);
  t.diagnostic(
    JSON.stringify({
      entry: 'API createServer + SQLite',
      route: 'POST /api/storage/import',
      response: rejected,
      dataFactsQueueUnchanged: true
    })
  );
  assert.equal(rejected.status, 409, JSON.stringify(rejected));
  assert.deepEqual(rejected.body, conflict);

  const legalSnapshot = (await call('/api/storage/export')).body.data;
  const newTag = { id: 'synthetic-http-import-new', name: '合成合法导入标签', spaceId: space.id, isSystem: false };
  legalSnapshot.data.tags.push(newTag);
  const accepted = await call('/api/storage/import', 'POST', legalSnapshot);
  assert.equal(accepted.status, 200, JSON.stringify(accepted));
  assert(store.state.tags.some(record => record.id === newTag.id));
  assert(!store.state.tags.some(record => record.id === input.id));
  assert.deepEqual(accepted.body.data.data, store.exportSnapshot().data);
  assert.deepEqual(rows(store).deletion_facts, before.deletion_facts);
  t.diagnostic('合法新 ID 快照实际 POST 导入为 200；既有删除事实保持。');
});

test('C1 desktop HTTP 已开放标签入口同 ID 重建返回删除冲突，业务导入仍受本地 policy 限制', async t => {
  const { store, call, space } = await fixture(t, { desktop: true });
  const input = { id: 'synthetic-desktop-deleted', name: '合成桌面标签', spaceId: space.id };
  assert.equal((await call('/api/knowledge/tags', 'POST', input)).status, 201);
  const exported = await call('/api/storage/export');
  assert.equal(exported.status, 200);
  assert.equal((await call(`/api/knowledge/tags/${input.id}`, 'DELETE')).status, 200);
  assert.equal(store.deletionFacts.has('tags', input.id), true);
  const before = rows(store),
    data = store.exportSnapshot().data;
  assert(before.sync_outbox.length > 0);
  const blockedImport = await call('/api/storage/import', 'POST', exported.body.data);
  assert.equal(blockedImport.status, 409);
  assert.equal(blockedImport.body.error.code, 'LOCAL_FEATURE_UNAVAILABLE');
  assert.deepEqual(rows(store), before);
  const rejected = await call('/api/knowledge/tags', 'POST', input);
  assert.deepEqual(rows(store), before);
  assert.deepEqual(store.exportSnapshot().data, data);
  t.diagnostic(
    JSON.stringify({
      entry: 'startLocalRuntime + session + SQLite',
      route: 'POST /api/knowledge/tags',
      response: rejected,
      dataFactsQueueUnchanged: true,
      importPolicyCode: blockedImport.body.error.code
    })
  );
  assert.equal(rejected.status, 409, JSON.stringify(rejected));
  assert.deepEqual(rejected.body, conflict);

  const accepted = await call('/api/knowledge/tags', 'POST', { ...input, id: 'synthetic-desktop-new' });
  assert.equal(accepted.status, 201, JSON.stringify(accepted));
  assert.equal(accepted.body.data.id, 'synthetic-desktop-new');
  assert(!store.state.tags.some(record => record.id === input.id));
  assert.deepEqual(rows(store).deletion_facts, before.deletion_facts);
  t.diagnostic('同入口合法新 ID 标签实际 POST 创建为 201；既有删除事实保持。');
});
