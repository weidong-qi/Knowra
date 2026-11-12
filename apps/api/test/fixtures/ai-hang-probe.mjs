import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { AI_PROCESS_LIMITS, createIsolatedDeepSeekAdapter } from '../../src/modules/ai/isolated-provider.ts';

/** 只为测量提供已进入 hang 的进程；墙钟上限是清理保险，不是性能通过阈值。 */
export async function startHangProbe() {
  const controller = new AbortController();
  let child,
    settled = false,
    exited = false,
    readyTimer;
  let resolveReady;
  const ready = new Promise(resolve => {
    resolveReady = resolve;
  });
  const adapter = createIsolatedDeepSeekAdapter({
    childUrl: new URL('./ai-process-fixture.mjs', import.meta.url),
    limits: { ...AI_PROCESS_LIMITS, wallMs: 30_000 },
    spawn(...args) {
      child = fork(...args);
      child.once('exit', () => {
        exited = true;
      });
      child.on('message', message => {
        if (message?.type === 'fixture-ready' && message.mode === 'hang') resolveReady();
      });
      return child;
    }
  });
  // 在第一次 await 前接住 rejection；超时/崩溃不能成为未处理拒绝或被当成有效故障样本。
  const outcome = adapter.complete({ mode: 'hang', signal: controller.signal }).then(
    value => {
      settled = true;
      return { value };
    },
    error => {
      settled = true;
      return { error };
    }
  );
  async function close() {
    const exit = child?.pid && !exited ? new Promise(resolve => child.once('exit', resolve)) : Promise.resolve();
    controller.abort();
    const result = await outcome;
    await exit;
    return result;
  }
  function assertActive() {
    assert(child && !settled && !exited && !child.killed, '故障采样期间 hang 进程必须仍在运行');
  }
  try {
    await Promise.race([
      ready,
      outcome.then(result => {
        throw result.error ?? new Error('hang 进程意外返回');
      }),
      new Promise((_, reject) => {
        readyTimer = setTimeout(() => reject(new Error('hang fixture 未就绪')), 3000);
      })
    ]);
    assertActive();
    return { assertActive, close };
  } catch (error) {
    await close();
    throw error;
  } finally {
    clearTimeout(readyTimer);
  }
}
