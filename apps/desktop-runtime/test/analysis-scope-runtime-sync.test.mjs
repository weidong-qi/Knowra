import assert from 'node:assert/strict';
import { once } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { createAppContext } from '../../api/src/app.factory.ts';
import { createFileDataStore } from '../../api/src/infrastructure/file-data-store.ts';
import { createServer } from '../../api/src/server.ts';
import { startLocalRuntime } from '../src/runtime-server.mjs';
import { temporaryDirectory } from './helpers.mjs';

test('桌面分析范围离线保存，经 SQLite outbox 同步到云端，回收和恢复后内容不变', async t => {
  const fixture = temporaryDirectory(t);
  const distRoot = path.join(fixture, 'dist');
  fs.mkdirSync(distRoot);
  fs.writeFileSync(path.join(distRoot, 'index.html'), '<html><head></head><body></body></html>');
  const desktop = await startLocalRuntime({
    dataDirectory: path.join(fixture, 'desktop'),
    distRoot,
    syncOptions: { autoSync: false }
  });
  t.after(() => desktop.close());
  const session = await fetch(desktop.launchUrl, { redirect: 'manual' });
  const cookie = session.headers.get('set-cookie').split(';')[0];
  async function local(route, status, method = 'GET', body) {
    const response = await fetch(`${desktop.origin}${route}`, {
      method,
      headers: {
        Cookie: cookie,
        'Content-Type': 'application/json',
        'X-Knowra-Dataset': desktop.store.getStatus().datasetId
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    });
    const result = await response.json();
    assert.equal(response.status, status, JSON.stringify(result));
    return result.data ?? result.error;
  }

  const { id: spaceId } = await local('/api/knowledge/spaces/default', 201, 'POST', {});
  const rawMarkdown = '用于验证分析范围同步的合成正文。';
  const note = await local('/api/knowledge/notes', 201, 'POST', { spaceId, title: '合成来源', rawMarkdown });
  const root = '/api/knowledge/analysis-scopes';
  const query = `spaceId=${encodeURIComponent(spaceId)}`;
  const input = { spaceId, mode: 'all', noteIds: [note.id], idempotencyKey: 'desktop-scope-sync' };
  const before = desktop.store.readOutbox().length;
  const { previewHash } = await local(`${root}/preview`, 200, 'POST', input);
  assert.equal(desktop.store.readOutbox().length, before);
  assert.equal((await local(root, 409, 'POST', input)).code, 'ANNOTATION_CONTENT_CONFLICT');
  const scope = await local(root, 201, 'POST', { ...input, previewHash });
  assert.equal((await local(root, 201, 'POST', { ...input, previewHash })).id, scope.id);
  const scopeOperations = () =>
    desktop.store
      .readOutbox()
      .flatMap(operation =>
        operation.changes.filter(
          change => change.collection === 'analysisScopeSnapshots' && change.entityId === scope.id
        )
      );
  assert.equal(scopeOperations().length, 1);
  assert.equal(scopeOperations()[0].value.segments[0].markdown, rawMarkdown);
  assert.equal(desktop.store.getStatus().cloudSync, 'not-configured');
  const detail = `${root}/${encodeURIComponent(scope.id)}`;
  assert.deepEqual(await local(`${detail}?${query}`, 200), scope);
  assert.equal((await local(detail, 409, 'DELETE')).code, 'LOCAL_FEATURE_UNAVAILABLE');

  const storageRootDir = path.join(fixture, 'cloud');
  const dataStore = createFileDataStore(path.join(storageRootDir, 'cloud.json'));
  const appContext = createAppContext({ dataStore, storageRootDir, uploadsDir: path.join(storageRootDir, 'uploads') });
  const cloud = createServer({ appContext });
  cloud.listen(0, '127.0.0.1');
  await once(cloud, 'listening');
  t.after(() => new Promise(resolve => cloud.close(resolve)));
  const serverUrl = `http://127.0.0.1:${cloud.address().port}`;
  const readCloud = async includeDeleted => {
    const result = await fetch(`${serverUrl}${root}?${query}&includeDeleted=${includeDeleted}`);
    assert.equal(result.status, 200);
    return (await result.json()).data;
  };
  const sync = async (action, body = {}) => {
    const result = await local(`/api/local-runtime/sync/${action}`, 200, 'POST', body);
    assert.equal(result.error, null, JSON.stringify(result));
    assert.equal(result.pendingEntities, 0, JSON.stringify(result));
  };
  assert.deepEqual(await readCloud(true), []);
  await sync('configure', { serverUrl });
  const [syncedScope] = await readCloud(false);
  assert.equal(syncedScope.id, scope.id);
  assert.deepEqual(syncedScope.segments, scope.segments);

  const latest = await local(`${detail}?${query}`, 200);
  const trashed = await local(`${detail}/trash`, 200, 'POST', { spaceId, expectedUpdatedAt: latest.updatedAt });
  assert.ok(trashed.deletedAt);
  assert.deepEqual(await local(`${root}?${query}`, 200), []);
  assert.equal(
    (await local(`${detail}/restore`, 409, 'POST', { spaceId, expectedUpdatedAt: latest.updatedAt })).code,
    'ANALYSIS_SCOPE_UPDATE_CONFLICT'
  );
  assert.equal(scopeOperations().at(-1).value.deletedAt, trashed.deletedAt);
  await sync('retry');
  assert.deepEqual(await readCloud(false), []);
  assert.equal((await readCloud(true))[0].deletedAt, trashed.deletedAt);

  const [latestTrashed] = await local(`${root}?${query}&includeDeleted=true`, 200);
  const restored = await local(`${detail}/restore`, 200, 'POST', {
    spaceId,
    expectedUpdatedAt: latestTrashed.updatedAt
  });
  assert.equal(restored.deletedAt, null);
  assert.equal(scopeOperations().at(-1).value.deletedAt, null);
  await sync('retry');
  const [syncedRestored] = await readCloud(false);
  assert.equal(syncedRestored.id, scope.id);
  assert.deepEqual(syncedRestored.segments, scope.segments);
  assert.equal((await local(`${detail}?${query}`, 200)).deletedAt, null);
});
