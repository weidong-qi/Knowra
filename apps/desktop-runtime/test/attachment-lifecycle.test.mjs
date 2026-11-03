import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { createRuntimeServices } from '../src/runtime-services.mjs';
import { temporaryDirectory } from './helpers.mjs';
import { permitsLocalRoute } from '../src/runtime-policy.mjs';
import { entityContent } from '../../api/src/modules/sync/entity-contract.ts';
import { LOCAL_DATA_COLLECTIONS } from '../../api/src/infrastructure/local-data-schema.js';
import { applyEntityRemote, getEntitySyncState } from '../src/entity-sync-state.mjs';

test('桌面 SQLite 附件核验恢复、编码历史保护、删除留存及状态不入同步差异', async t => {
  const root = temporaryDirectory(t);
  const runtime = createRuntimeServices({ dataDirectory: root, syncOptions: { autoSync: false } });
  t.after(async () => {
    await runtime.sync.close();
    await runtime.closeAi();
    runtime.store.close();
  });
  // handleApi 使用相同 storage handler；以独立 HTTP 服务器验证真实路由。
  const { createServer } = await import('node:http');
  const server = createServer(runtime.handleApi);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const request = async (route, method = 'GET', body) => {
    const response = await fetch(origin + route, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined
    });
    return { status: response.status, ...(await response.json()) };
  };
  const space = (await request('/api/knowledge/spaces/default', 'POST', { userId: 'demo' })).data;
  const note = (
    await request('/api/knowledge/notes', 'POST', { spaceId: space.id, title: '附件闭环', rawMarkdown: '' })
  ).data;
  const payload = {
    noteId: note.id,
    fileName: '原文件.txt',
    contentBase64: Buffer.from('original').toString('base64')
  };
  const attachment = (await request('/api/storage/attachments', 'POST', payload)).data;
  const route = `/api/storage/attachments/${attachment.id}`;
  const file = path.join(root, 'uploads', `${attachment.id}-${attachment.fileName}`);
  fs.unlinkSync(file);
  assert.equal((await request(`${route}/verify`, 'POST')).data.status, 'missing');
  assert.equal(
    (await request(`${route}/restore`, 'POST', { contentBase64: Buffer.from('different').toString('base64') })).status,
    422
  );
  const restored = (await request(`${route}/restore`, 'POST', payload)).data;
  assert.equal(restored.id, attachment.id);
  assert.equal(restored.sha256, attachment.sha256);
  assert.equal(restored.status, 'ready');
  const baseline = LOCAL_DATA_COLLECTIONS.flatMap(collection =>
    runtime.store.state[collection].map(value => ({
      collection,
      id: value.id,
      revision: 1,
      value: structuredClone(value)
    }))
  );
  assert.equal(applyEntityRemote(runtime.store, baseline, 'baseline', 'attachment-test', { reset: true }), true);
  fs.writeFileSync(file, 'bad');
  assert.equal((await request(`${route}/verify`, 'POST')).data.status, 'corrupt');
  assert.equal(getEntitySyncState(runtime.store).pendingAttachments, 0);
  const remoteNote = { ...runtime.store.state.notes.find(item => item.id === note.id), title: '其他设备更新标题' };
  assert.equal(
    applyEntityRemote(
      runtime.store,
      [{ collection: 'notes', id: note.id, revision: 2, value: remoteNote }],
      'next',
      'attachment-test'
    ),
    true
  );
  assert.equal(
    runtime.store.state.attachments.find(item => item.id === attachment.id).status,
    'corrupt',
    '远端其他资产更新不得覆盖本机健康状态'
  );
  await request(`${route}/restore`, 'POST', payload);
  const encoded = attachment.id.replace(/^a/, '%61');
  runtime.store.state.annotationRevisions.push({
    id: 'revision-retained',
    noteId: note.id,
    content: `/api/storage/attachments/${encoded}/content#attachment=wrong`
  });
  // 不写入伪造领域实体，仅验证权威删除复核遍历完整内存业务状态。
  assert.equal((await request(`${route}/deletion-preflight`)).data.references[0].collection, 'annotationRevisions');
  assert.equal((await request(route, 'DELETE')).status, 409);
  runtime.store.state.annotationRevisions.pop();
  const deleted = await request(route, 'DELETE');
  assert.equal(deleted.data.cleanup, 'retained-local');
  assert(fs.existsSync(file));
  assert.equal((await request(`${route}/restore`, 'POST', payload)).status, 404);
  const missing = { ...attachment, status: 'missing', verifiedAt: null };
  assert.deepEqual(entityContent('attachments', missing), entityContent('attachments', attachment));
  assert(permitsLocalRoute('POST', `${route}/verify`));
  assert(permitsLocalRoute('POST', `${route}/restore`));
  assert(permitsLocalRoute('POST', '/api/storage/attachments/cleanup/retry'));
});
