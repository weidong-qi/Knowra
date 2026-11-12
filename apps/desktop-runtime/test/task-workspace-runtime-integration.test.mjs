import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import sharp from 'sharp';
import { startLocalRuntime } from '../src/runtime-server.mjs';
import { createAppContext } from '../../api/src/app.factory.ts';
import { createServer } from '../../api/src/server.ts';

const quiet = { warn() {}, error() {} };
test('真实本地 HTTP 接线：会话、epoch、图片、重启和归档保持独立领域边界', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'knowra-task-http-host-'));
  const dataDirectory = path.join(root, 'data'),
    distRoot = path.join(root, 'web');
  fs.mkdirSync(distRoot);
  fs.writeFileSync(path.join(distRoot, 'index.html'), '<head></head>');
  let runtime;
  t.after(async () => {
    await runtime?.close();
    fs.rmSync(root, { recursive: true, force: true });
  });
  let cookie, epoch;
  const boot = async () => {
    runtime = await startLocalRuntime({ dataDirectory, distRoot, logger: quiet });
    const response = await fetch(runtime.launchUrl, { redirect: 'manual' });
    cookie = response.headers.get('set-cookie').split(';')[0];
    epoch = (await call('/capabilities')).body.data.datasetEpoch;
  };
  const call = async (suffix, body, method = 'POST', extra = {}) => {
    const response = await fetch(runtime.origin + '/api/task-workspaces' + suffix, {
      method: body === undefined ? 'GET' : method,
      headers: { cookie, 'Content-Type': 'application/json', 'X-Task-Workspace-Epoch': epoch, ...extra },
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    });
    return { status: response.status, body: await response.json() };
  };
  await boot();
  assert.equal((await fetch(runtime.origin + '/api/task-workspaces/capabilities')).status, 401);
  assert.equal(
    (await call('', { operationId: randomUUID(), name: '旧页面' }, 'POST', { 'X-Task-Workspace-Epoch': 'old' })).status,
    409
  );
  assert.equal((await call('', { operationId: randomUUID(), name: '伪造', actorId: 'other' })).status, 422);
  const operationId = randomUUID();
  const created = await call('', { operationId, name: '合成工作区' });
  assert.equal(created.status, 200);
  const workspace = created.body.data.data.workspace;
  assert.equal((await call('', { operationId, name: '合成工作区' })).body.data.reused, true);
  const document = (
    await call(`/${workspace.id}/documents`, { operationId: randomUUID(), title: '说明', markdown: '安全文本' })
  ).body.data.data.document;
  const bytes = await sharp({ create: { width: 3, height: 2, channels: 3, background: 'blue' } })
    .png()
    .toBuffer();
  const form = new FormData();
  form.set('operationId', randomUUID());
  form.set('expectedRevision', String(document.revision));
  form.set('file', new Blob([bytes], { type: 'image/png' }), 'synthetic.png');
  const uploadResponse = await fetch(
    `${runtime.origin}/api/task-workspaces/${workspace.id}/documents/${document.id}/attachments`,
    {
      method: 'POST',
      headers: { cookie, 'X-Task-Workspace-Epoch': epoch },
      body: form
    }
  );
  assert.equal(uploadResponse.status, 200);
  const uploaded = (await uploadResponse.json()).data.data;
  assert.equal(uploaded.attachment.sha256, createHash('sha256').update(bytes).digest('hex'));
  assert.equal(uploaded.attachment.storageKey, undefined);
  const saved = await call(
    `/${workspace.id}/documents/${document.id}`,
    {
      operationId: randomUUID(),
      expectedRevision: uploaded.documentRevision,
      markdown: `![合成](${uploaded.imageUri})`
    },
    'PATCH'
  );
  assert.equal(saved.status, 200);
  const image = await fetch(runtime.origin + uploaded.imageUri, { headers: { cookie } });
  assert.equal(image.status, 200);
  assert.deepEqual(Buffer.from(await image.arrayBuffer()), bytes);
  assert.equal(runtime.store.state.notes.length, 0);
  assert.equal(runtime.store.state.attachments.length, 0);
  const noteSnapshot = runtime.store.exportSnapshot();
  assert.equal(noteSnapshot.taskWorkspaces, undefined);
  assert.equal(noteSnapshot.data.taskWorkspaces, undefined);
  await runtime.close();
  runtime = null;
  await boot();
  assert.equal(
    (await call(`/${workspace.id}/documents/${document.id}`)).body.data.version.id,
    saved.body.data.data.document.version.id
  );
  assert.equal(
    (await call(`/${workspace.id}/archive`, { operationId: randomUUID(), expectedRevision: workspace.revision }))
      .status,
    200
  );
  assert.equal((await call(`/${workspace.id}/documents/${document.id}`)).status, 409);
});

test('未装配持久化宿主明确 capability unavailable，健康检查仍可用', async t => {
  const server = createServer({ appContext: createAppContext(), logger: quiet });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const root = `http://127.0.0.1:${server.address().port}`;
  const capability = await fetch(root + '/api/task-workspaces/capabilities').then(r => r.json());
  assert.equal(capability.data.available, false);
  assert.equal(capability.data.reasonCode, 'TASK_WORKSPACE_UNAVAILABLE');
  assert.equal((await fetch(root + '/api/health')).status, 200);
  assert.equal((await fetch(root + '/api/task-workspaces')).status, 503);
});
