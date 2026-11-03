import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import test from 'node:test';
import { createV4WebServer } from './app.mjs';

const require = createRequire(import.meta.url);
const { resolveDeploymentEnv } = require('../../../deploy/runtime-env.cjs');

async function listen(server) {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return `http://127.0.0.1:${server.address().port}`;
}

async function close(server) {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
}

test('production proxy accepts the body limit and rejects larger requests before forwarding', async () => {
  const received = [];
  const upstream = http.createServer((request, response) => {
    let size = 0;
    request.on('data', (chunk) => { size += chunk.byteLength; });
    request.on('end', () => {
      received.push(size);
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ data: { size } }));
    });
  });
  const apiOrigin = await listen(upstream);
  const proxy = createV4WebServer({ distRoot: '.', getApiOrigin: () => apiOrigin });
  try {
    const origin = await listen(proxy);
    const limit = 8 * 1024 * 1024;
    for (const size of [limit, limit + 1]) {
      const response = await fetch(`${origin}/api/knowledge/notes`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: 'a'.repeat(size - 11) })
      });
      const payload = await response.json();
      assert.equal(response.status, size === limit ? 200 : 413);
      if (size === limit) assert.equal(payload.data.size, limit);
      else assert.equal(payload.error.code, 'PAYLOAD_TOO_LARGE');
    }
    const restoreBody = JSON.stringify({ contentBase64: Buffer.alloc(6 * 1024 * 1024).toString('base64') });
    const restored = await fetch(`${origin}/api/storage/attachments/attachment-legacy/restore`, { method: 'POST', body: restoreBody });
    assert.equal(restored.status, 200, '6 MiB 原文件包含 JSON 包装后仍可转发');
    const upload = await fetch(`${origin}/api/storage/attachments`, { method: 'POST', body: restoreBody });
    assert.equal(upload.status, 413, '其他接口保持 8 MiB 请求限制');
    const tooLarge = await fetch(`${origin}/api/storage/attachments/attachment-legacy/restore`, { method: 'POST', body: 'a'.repeat(9 * 1024 * 1024 + 1) });
    assert.equal(tooLarge.status, 413);
    assert.deepEqual(received, [limit, Buffer.byteLength(restoreBody)]);
  } finally {
    await close(proxy);
    await close(upstream);
  }
});

test('production proxy reaches a custom derived API port and honors an explicit origin', async () => {
  const upstream = http.createServer((request, response) => {
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ data: { path: request.url } }));
  });
  const upstreamOrigin = await listen(upstream);
  try {
    const upstreamPort = new URL(upstreamOrigin).port;
    const derived = resolveDeploymentEnv({ KNOWRA_API_PORT: upstreamPort });
    const explicit = resolveDeploymentEnv({
      KNOWRA_API_PORT: '1',
      API_ORIGIN: upstreamOrigin
    });
    assert.equal(resolveDeploymentEnv({}).apiOrigin, 'http://127.0.0.1:3001');
    assert.equal(derived.apiOrigin, upstreamOrigin);
    assert.equal(explicit.apiOrigin, upstreamOrigin);

    for (const apiOrigin of [derived.apiOrigin, explicit.apiOrigin]) {
      const proxy = createV4WebServer({ distRoot: '.', getApiOrigin: () => apiOrigin });
      try {
        const origin = await listen(proxy);
        const response = await fetch(`${origin}/api/health?source=deployment`);
        assert.equal(response.status, 200);
        assert.deepEqual(await response.json(), { data: { path: '/api/health?source=deployment' } });
      } finally {
        await close(proxy);
      }
    }
  } finally {
    await close(upstream);
  }
});

test('Web proxy 按最终 UTF-8 JSON 字节数放行同步 batch/blob 边界并拒绝超限', async () => {
  const received = [];
  const upstream = http.createServer((request, response) => {
    let size = 0;
    request.on('data', chunk => { size += chunk.byteLength; });
    request.on('end', () => { received.push([request.url, size]); response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ data: { size } })); });
  });
  const apiOrigin = await listen(upstream), proxy = createV4WebServer({ distRoot: '.', getApiOrigin: () => apiOrigin });
  try {
    const origin = await listen(proxy);
    for (const [route, limit] of [['batch', 16 * 1024 * 1024], ['blobs', 9 * 1024 * 1024]]) {
      for (const size of [limit, limit + 1]) {
        // 中文采用 UTF-8 计量；body 本身始终是有效 JSON。
        const body = JSON.stringify({ text: '中' + 'a'.repeat(size - 14) });
        assert.equal(Buffer.byteLength(body), size);
        const response = await fetch(`${origin}/api/sync/${route}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
        assert.equal(response.status, size === limit ? 200 : 413, route);
      }
    }
    assert.deepEqual(received, [['/api/sync/batch', 16 * 1024 * 1024], ['/api/sync/blobs', 9 * 1024 * 1024]]);
  } finally { await close(proxy); await close(upstream); }
});
