import assert from 'node:assert/strict';
import { once } from 'node:events';
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Writable } from 'node:stream';

import { canServeStaticPath, serveStaticAsset } from '../src/server/static-assets.js';

assert.equal(
  canServeStaticPath('/packages/web-core/dist/index.js'),
  true,
  'V3 should expose only the built shared web-core browser modules'
);

class TestResponse extends Writable {
  constructor() {
    super();
    this.statusCode = null;
    this.headers = {};
    this.chunks = [];
  }

  writeHead(statusCode, headers = {}) {
    this.statusCode = statusCode;
    this.headers = headers;
    return this;
  }

  _write(chunk, encoding, callback) {
    this.chunks.push(Buffer.from(chunk));
    callback();
  }
}

const rootDir = mkdtempSync(path.join(tmpdir(), 'knowra-static-assets-'));
const assetPath = path.join(rootDir, 'lib', 'bundle.js');
mkdirSync(path.dirname(assetPath), { recursive: true });
writeFileSync(assetPath, 'export const ready = true;\n');

try {
  const first = await requestAsset({
    pathname: '/lib/bundle.js',
    rootDir,
    request: { method: 'GET', headers: {} }
  });

  assert.equal(first.statusCode, 200);
  assert.equal(first.body, 'export const ready = true;\n');
  assert.equal(first.headers['Cache-Control'], 'public, max-age=0, must-revalidate');
  assert.equal(first.headers['Content-Type'], 'application/javascript; charset=utf-8');
  assert.equal(first.headers['Content-Length'], Buffer.byteLength(first.body));
  assert.match(first.headers.ETag, /^W\/"[a-f0-9]+-[a-f0-9]+"$/);
  assert.ok(first.headers['Last-Modified']);

  const conditional = await requestAsset({
    pathname: '/lib/bundle.js',
    rootDir,
    request: {
      method: 'GET',
      headers: { 'if-none-match': first.headers.ETag }
    }
  });

  assert.equal(conditional.statusCode, 304);
  assert.equal(conditional.body, '');
  assert.equal(conditional.headers.ETag, first.headers.ETag);

  const head = await requestAsset({
    pathname: '/lib/bundle.js',
    rootDir,
    request: { method: 'HEAD', headers: {} }
  });

  assert.equal(head.statusCode, 200);
  assert.equal(head.body, '');
  assert.equal(head.headers['Content-Length'], Buffer.byteLength(first.body));

  const traversal = await requestAsset({
    pathname: '/lib/../../outside.js',
    rootDir,
    request: { method: 'GET', headers: {} }
  });

  assert.equal(traversal.statusCode, 403);
  assert.equal(traversal.body, 'Forbidden');
} finally {
  rmSync(rootDir, { recursive: true, force: true });
}

console.log('ok - static assets stream with revalidation cache headers');

async function requestAsset({ pathname, rootDir, request }) {
  const response = new TestResponse();
  const finished = once(response, 'finish');

  serveStaticAsset({
    pathname,
    rootDir,
    request,
    response
  });

  await finished;
  return {
    statusCode: response.statusCode,
    headers: response.headers,
    body: Buffer.concat(response.chunks).toString('utf8')
  };
}
