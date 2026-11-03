import assert from 'node:assert/strict';
import { once } from 'node:events';
import http from 'node:http';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createV4WebServer } from './app.mjs';
import { createServer } from '../../api/src/server.js';

async function listen(server) {
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  return `http://127.0.0.1:${server.address().port}`;
}
async function close(server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
function post(origin, headers) {
  return new Promise((resolve, reject) => {
    const request = http.request(origin + '/api/storage/attachments/cleanup/retry', { method: 'POST', headers }, response => {
      const chunks = []; response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => resolve({ status: response.statusCode, json: async () => JSON.parse(Buffer.concat(chunks).toString()), headers: new Headers(response.headers) }));
    });
    request.on('error', reject); request.end();
  });
}
async function fixture(t, options = {}) {
  const received = []; let mutations = 0;
  const api = createServer({ appContext: { http: { knowledge: {}, storage: { retryAttachmentCleanup: () => { mutations++; return {}; } } } }, cors: { allowedOrigins: options.allowedOrigins ?? [] } });
  api.prependListener('request', request => received.push(request.headers));
  const apiOrigin = await listen(api); t.after(() => close(api));
  const proxy = createV4WebServer({ distRoot: '.', getApiOrigin: () => apiOrigin, ...options });
  const origin = await listen(proxy); t.after(() => close(proxy));
  return { origin, apiOrigin, received, count: () => mutations, post: headers => post(origin, headers) };
}
test('真实 Web→API 拒绝跨源无正文写入且不触达 API，保留同源和原生客户端', async t => {
  const f = await fixture(t);
  for (const headers of [{ Origin: 'https://evil.example' }, { Origin: 'null' }, { Origin: f.origin + '/path' }, { 'Sec-Fetch-Site': 'cross-site' }, { Origin: 'https://evil.example', 'X-Forwarded-Host': 'evil.example', Forwarded: 'host=evil.example;proto=https' }]) {
    const response = await f.post(headers); assert.equal(response.status, 403); assert.equal((await response.json()).error.code, 'REQUEST_ORIGIN_FORBIDDEN');
  }
  assert.equal(f.received.length, 0);
  assert.equal((await f.post({ Origin: f.origin, 'Sec-Fetch-Site': 'same-origin' })).status, 200);
  assert.equal(f.received[0].origin, f.apiOrigin);
  assert.equal((await f.post({})).status, 200); assert.equal(f.received[1].origin, undefined);
  assert.equal(f.count(), 2);
});
test('HTTPS 反向代理来源只在显式回环信任后生效，传向 API 时移除转发头', async t => {
  const untrusted = await fixture(t);
  const publicOrigin = 'https://public.example:8443';
  const headers = { Host: 'public.example:8443', Origin: publicOrigin, 'X-Forwarded-Proto': 'https', 'X-Forwarded-Host': 'evil.example', 'X-Forwarded-For': '203.0.113.1', Forwarded: 'host=evil.example' };
  assert.equal((await untrusted.post(headers)).status, 403); assert.equal(untrusted.received.length, 0);
  const trusted = await fixture(t, { trustProxy: true });
  assert.equal((await trusted.post(headers)).status, 200);
  assert.equal(trusted.received[0].origin, trusted.apiOrigin);
  assert(!Object.keys(trusted.received[0]).some(key => key === 'forwarded' || key.startsWith('x-forwarded-')));
  for (const protocol of ['https,http', 'ftp']) {
    assert.equal((await trusted.post({ ...headers, 'X-Forwarded-Proto': protocol })).status, 403);
  }
  assert.equal(trusted.received.length, 1);
});
test('Web→API 明确 CORS 白名单保留原来源及响应头，通配不开放写入', async t => {
  const origin = 'https://trusted.example';
  const f = await fixture(t, { allowedOrigins: [origin] });
  const response = await f.post({ Origin: origin, 'Sec-Fetch-Site': 'cross-site' });
  assert.equal(response.status, 200); assert.equal(response.headers.get('Access-Control-Allow-Origin'), origin); assert.equal(f.received[0].origin, origin);
  const wildcard = await fixture(t, { allowedOrigins: ['*'] });
  assert.equal((await wildcard.post({ Origin: origin })).status, 403); assert.equal(wildcard.received.length, 0);
});
test('实际 Vite 开发代理保留 Host，同源 JSON POST 与 API 来源检查兼容', async t => {
  const { createServer: createViteServer } = await import('vite');
  let received = 0;
  const api = createServer({ appContext: { http: { knowledge: {}, storage: { uploadAttachment: value => { received++; return value; } } } } });
  const apiOrigin = await listen(api); t.after(() => close(api));
  const previous = process.env.API_PORT; process.env.API_PORT = String(api.address().port);
  let vite;
  try {
    vite = await createViteServer({ root: fileURLToPath(new URL('../', import.meta.url)), configFile: fileURLToPath(new URL('../vite.config.ts', import.meta.url)), server: { port: 0 } });
  } finally { if (previous === undefined) delete process.env.API_PORT; else process.env.API_PORT = previous; }
  t.after(() => vite.close()); await vite.listen();
  const origin = `http://127.0.0.1:${vite.httpServer.address().port}`;
  const response = await fetch(origin + '/api/storage/attachments', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(response.status, 201); assert.equal(received, 1);
});
