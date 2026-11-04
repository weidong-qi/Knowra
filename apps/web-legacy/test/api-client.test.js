import assert from 'node:assert/strict';
import { createApiClient } from '../src/services/api-client.js';

async function runTest(name, callback) {
  try {
    await callback();
    console.log(`ok - ${name}`);
  } catch (error) {
    console.error(`not ok - ${name}`);
    throw error;
  }
}

await runTest('api client returns data from legacy data envelope', async () => {
  const client = createApiClient({
    fetchImpl: async (url, options) => ({
      ok: true,
      status: 200,
      async json() {
        return { data: { url, method: options.method } };
      }
    })
  });

  const payload = await client.requestJson('/api/knowledge/spaces', { method: 'POST' });

  assert.deepEqual(payload, { data: { url: '/api/knowledge/spaces', method: 'POST' } });
});

await runTest('api client throws friendly message from error envelope', async () => {
  const client = createApiClient({
    fetchImpl: async () => ({
      ok: false,
      status: 404,
      async json() {
        return {
          success: false,
          error: { code: 'RESOURCE_NOT_FOUND', message: '笔记不存在' }
        };
      }
    })
  });

  await assert.rejects(
    () => client.requestJson('/api/knowledge/notes/missing'),
    /笔记不存在/
  );
});
