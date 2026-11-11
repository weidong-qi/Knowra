import { AI_PROCESS_LIMITS } from './isolated-provider.js';
import {
  assertMockGateway,
  EXTRACTION_MOCK_PROFILE as profile,
  taskError
} from './knowledge-extraction-task-contract.ts';

import type { AiJobAttempt } from './record-types.ts';
import type { ProviderRequest } from './infrastructure/providers/deepseek-adapter.ts';
import type { GatewayResult } from './boundary-types.ts';
import type { ExtractionMockGateway } from './knowledge-extraction-task-types.ts';

export interface ExtractionMockWorkerOptions<Accepted, Failed> {
  gateway: ExtractionMockGateway;
  claim: (jobId: string) => PromiseLike<Pick<AiJobAttempt, 'attemptId' | 'leaseExpiresAt'>>;
  send: (
    jobId: string,
    attemptId: string
  ) => PromiseLike<{ request: ProviderRequest; grantExpiresAt: string; scopeId: string }>;
  accept: (input: {
    jobId: string;
    attemptId: string;
    scopeId: string;
    result: GatewayResult;
  }) => Accepted | PromiseLike<Accepted>;
  fail: (jobId: string, attemptId: string | null, error: unknown) => Promise<Failed>;
  clock: () => Date;
  schedule?: (operation: () => void) => void;
  logger?: { warn?: (message: string, detail: { code: string }) => void };
}

/** 仅 Mock；队列是唤醒信号，领取/取消/结果权威均在宿主事务。 */
export function createExtractionMockWorker<Accepted, Failed>({
  gateway,
  claim,
  send,
  accept,
  fail,
  clock,
  schedule = queueMicrotask,
  logger = console
}: ExtractionMockWorkerOptions<Accepted, Failed>) {
  const pending = new Set<string>(),
    active = new Map<string, AbortController>();
  const running = new Set<Promise<void>>();
  let scheduled = false,
    closed = false;
  const log = (error: unknown) =>
    logger.warn?.('Mock extraction task stopped', {
      code:
        typeof (error as { code?: unknown } | null | undefined)?.code === 'string' &&
        /^[A-Z0-9_]{1,100}$/.test((error as { code: string }).code)
          ? (error as { code: string }).code
          : 'KNOWLEDGE_EXTRACTION_FAILED'
    });
  const wake = () => {
    if (scheduled || closed) return;
    scheduled = true;
    schedule(() => {
      scheduled = false;
      drain();
    });
  };
  function drain() {
    while (!closed && pending.size && active.size < AI_PROCESS_LIMITS.concurrency) {
      // 恢复后的显式 retry 可先排队；同 job 旧 run 收尾前不再次领取，也不堵住其他任务。
      const jobId = [...pending].find(id => !active.has(id));
      if (jobId === undefined) break;
      pending.delete(jobId);
      void run(jobId).catch(log);
    }
  }
  function run(jobId: string) {
    const promise = execute(jobId);
    running.add(promise);
    const done = () => {
      running.delete(promise);
      wake();
    };
    promise.then(done, done);
    return promise;
  }
  async function execute(jobId: string) {
    if (closed || active.has(jobId))
      throw taskError('KNOWLEDGE_EXTRACTION_NOT_RUNNABLE', '提炼执行器已关闭或任务正在执行。');
    if (active.size >= AI_PROCESS_LIMITS.concurrency)
      throw taskError('KNOWLEDGE_EXTRACTION_QUEUE_FULL', '提炼执行器繁忙。');
    pending.delete(jobId);
    const controller = new AbortController();
    active.set(jobId, controller);
    let attempt: Pick<AiJobAttempt, 'attemptId' | 'leaseExpiresAt'> | undefined,
      timer: ReturnType<typeof setTimeout> | undefined,
      abort: (() => void) | undefined;
    try {
      assertMockGateway(gateway);
      attempt = await claim(jobId);
      const prepared = await send(jobId, attempt.attemptId);
      assertMockGateway(gateway);
      if (controller.signal.aborted) throw taskError('KNOWLEDGE_EXTRACTION_CANCELLED', '提炼任务已取消。');
      const remaining = Math.min(
        profile.leaseMs,
        Date.parse(attempt.leaseExpiresAt) - clock().getTime(),
        Date.parse(prepared.grantExpiresAt) - clock().getTime()
      );
      if (remaining <= 0) throw taskError('KNOWLEDGE_EXTRACTION_ATTEMPT_STALE', '提炼租约已失效。');
      const interrupted = new Promise<never>((_, reject) => {
        abort = () => reject(taskError('KNOWLEDGE_EXTRACTION_CANCELLED', '提炼执行已取消或超时。'));
        controller.signal.addEventListener('abort', abort, { once: true });
        timer = setTimeout(() => controller.abort(), remaining);
        timer.unref?.();
      });
      const result = await Promise.race([
        gateway.complete({ ...prepared.request, signal: controller.signal }),
        interrupted
      ]);
      if (controller.signal.aborted) throw taskError('KNOWLEDGE_EXTRACTION_CANCELLED', '提炼任务已取消。');
      assertMockGateway(gateway);
      await accept({ jobId, attemptId: attempt.attemptId, scopeId: prepared.scopeId, result });
    } catch (error) {
      // 失去领取竞争时不能结束其他 worker 正在执行的任务。
      await fail(jobId, attempt?.attemptId ?? null, error).catch(log);
      throw error;
    } finally {
      clearTimeout(timer);
      controller.signal.removeEventListener('abort', abort!);
      active.delete(jobId);
    }
  }
  return {
    run,
    enqueue(jobId: string) {
      if (closed) throw taskError('KNOWLEDGE_EXTRACTION_NOT_RUNNABLE', '提炼执行器已关闭。');
      if (pending.has(jobId)) return;
      if (pending.size >= AI_PROCESS_LIMITS.queue)
        throw taskError('KNOWLEDGE_EXTRACTION_QUEUE_FULL', '提炼等待队列已满，任务已保存，可稍后恢复。');
      pending.add(jobId);
      wake();
    },
    abort(jobId: string) {
      pending.delete(jobId);
      active.get(jobId)?.abort();
    },
    async idle() {
      while (pending.size || running.size) {
        drain();
        await Promise.allSettled([...running]);
      }
    },
    async close() {
      closed = true;
      pending.clear();
      for (const controller of active.values()) controller.abort();
      await Promise.allSettled([...running]);
    }
  };
}
