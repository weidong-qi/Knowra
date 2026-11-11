import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createPersistentAppContext } from '../../src/app.factory.js';
import { createServer } from '../../src/server.js';
import { createUnavailableAiRuntime } from '../../src/modules/ai/runtime.ts';
import { startHangProbe } from './ai-hang-probe.mjs';

import { CORE_HTTP_SAMPLE_COUNT, CORE_HTTP_WARMUP_COUNT as WARMUP_COUNT } from './http-latency-samples.mjs';
export { CORE_HTTP_SAMPLE_COUNT, p95 } from './http-latency-samples.mjs';

/** 每种模式从独立空库开始，使用完全相同的 ID/正文/操作序列，避免库与 journal 随组增长。 */
export async function measureCoreHttp(mode) {
  assert(['off', 'baseline', 'fault'].includes(mode));
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'knowra-ai-core-probe-'));
  let server, hang;
  const samples = [];
  try {
    const context = createPersistentAppContext({ storageRootDir: directory, ownerId: 'demo' });
    const space = context.http.knowledge.createDefaultKnowledgeSpace({});
    if (mode === 'off') context.ai = createUnavailableAiRuntime('AI 功能已关闭。');
    server = createServer({ appContext: context, logger: { warn() {}, error() {} } });
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    const base = `http://127.0.0.1:${server.address().port}`;
    async function request(route, status, options) {
      const response = await fetch(`${base}${route}`, options);
      const body = await response.json(); // 消费所有响应体，避免连接占用和 GC 成为分组差异。
      assert.equal(response.status, status);
      return body;
    }
    async function exercise(id) {
      await request('/api/knowledge/notes', 201, { method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, title: `核心笔记 ${id}`, rawMarkdown: '核心保存', spaceId: space.id }) });
      const note = await request(`/api/knowledge/notes/${id}`, 200);
      assert.equal(note.data.id, id);
      await request('/api/sync/status', 200);
    }
    for (let i = 0; i < WARMUP_COUNT; i++) await exercise(`warmup-${i}`);
    if (mode === 'fault') hang = await startHangProbe();
    for (let i = 0; i < CORE_HTTP_SAMPLE_COUNT; i++) {
      hang?.assertActive();
      const start = performance.now();
      await exercise(`sample-${i}`);
      const elapsed = performance.now() - start;
      hang?.assertActive();
      samples.push(elapsed);
    }
    assert.equal(context.dataStore.state.notes.length, WARMUP_COUNT + CORE_HTTP_SAMPLE_COUNT);
    return samples;
  } finally {
    console.log(`R01 核心 HTTP ${mode} 有效样本 ${samples.length}/${CORE_HTTP_SAMPLE_COUNT}(ms): ${JSON.stringify(samples)}`);
    try {
      if (hang) {
        const result = await hang.close();
        assert.equal(result.error?.code, 'AI_CANCELLED', '测量结束前不得超时或退出');
      }
    } finally {
      try {
        if (server?.listening) await new Promise(resolve => server.close(resolve));
      } finally { fs.rmSync(directory, { recursive: true, force: true }); }
    }
  }
}
