import { randomUUID } from 'node:crypto';
import { assertMockGateway, runTaskSteps, taskError, taskId } from './knowledge-extraction-task-contract.js';
import { buildTaskRecords, prepareTaskSources } from './knowledge-extraction-task-context.js';
import { createExtractionTaskLifecycle, taskEvent } from './knowledge-extraction-task-lifecycle.js';
import { createExtractionMockWorker } from './knowledge-extraction-mock-worker.js';
import { createExtractionTaskQueries } from './knowledge-extraction-task-queries.ts';

/** 仅受信宿主显式注入 Mock 才装配；HTTP 包装不扩展真实执行权限或默认启动能力。 */
export function createKnowledgeExtractionTaskService({
  store,
  createContext,
  ownerId,
  commit,
  receiptStore,
  gateway,
  clock = () => new Date(),
  workerId = randomUUID(),
  maintenanceGate = null,
  schedule,
  logger = console
}) {
  if (!store || !createContext || !ownerId || !commit || !receiptStore)
    throw new TypeError('提炼任务需要同库宿主事务和接纳服务。');
  let closed = false;
  const background = new Set();
  const trackBackground = promise => {
    background.add(promise);
    const done = () => background.delete(promise);
    promise.then(done, done);
    return promise;
  };
  const lifecycle = createExtractionTaskLifecycle({ store, ownerId, clock, workerId });
  const transact = (operation, jobId) =>
    store.runTransaction(tx => runTaskSteps(operation(createContext(tx)), store.supportsAsync), { jobId });
  const mutate = (operation, jobId) =>
    Promise.resolve().then(() =>
      maintenanceGate ? maintenanceGate.runMutation(() => transact(operation, jobId)) : transact(operation, jobId)
    );
  const read = (operation, jobId) =>
    Promise.resolve().then(() =>
      maintenanceGate ? maintenanceGate.runOperation(() => transact(operation, jobId)) : transact(operation, jobId)
    );
  const canUse = () => {
    const gate = maintenanceGate?.getState();
    return !closed && !gate?.maintenanceActive && !gate?.waitingMaintenances;
  };
  const worker = createExtractionMockWorker({
    gateway,
    clock,
    schedule,
    logger,
    claim: jobId => mutate(context => lifecycle.claim(context, jobId), jobId),
    send: (jobId, attemptId) => mutate(context => lifecycle.send(context, jobId, attemptId), jobId),
    accept: input => (maintenanceGate ? maintenanceGate.runMutation(() => commit.commit(input)) : commit.commit(input)),
    fail: (jobId, attemptId, error) => mutate(context => lifecycle.fail(context, jobId, attemptId, error), jobId)
  });

  function* view(context, jobId) {
    const { job, descriptor } = yield* lifecycle.load(context, jobId);
    let candidateIds = [];
    if (job.status === 'succeeded') {
      const receipt = yield receiptStore.get(job, context.transaction);
      if (
        !receipt ||
        receipt.scopeId !== descriptor.scopeId ||
        receipt.outputHash !== job.outputHash ||
        receipt.attemptId !== job.acceptedAttemptId ||
        receipt.datasetEpoch !== job.datasetEpoch
      ) {
        throw taskError('KNOWLEDGE_EXTRACTION_TASK_INVALID', '提炼成功任务与核心回执不一致。');
      }
      candidateIds = receipt.candidates.map(item => item.candidateInput.id);
    }
    return {
      jobId,
      scopeId: descriptor.scopeId,
      spaceId: job.spaceId,
      executionMode: 'mock',
      status: job.status,
      phase: job.phase,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
      candidateIds
    };
  }
  function checkJobId(jobId) {
    if (!taskId(jobId)) throw taskError('KNOWLEDGE_EXTRACTION_REQUEST_INVALID', '提炼任务 ID 无效。', 422);
  }
  const get = jobId => {
    checkJobId(jobId);
    return mutate(context => view(context, jobId), jobId);
  };
  const enqueue = async jobId => {
    try {
      worker.enqueue(jobId);
    } catch (error) {
      await mutate(context => lifecycle.fail(context, jobId, null, error), jobId);
      throw error;
    }
  };
  const queries = createExtractionTaskQueries({ read, load: lifecycle.load, view, store, ownerId, clock, canUse });
  return {
    get,
    ready: () => {
      assertMockGateway(gateway);
      return trackBackground(queries.ready());
    },
    list: queries.list,
    inspect: jobId => {
      checkJobId(jobId);
      return queries.inspect(jobId);
    },
    async start(input) {
      assertMockGateway(gateway);
      if (
        !input ||
        typeof input !== 'object' ||
        Array.isArray(input) ||
        Object.keys(input).length !== 2 ||
        !Object.hasOwn(input, 'scopeId') ||
        !Object.hasOwn(input, 'idempotencyKey') ||
        !taskId(input.scopeId) ||
        !taskId(input.idempotencyKey)
      ) {
        throw taskError('KNOWLEDGE_EXTRACTION_REQUEST_INVALID', '提炼只接受已保存 scopeId 和幂等键。', 422);
      }
      const captured = structuredClone(input);
      const result = await mutate(function* (context) {
        const ai = context.aiRepository,
          identity = yield ai.identity();
        // 先找整束记录：同键响应丢失不能先创建新的授权/manifest UUID。
        const jobs = yield ai.list('aiJob', {
          ownerId,
          datasetId: identity.datasetId,
          jobKind: 'knowledgeExtraction',
          idempotencyKey: captured.idempotencyKey
        });
        const scope = yield context.repositories.analysisScopeRepository.findById(captured.scopeId);
        if (!scope) throw taskError('KNOWLEDGE_EXTRACTION_SCOPE_FORBIDDEN', '提炼范围不存在。');
        const existing = jobs.find(job => job.spaceId === scope.spaceId);
        if (existing) {
          const { descriptor } = yield* lifecycle.load(context, existing.jobId);
          if (descriptor.scopeId !== captured.scopeId || descriptor.scopeInputHash !== scope.inputHash) {
            throw taskError('AI_IDEMPOTENCY_CONFLICT', '同一幂等键已经绑定其他提炼输入。');
          }
          return { created: false, view: yield* view(context, existing.jobId) };
        }
        const prepared = yield* prepareTaskSources(context, ownerId, captured.scopeId, captured.idempotencyKey);
        const records = buildTaskRecords(prepared, identity, ownerId, captured.idempotencyKey, clock());
        for (const [kind, record] of [
          ['scopeSnapshot', records.snapshot],
          ['contextManifest', records.manifest],
          ['aiGrant', records.grant],
          ['aiJob', records.job]
        ]) {
          yield ai.insert(kind, record);
        }
        yield store.insert(records.descriptor, context.transaction);
        yield* taskEvent(ai, records.job.jobId, 'taskCreated', { status: 'pending', phase: 'preparing' }, clock());
        return { created: true, view: yield* view(context, records.job.jobId) };
      });
      if (result.created) await enqueue(result.view.jobId);
      return result.view;
    },
    async cancel(jobId) {
      checkJobId(jobId);
      await mutate(context => lifecycle.cancel(context, jobId), jobId);
      worker.abort(jobId);
      return get(jobId);
    },
    async retry(jobId) {
      checkJobId(jobId);
      assertMockGateway(gateway);
      await mutate(context => lifecycle.retry(context, jobId), jobId);
      await enqueue(jobId);
      return get(jobId);
    },
    recover() {
      if (closed) return Promise.reject(taskError('KNOWLEDGE_EXTRACTION_NOT_RUNNABLE', '提炼服务已关闭。'));
      return trackBackground(
        mutate(context => lifecycle.recover(context)).then(changed => {
          changed.forEach(jobId => worker.abort(jobId));
          return changed.length;
        })
      );
    },
    run: jobId => {
      checkJobId(jobId);
      return worker.run(jobId);
    },
    idle: () => worker.idle(),
    async close() {
      closed = true;
      // 不占维护门等待：后台 ready/recover 和 worker 收尾仍需要进入各自短事务。
      await Promise.allSettled([worker.close(), ...background]);
    }
  };
}
