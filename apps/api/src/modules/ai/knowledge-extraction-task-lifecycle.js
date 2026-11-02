import { randomUUID } from 'node:crypto';
import { hashRecord } from './record-contract.ts';
import { EXTRACTION_MOCK_PROFILE as profile, taskError, taskTime } from './knowledge-extraction-task-contract.js';
import { requireTask, verifyTaskRequest } from './knowledge-extraction-task-context.js';

export function* replaceTaskJob(ai, job, patch, now) {
  return yield ai.replace('aiJob', { ...job, ...patch, updatedAt: taskTime(now, job.updatedAt) }, hashRecord(job));
}
export function* taskEvent(ai, jobId, eventKind, safePayload, now) {
  const sequence = (yield ai.listEvents(jobId)).length + 1;
  yield ai.appendEvent({ jobId, sequence, eventKind, safePayload, createdAt: now.toISOString() });
}
const active = attempt => attempt && ['leased', 'sent'].includes(attempt.status);
const latest = attempts => [...attempts].sort((a, b) => b.leaseGeneration - a.leaseGeneration)[0];

/** 以下步骤全部运行在宿主短事务内；没有 Gateway、计费或等待。 */
export function createExtractionTaskLifecycle({ store, ownerId, clock, workerId }) {
  function* load(context, jobId) {
    return yield* requireTask(context, store, ownerId, jobId);
  }
  function* finishAttempt(ai, attempt, status, now) {
    if (active(attempt))
      yield ai.replace(
        'aiJobAttempt',
        {
          ...attempt,
          status,
          // 此执行器只运行 Mock，不能把模拟响应记成真实供应商交付不确定。
          deliveryUncertain: false,
          finishedAt: now.toISOString()
        },
        hashRecord(attempt)
      );
  }
  return {
    load,
    *claim(context, jobId) {
      const task = yield* load(context, jobId),
        { job } = task,
        ai = context.aiRepository;
      if (!['pending', 'retrying'].includes(job.status))
        throw taskError('KNOWLEDGE_EXTRACTION_NOT_RUNNABLE', '提炼任务当前不可领取。');
      yield* verifyTaskRequest(context, ownerId, task, clock);
      const attempts = yield ai.list('aiJobAttempt', { jobId });
      if (attempts.length >= profile.maxAttempts)
        throw taskError('KNOWLEDGE_EXTRACTION_ATTEMPT_LIMIT', '提炼任务已达到四次尝试上限。');
      const now = clock();
      yield* replaceTaskJob(ai, job, { status: 'running', phase: 'generating' }, now);
      const attempt = yield ai.insert('aiJobAttempt', {
        contractVersion: 1,
        kind: 'aiJobAttempt',
        attemptId: randomUUID(),
        jobId,
        ordinal: attempts.length + 1,
        leaseGeneration: Math.max(0, ...attempts.map(item => item.leaseGeneration)) + 1,
        leaseOwner: workerId,
        leaseExpiresAt: new Date(now.getTime() + profile.leaseMs).toISOString(),
        providerRequestId: null,
        deliveryUncertain: false,
        status: 'leased',
        startedAt: now.toISOString(),
        finishedAt: null
      });
      yield* taskEvent(ai, jobId, 'attemptPrepared', { attemptId: attempt.attemptId, status: 'running' }, now);
      return attempt;
    },
    *send(context, jobId, attemptId) {
      const task = yield* load(context, jobId),
        ai = context.aiRepository;
      const attempt = yield ai.get('aiJobAttempt', attemptId);
      const newest = latest(yield ai.list('aiJobAttempt', { jobId }));
      if (
        task.job.status !== 'running' ||
        !attempt ||
        attempt.jobId !== jobId ||
        attempt.status !== 'leased' ||
        newest?.attemptId !== attemptId ||
        Date.parse(attempt.leaseExpiresAt) <= clock().getTime()
      ) {
        throw taskError('KNOWLEDGE_EXTRACTION_ATTEMPT_STALE', '提炼已取消或租约失效，未发送请求。');
      }
      const verified = yield* verifyTaskRequest(context, ownerId, task, clock);
      if (
        Date.parse(attempt.leaseExpiresAt) <= clock().getTime() ||
        Date.parse(verified.grantExpiresAt) <= clock().getTime()
      ) {
        throw taskError('KNOWLEDGE_EXTRACTION_ATTEMPT_STALE', '提炼发送前租约或授权到期。');
      }
      yield ai.replace('aiJobAttempt', { ...attempt, status: 'sent' }, hashRecord(attempt));
      yield* taskEvent(ai, jobId, 'providerRequestStarted', { attemptId, deliveryUncertain: false }, clock());
      return { ...verified, scopeId: task.descriptor.scopeId };
    },
    *fail(context, jobId, attemptId, error) {
      const { job } = yield* load(context, jobId),
        ai = context.aiRepository;
      const attempts = yield ai.list('aiJobAttempt', { jobId });
      const attempt = latest(attempts);
      // 另一 worker 的新代、已接纳或已终止任务不能被迟到失败覆盖。
      if (attemptId) {
        if (attempt?.attemptId !== attemptId || !active(attempt) || !['running', 'cancelling'].includes(job.status))
          return;
      } else if (active(attempt) || !['pending', 'retrying'].includes(job.status)) return;
      const now = clock(),
        cancelled = job.status === 'cancelling';
      yield* finishAttempt(
        ai,
        attempt,
        cancelled ? 'cancelled' : Date.parse(attempt?.leaseExpiresAt) <= now.getTime() ? 'timedOut' : 'rejected',
        now
      );
      yield* replaceTaskJob(ai, job, { status: cancelled ? 'cancelled' : 'failed', phase: 'finished' }, now);
      const code =
        typeof error?.code === 'string' && /^[A-Z0-9_]{1,100}$/.test(error.code)
          ? error.code
          : 'KNOWLEDGE_EXTRACTION_FAILED';
      yield* taskEvent(ai, jobId, 'attemptFailed', { code, status: cancelled ? 'cancelled' : 'failed' }, now);
    },
    *cancel(context, jobId) {
      const { job } = yield* load(context, jobId),
        ai = context.aiRepository;
      if (['succeeded', 'cancelled', 'failed'].includes(job.status)) return job;
      const now = clock();
      const cancelling =
        job.status === 'cancelling' ? job : yield* replaceTaskJob(ai, job, { status: 'cancelling' }, now);
      const attempt = latest(yield ai.list('aiJobAttempt', { jobId }));
      yield* finishAttempt(ai, attempt, 'cancelled', now);
      return yield* replaceTaskJob(ai, cancelling, { status: 'cancelled', phase: 'finished' }, now);
    },
    *retry(context, jobId) {
      const task = yield* load(context, jobId),
        ai = context.aiRepository;
      if (task.job.status !== 'failed')
        throw taskError('KNOWLEDGE_EXTRACTION_NOT_RETRYABLE', '仅失败的提炼任务可显式重试。');
      const attempts = yield ai.list('aiJobAttempt', { jobId });
      if (attempts.length >= profile.maxAttempts)
        throw taskError('KNOWLEDGE_EXTRACTION_ATTEMPT_LIMIT', '提炼任务已达到四次尝试上限。');
      yield* verifyTaskRequest(context, ownerId, task, clock);
      return yield* replaceTaskJob(ai, task.job, { status: 'retrying', phase: 'preparing' }, clock());
    },
    *recover(context) {
      const ai = context.aiRepository,
        identity = yield ai.identity();
      const descriptors = yield store.list({ ownerId, ...identity }, context.transaction);
      const changed = [];
      for (const descriptor of descriptors) {
        if (descriptor.datasetEpoch !== identity.datasetEpoch) continue;
        const { job } = yield* load(context, descriptor.jobId);
        if (!['pending', 'retrying', 'running', 'cancelling'].includes(job.status)) continue;
        const attempt = latest(yield ai.list('aiJobAttempt', { jobId: job.jobId }));
        if (job.status === 'running' && active(attempt) && Date.parse(attempt.leaseExpiresAt) > clock().getTime())
          continue;
        const now = clock(),
          cancelled = job.status === 'cancelling';
        yield* finishAttempt(ai, attempt, cancelled ? 'cancelled' : 'timedOut', now);
        yield* replaceTaskJob(ai, job, { status: cancelled ? 'cancelled' : 'failed', phase: 'finished' }, now);
        yield* taskEvent(ai, job.jobId, 'recoveryRequired', { status: cancelled ? 'cancelled' : 'failed' }, now);
        changed.push(job.jobId);
      }
      return changed;
    }
  };
}
