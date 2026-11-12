import assert from 'node:assert/strict';
import { createR07Fixture } from './ai-r07-runtime.mjs';
import { startHangProbe } from '../../../api/test/fixtures/ai-hang-probe.mjs';
import { CORE_HTTP_SAMPLE_COUNT, CORE_HTTP_WARMUP_COUNT } from '../../../api/test/fixtures/http-latency-samples.mjs';
import { AI_PROCESS_LIMITS, createIsolatedDeepSeekAdapter } from '../../../api/src/modules/ai/isolated-provider.ts';

export const isolationAdapter = () =>
  createIsolatedDeepSeekAdapter({
    childUrl: new URL('../../../api/test/fixtures/ai-process-fixture.mjs', import.meta.url),
    limits: { ...AI_PROCESS_LIMITS, wallMs: 3000 }
  });

/** 每个阶段重新建立同初态资料库；完整冷路径另受硬上限，故障转换后的首样不得丢弃。 */
export async function measureR07CoreHttp(
  driver,
  phase,
  { createFixture = createR07Fixture, startHang = startHangProbe } = {}
) {
  assert(['off', 'idle', 'process-fault', 'storage-fault'].includes(phase));
  const fixture = await createFixture(driver, { aiEnabled: phase !== 'off', isolatePostgres: true });
  const warmup = [],
    samples = [],
    operations = [],
    warmupOperations = [];
  let hang, originalIdentity;
  const startedAt = new Date().toISOString();
  try {
    const launch = await fetch(fixture.launchUrl, { redirect: 'manual' });
    await launch.arrayBuffer();
    const cookie = launch.headers.get('set-cookie')?.split(';')[0];
    const headers = {
      'Content-Type': 'application/json',
      ...(cookie ? { Cookie: cookie } : {}),
      ...(driver === 'sqlite' ? { 'X-Knowra-Dataset': (await fixture.store.identity()).datasetId } : {})
    };
    async function call(route, method = 'GET', body) {
      const response = await fetch(`${fixture.origin}${route}`, {
        method,
        headers,
        ...(body === undefined ? {} : { body: JSON.stringify(body) })
      });
      const value = await response.json(); // 所有请求均消费完整响应，计时包含正文传输和解析。
      return { status: response.status, ...value };
    }
    const space = (await call('/api/knowledge/spaces/default', 'POST', {})).data;
    const syncRoute = driver === 'sqlite' ? '/api/local-runtime/sync' : '/api/sync/status';
    async function exercise(index) {
      const id = `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
      const start = performance.now();
      assert.equal(
        (
          await call('/api/knowledge/notes', 'POST', {
            id,
            spaceId: space.id,
            title: `隔离合成笔记 ${id}`,
            rawMarkdown: '子进程故障期间核心保存。'
          })
        ).status,
        201
      );
      const savedAt = performance.now();
      const read = await call(`/api/knowledge/notes/${id}`);
      assert.equal(read.status, 200);
      assert.equal(read.data.rawMarkdown, '子进程故障期间核心保存。');
      const readAt = performance.now();
      assert.equal((await call(syncRoute)).status, 200);
      const end = performance.now();
      return { elapsed: end - start, operations: [savedAt - start, readAt - savedAt, end - readAt] };
    }
    // 热身属于正常核心路径；逐次保留日志与原1000ms硬门禁，不用热身掩盖冷路径。
    for (let i = 0; i < CORE_HTTP_WARMUP_COUNT; i++) {
      const result = await exercise(i);
      warmup.push(result.elapsed);
      warmupOperations.push(result.operations);
      assert(result.elapsed < 1000, `${driver} ${phase} 冷路径/热身[${i}]=${result.elapsed}ms`);
    }
    if (phase === 'process-fault') hang = await startHang();
    if (phase === 'storage-fault') {
      originalIdentity = fixture.runtime.repository.identity;
      fixture.runtime.repository.identity = async () => {
        throw new Error('synthetic AI private storage fault');
      };
      const status = (await call('/api/ai/assistant/status')).data;
      assert.equal(status.generationAvailable, false);
      assert.match(status.unavailableReason, /私有存储不可用/);
      assert.equal((await call(`/api/ai/assistant/jobs?spaceId=${encodeURIComponent(space.id)}`)).status, 503);
    }
    for (let i = 0; i < CORE_HTTP_SAMPLE_COUNT; i++) {
      hang?.assertActive();
      const result = await exercise(CORE_HTTP_WARMUP_COUNT + i);
      hang?.assertActive();
      samples.push(result.elapsed);
      operations.push(result.operations);
    }
    if (phase === 'off') {
      assert.equal((await call('/api/ai/assistant/status')).data.generationAvailable, false);
      assert.equal(fixture.adapter.calls.length, 0);
    }
    if (phase === 'storage-fault') {
      fixture.runtime.repository.identity = originalIdentity;
      originalIdentity = undefined;
      assert.equal((await call('/api/ai/assistant/status')).status, 200);
    }
    if (phase === 'process-fault') {
      assert.equal((await hang.close()).error?.code, 'AI_CANCELLED', '采样结束前挂起进程不得超时或退出');
      hang = undefined;
      const isolated = isolationAdapter();
      for (const [mode, code] of [
        ['crash', 'AI_PROCESS_FAILED'],
        ['limit', 'AI_PROCESS_LIMIT']
      ]) {
        await assert.rejects(isolated.complete({ mode }), error => error.code === code);
        assert.equal((await call(syncRoute)).status, 200);
      }
    }
    return samples;
  } finally {
    console.log(
      `R07 采样 ${JSON.stringify({
        driver,
        phase,
        startedAt,
        endedAt: new Date().toISOString(),
        warmupMs: warmup.map(x => +x.toFixed(1)),
        warmupOperationMs: warmupOperations.map(row => row.map(x => +x.toFixed(1))),
        sampleMs: samples.map(x => +x.toFixed(1)),
        operationMs: operations.map(row => row.map(x => +x.toFixed(1)))
      })}`
    );
    try {
      if (originalIdentity) fixture.runtime.repository.identity = originalIdentity;
      if (hang) assert.equal((await hang.close()).error?.code, 'AI_CANCELLED', '测量结束前不得超时或退出');
    } finally {
      await fixture.close();
    }
  }
}
