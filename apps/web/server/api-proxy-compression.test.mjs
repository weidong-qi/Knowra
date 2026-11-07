import assert from 'node:assert/strict';
import { once } from 'node:events';
import http from 'node:http';
import test from 'node:test';
import { brotliCompressSync, gzipSync, zstdCompressSync } from 'node:zlib';
import { createV4WebServer } from './app.mjs';

async function listen(server) {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return `http://127.0.0.1:${server.address().port}`;
}

async function close(server) {
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
}

function readRawResponse(url, method = 'GET') {
  return new Promise((resolve, reject) => {
    const request = http.request(url, { method }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('error', reject);
      response.on('end', () =>
        resolve({ status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks) })
      );
    });
    request.setTimeout(5000, () => request.destroy(new Error('代理响应超时')));
    request.on('error', reject);
    request.end();
  });
}

async function fixture(t, handler) {
  const upstream = http.createServer(handler);
  const apiOrigin = await listen(upstream);
  t.after(() => close(upstream));
  const proxy = createV4WebServer({ distRoot: '.', getApiOrigin: () => apiOrigin });
  const origin = await listen(proxy);
  t.after(() => close(proxy));
  return origin;
}

const payload = Buffer.from(JSON.stringify({ data: { text: '合成压缩响应。'.repeat(200) } }));
const routes = ['/api/health', '/api/storage/pdf-files/synthetic', '/api/sync/blob-stream', '/api/storage/archive'];

for (const [encoding, compress] of [
  ['gzip', gzipSync],
  ['br', brotliCompressSync]
]) {
  for (const route of routes) {
    for (const chunked of [false, true]) {
      test(`生产代理 ${encoding} ${route} ${chunked ? '分块' : '定长'}响应正文与响应头一致`, async t => {
        const compressed = compress(payload);
        const origin = await fixture(t, (_request, response) => {
          response.writeHead(200, {
            'Content-Type': 'application/json',
            'Content-Encoding': encoding,
            ...(chunked ? {} : { 'Content-Length': compressed.length })
          });
          if (chunked) response.write(compressed.subarray(0, 5));
          response.end(chunked ? compressed.subarray(5) : compressed);
        });
        const result = await readRawResponse(origin + route);
        assert.equal(result.status, 200);
        assert.equal(result.headers['content-type'], 'application/json');
        assert.equal(result.headers['content-encoding'], undefined, 'fetch 已解压，不得要求客户端再次解压');
        assert.deepEqual(result.body, payload, '原始 HTTP 客户端应收到完整正文');
        if (result.headers['content-length'] !== undefined) {
          assert.equal(Number(result.headers['content-length']), payload.length);
        }
        const response = await fetch(origin + route);
        assert.deepEqual(await response.json(), JSON.parse(payload.toString()));
      });
    }
  }
}

for (const route of ['/api/health', '/api/storage/pdf-files/synthetic']) {
  for (const method of ['HEAD', 'GET']) {
    test(`生产代理 ${route} ${method === 'HEAD' ? 'HEAD' : '304'} 保留压缩表示元数据且无正文`, async t => {
      const compressed = gzipSync(payload);
      const status = method === 'HEAD' ? 200 : 304;
      const origin = await fixture(t, (_request, response) => {
        response.writeHead(status, { 'Content-Encoding': 'gzip', 'Content-Length': compressed.length });
        response.end();
      });
      const result = await readRawResponse(origin + route, method);
      assert.equal(result.status, status);
      assert.equal(result.headers['content-encoding'], 'gzip');
      assert.equal(Number(result.headers['content-length']), compressed.length);
      assert.equal(result.body.length, 0);
    });
  }
  for (const encoding of [null, 'synthetic-unsupported']) {
    test(`生产代理 ${route} ${encoding ? '明确拒绝不支持编码' : '保留未压缩正文与长度'}`, async t => {
      const origin = await fixture(t, (_request, response) => {
        response.writeHead(200, {
          'Content-Length': payload.length,
          ...(encoding ? { 'Content-Encoding': encoding } : {})
        });
        response.end(payload);
      });
      const result = await readRawResponse(origin + route);
      if (encoding) assertUnsupportedResponse(result, 'UPSTREAM_ENCODING_UNSUPPORTED');
      else {
        assert.equal(result.headers['content-encoding'], undefined);
        assert.equal(Number(result.headers['content-length']), payload.length);
        assert.deepEqual(result.body, payload);
      }
    });
  }
}

function assertUnsupportedResponse(result, code) {
  assert.equal(result.status, 502);
  assert.equal(result.headers['content-type'], 'application/json; charset=utf-8');
  assert.equal(result.headers['content-encoding'], undefined);
  assert.equal(result.headers['content-range'], undefined);
  const error = JSON.parse(result.body.toString()).error;
  assert.equal(error.code, code);
  assert.equal(typeof error.message, 'string');
  assert(error.message.length > 0);
  if (result.headers['content-length'] !== undefined) {
    assert.equal(Number(result.headers['content-length']), result.body.length);
  }
}

for (const route of routes) {
  for (const chunked of [false, true]) {
    test(`生产代理 ${route} 明确拒绝 zstd ${chunked ? '分块' : '定长'}响应且不发送损坏正文`, async t => {
      const compressed = zstdCompressSync(payload);
      const origin = await fixture(t, (_request, response) => {
        response.writeHead(200, {
          'Content-Encoding': 'zstd',
          ...(chunked ? {} : { 'Content-Length': compressed.length })
        });
        if (chunked) response.write(compressed.subarray(0, 5));
        response.end(chunked ? compressed.subarray(5) : compressed);
      });
      assertUnsupportedResponse(await readRawResponse(origin + route), 'UPSTREAM_ENCODING_UNSUPPORTED');
    });
  }
  for (const [encoding, compress] of [
    ['gzip', gzipSync],
    ['br', brotliCompressSync],
    ['zstd', zstdCompressSync]
  ]) {
    for (const chunked of [false, true]) {
      test(`生产代理 ${route} 明确拒绝 ${encoding} ${chunked ? '分块' : '定长'}206，不伪造范围语义`, async t => {
        const compressed = compress(payload);
        const origin = await fixture(t, (_request, response) => {
          response.writeHead(206, {
            'Content-Encoding': encoding,
            'Content-Range': `bytes 0-${compressed.length - 1}/${compressed.length}`,
            ...(chunked ? {} : { 'Content-Length': compressed.length })
          });
          if (chunked) response.write(compressed.subarray(0, 5));
          response.end(chunked ? compressed.subarray(5) : compressed);
        });
        assertUnsupportedResponse(await readRawResponse(origin + route), 'UPSTREAM_RANGE_ENCODING_UNSUPPORTED');
      });
    }
  }
}
