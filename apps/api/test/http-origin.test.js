import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from '../src/server.ts';

async function fixture(allowedOrigins, run) {
  let mutations = 0;
  const server = createServer({
    appContext: {
      http: {
        knowledge: {},
        storage: {
          retryAttachmentCleanup: () => {
            mutations++;
            return {};
          }
        }
      }
    },
    cors: { allowedOrigins }
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    await run(`http://127.0.0.1:${server.address().port}`, () => mutations);
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
}
export const httpOriginTests = [
  {
    name: 'API 在无正文写入前拒绝外部、null、畸形来源和跨站元数据，不信任转发头',
    async run() {
      await fixture([], async (origin, count) => {
        for (const headers of [
          { Origin: 'https://evil.example' },
          { Origin: 'null' },
          { Origin: origin + '/path' },
          { 'Sec-Fetch-Site': 'cross-site' },
          { Origin: 'https://evil.example', 'X-Forwarded-Host': 'evil.example', 'X-Forwarded-Proto': 'https' }
        ]) {
          const response = await fetch(origin + '/api/storage/attachments/cleanup/retry', { method: 'POST', headers });
          assert.equal(response.status, 403);
          assert.equal((await response.json()).error.code, 'REQUEST_ORIGIN_FORBIDDEN');
        }
        assert.equal(count(), 0);
        for (const headers of [{}, { Origin: origin, 'Sec-Fetch-Site': 'same-origin' }]) {
          assert.equal(
            (await fetch(origin + '/api/storage/attachments/cleanup/retry', { method: 'POST', headers })).status,
            200
          );
        }
        assert.equal(count(), 2);
      });
    }
  },
  {
    name: 'API 保留具体 CORS 白名单；通配只允许读取，不允许跨源写入',
    async run() {
      const trusted = 'https://trusted.example';
      await fixture([trusted], async origin => {
        assert.equal(
          (
            await fetch(origin + '/api/health', {
              method: 'OPTIONS',
              headers: { Origin: trusted, 'Access-Control-Request-Method': 'POST' }
            })
          ).status,
          204
        );
        const response = await fetch(origin + '/api/storage/attachments/cleanup/retry', {
          method: 'POST',
          headers: { Origin: trusted, 'Sec-Fetch-Site': 'cross-site' }
        });
        assert.equal(response.status, 200);
        assert.equal(response.headers.get('Access-Control-Allow-Origin'), trusted);
      });
      await fixture(['*'], async (origin, count) => {
        assert.equal((await fetch(origin + '/api/health', { headers: { Origin: trusted } })).status, 200);
        assert.equal(
          (
            await fetch(origin + '/api/storage/attachments/cleanup/retry', {
              method: 'POST',
              headers: { Origin: trusted }
            })
          ).status,
          403
        );
        assert.equal(count(), 0);
      });
    }
  }
];
