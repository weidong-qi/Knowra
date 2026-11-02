import { fork } from 'node:child_process';
import { hashRecord } from './record-contract.js';
import { createAiWorker } from './worker.js';
import { AI_PROCESS_LIMITS } from './isolated-provider.js';
import { watchChildResources } from './process-resource-guard.js';
import { createAiRecoveryScope } from './recovery-scope.js';

const kinds = new Set(['aiJob', 'aiJobAttempt', 'aiUsageRecord', 'aiGrant', 'contextManifest']);
const code = error =>
  typeof error?.code === 'string' && /^AI_[A-Z0-9_]{1,64}$/.test(error.code) ? error.code : 'AI_TASK_FAILED';
const failure = (name, message) => Object.assign(new Error(message), { code: name });

/** 每个执行任务有独立进程；子进程只能访问白名单 RPC，不能持有领域服务。 */
export function createIsolatedAiWorker({
  repository,
  budget,
  gateway,
  modelSettings,
  readContext,
  priceProfile,
  allowExternal,
  policy = null,
  logger = console,
  limits = AI_PROCESS_LIMITS,
  childUrl = new URL('./worker-child.js', import.meta.url),
  spawn = fork
}) {
  const active = new Map();
  const inFlight = new Set();
  const reservedAttempts = new Map();
  const plans = new Map();
  const waiting = [];
  let occupied = 0;
  let closed = false;
  const recovery = createAiRecoveryScope();
  const recoveryWorker = createAiWorker({
    repository,
    budget,
    gateway,
    priceProfile,
    allowExternal,
    verifySources: readContext ? (job, request) => readContext.verifyJobSources(job, request) : null,
    validateResult: readContext ? (job, result) => readContext.validateAnswer({ jobId: job.jobId, result }) : null,
    logger
  });

  function release() {
    const next = waiting.shift();
    if (next) next();
    else occupied = Math.max(0, occupied - 1);
  }
  async function run(jobId, request) {
    if (closed) throw failure('AI_GENERATION_UNAVAILABLE', 'AI 功能已关闭。');
    if (inFlight.has(jobId)) throw failure('AI_JOB_NOT_RUNNABLE', '任务已经在执行或排队。');
    if (occupied >= limits.concurrency) {
      if (waiting.length >= limits.queue) throw failure('AI_QUEUE_FULL', 'AI 请求队列已满。');
      inFlight.add(jobId);
      await new Promise(resolve => waiting.push(resolve));
    } else {
      occupied++;
      inFlight.add(jobId);
    }
    if (closed) {
      release();
      inFlight.delete(jobId);
      throw failure('AI_GENERATION_UNAVAILABLE', 'AI 功能已关闭。');
    }
    let requestBytes;
    try {
      requestBytes = Buffer.byteLength(JSON.stringify(request));
    } catch {
      release();
      inFlight.delete(jobId);
      throw failure('AI_REQUEST_INVALID', '模型请求无法序列化。');
    }
    if (requestBytes > limits.requestBytes) {
      release();
      inFlight.delete(jobId);
      throw failure('AI_REQUEST_LIMIT', '模型请求超过进程传输上限。');
    }
    let plan = null;
    if (policy) {
      try {
        plan = await policy.snapshot();
      } catch (error) {
        release();
        inFlight.delete(jobId);
        throw error;
      }
      // 等待策略期间执行器可能已被关闭：不能再启动子进程。
      if (closed) {
        release();
        inFlight.delete(jobId);
        throw failure('AI_GENERATION_UNAVAILABLE', 'AI 功能已关闭。');
      }
    }
    plans.set(jobId, plan);
    return /** @type {Promise<void>} */ (
      new Promise((resolve, reject) => {
        let child;
        try {
          child = spawn(childUrl, [], {
            execArgv: [`--max-old-space-size=${limits.heapMb}`],
            env: { NODE_ENV: 'production', ...(process.versions.electron ? { ELECTRON_RUN_AS_NODE: '1' } : {}) },
            stdio: ['ignore', 'ignore', 'ignore', 'ipc']
          });
        } catch {
          release();
          inFlight.delete(jobId);
          plans.delete(jobId);
          reject(failure('AI_PROCESS_FAILED', 'AI 执行进程启动失败。'));
          return;
        }
        let finished = false;
        const guard = watchChildResources(child, limits, () => {
          void stop(failure('AI_PROCESS_LIMIT', 'AI 执行进程超出资源限额。'));
        });
        const stop = async error => {
          if (finished) return;
          finished = true;
          clearTimeout(timer);
          guard.close();
          active.delete(jobId);
          inFlight.delete(jobId);
          plans.delete(jobId);
          for (const [attemptId, ownerJobId] of reservedAttempts) {
            if (ownerJobId === jobId) reservedAttempts.delete(attemptId);
          }
          child.kill('SIGKILL');
          release();
          if (error) {
            await failJob(jobId).catch(fault =>
              logger.warn?.('AI process failure settlement deferred', { code: code(fault) })
            );
            reject(error);
          } else resolve();
        };
        const timer = setTimeout(() => void stop(failure('AI_PROCESS_TIMEOUT', 'AI 执行进程超时。')), limits.wallMs);
        active.set(jobId, { child, stop });
        child.on('error', () => void stop(failure('AI_PROCESS_FAILED', 'AI 执行进程启动失败。')));
        child.on('exit', () => void stop(failure('AI_PROCESS_FAILED', 'AI 执行进程异常退出。')));
        child.on('message', message => {
          if (finished) return;
          if (message?.type === 'resource') {
            guard.report(message);
          } else if (message?.type === 'bridge') {
            void bridge(jobId, message.method, message.args).then(
              result => {
                if (!finished) child.send({ type: 'bridgeResult', id: message.id, result });
              },
              error => {
                if (!finished)
                  child.send({
                    type: 'bridgeResult',
                    id: message.id,
                    error: { code: code(error), message: 'AI 桥接操作失败。' }
                  });
              }
            );
          } else if (message?.type === 'finished') {
            if (Buffer.byteLength(JSON.stringify(message)) > limits.responseBytes) {
              void stop(failure('AI_RESPONSE_TOO_LARGE', 'AI 执行结果超过进程传输上限。'));
            } else {
              void stop(
                message.status === 'succeeded' ? null : failure(message.code ?? 'AI_TASK_FAILED', 'AI 任务执行失败。')
              );
            }
          }
        });
        child.send(
          {
            type: 'run',
            jobId,
            request,
            priceProfile: plan?.profile ?? priceProfile,
            budgetLimits: plan?.limits,
            allowExternal
          },
          error => {
            if (error) void stop(failure('AI_PROCESS_FAILED', 'AI 任务无法发送至执行进程。'));
          }
        );
      })
    );
  }

  async function bridge(jobId, method, args) {
    if (!active.has(jobId) || !Array.isArray(args) || args.length > 4)
      throw failure('AI_BRIDGE_REJECTED', 'AI 桥接请求无效。');
    if (method?.startsWith('repository.')) {
      const name = method.slice('repository.'.length);
      if (!['identity', 'get', 'list', 'insert', 'replace', 'appendEvent', 'listEvents'].includes(name)) {
        throw failure('AI_BRIDGE_REJECTED', 'AI 仓储操作未开放。');
      }
      if (['get', 'list', 'insert', 'replace'].includes(name) && !kinds.has(args[0])) {
        throw failure('AI_BRIDGE_REJECTED', 'AI 记录类型未开放。');
      }
      const job = await repository.get('aiJob', jobId);
      if (!job) throw failure('AI_JOB_NOT_FOUND', '任务不存在。');
      if (name === 'get') {
        if (
          !['aiJob', 'aiGrant', 'contextManifest', 'aiJobAttempt'].includes(args[0]) ||
          (args[0] === 'aiJob' && args[1] !== jobId) ||
          (args[0] === 'aiGrant' && args[1] !== job.grantId) ||
          (args[0] === 'contextManifest' && args[1] !== job.manifestId) ||
          (args[0] === 'aiJobAttempt' && (await repository.get('aiJobAttempt', args[1]))?.jobId !== jobId)
        ) {
          throw failure('AI_BRIDGE_REJECTED', 'AI 记录不属于当前任务。');
        }
      }
      if (name === 'list' && !(args[0] === 'aiJobAttempt' && args[1]?.jobId === jobId)) {
        throw failure('AI_BRIDGE_REJECTED', 'AI 列表范围不属于当前任务。');
      }
      if (
        ['insert', 'replace'].includes(name) &&
        !(
          (args[0] === 'aiJob' && name === 'replace' && args[1]?.jobId === jobId) ||
          (args[0] === 'aiJobAttempt' && args[1]?.jobId === jobId) ||
          (args[0] === 'aiUsageRecord' && name === 'insert' && args[1]?.jobId === jobId)
        )
      )
        throw failure('AI_BRIDGE_REJECTED', 'AI 写入不属于当前任务。');
      if (
        name === 'replace' &&
        args[0] === 'aiJobAttempt' &&
        (await repository.get('aiJobAttempt', args[1]?.attemptId))?.jobId !== jobId
      ) {
        throw failure('AI_BRIDGE_REJECTED', 'AI 尝试不属于当前任务。');
      }
      if ((name === 'appendEvent' && args[0]?.jobId !== jobId) || (name === 'listEvents' && args[0] !== jobId)) {
        throw failure('AI_BRIDGE_REJECTED', 'AI 任务边界不匹配。');
      }
      return repository[name](...args);
    }
    if (method === 'budget.reserve' || method === 'budget.settle') {
      if (
        args[0]?.accountRef !== 'deepseek-primary' ||
        (await repository.get('aiJobAttempt', args[0]?.attemptId))?.jobId !== jobId ||
        (method === 'budget.reserve' && args[0]?.jobId !== jobId)
      ) {
        throw failure('AI_BRIDGE_REJECTED', '预算尝试不属于当前任务。');
      }
      // 预留之前再复核一次暂停状态：任务排队、等待余额刷新期间用户可能已暂停。
      if (method === 'budget.reserve' && policy) await policy.assertRunnable();
      // 上限由父进程按用户设置决定，子进程传来的 limits 一律以父进程的快照覆盖，子进程无法放宽。
      const input = method === 'budget.reserve' ? { ...args[0], limits: plans.get(jobId)?.limits } : args[0];
      if (input.limits === undefined) delete input.limits;
      const result = await budget[method.slice('budget.'.length)](input, ...args.slice(1));
      if (method === 'budget.reserve') reservedAttempts.set(args[0].attemptId, jobId);
      else reservedAttempts.delete(args[0].attemptId);
      return result;
    }
    if (method === 'credential.resolve') {
      if (args[1] !== jobId) throw failure('AI_BRIDGE_REJECTED', '凭据任务不匹配。');
      const job = await repository.get('aiJob', jobId);
      const attempt = await repository.get('aiJobAttempt', args[2]);
      if (
        !job ||
        job.credentialRef !== args[0] ||
        job.status !== 'running' ||
        attempt?.jobId !== jobId ||
        attempt.status !== 'sent' ||
        reservedAttempts.get(attempt.attemptId) !== jobId
      ) {
        throw failure('AI_BRIDGE_REJECTED', '凭据读取未通过任务边界。');
      }
      if (policy) await policy.assertRunnable(); // 解析密钥之后就是真正发送，最后一次复核暂停状态
      return modelSettings.resolveCredential(args[0]);
    }
    if (method === 'source.verify' || method === 'result.validate') {
      if (args[0] !== jobId || !readContext) throw failure('AI_BRIDGE_REJECTED', '来源服务未开放。');
      const job = await repository.get('aiJob', jobId);
      if (!job) throw failure('AI_JOB_NOT_FOUND', '任务不存在。');
      return method === 'source.verify'
        ? readContext.verifyJobSources(job, args[1])
        : readContext.validateAnswer({ jobId, result: args[1] });
    }
    throw failure('AI_BRIDGE_REJECTED', 'AI 桥接操作未开放。');
  }

  async function failJob(jobId) {
    const attempts = await repository.list('aiJobAttempt', { jobId });
    const activeAttempt = attempts.sort((a, b) => b.ordinal - a.ordinal)[0];
    if (activeAttempt && ['leased', 'sent'].includes(activeAttempt.status)) {
      reservedAttempts.delete(activeAttempt.attemptId);
      await Promise.resolve()
        .then(() =>
          budget.settle({
            accountRef: 'deepseek-primary',
            attemptId: activeAttempt.attemptId,
            disposition: activeAttempt.status === 'sent' ? 'unknown' : 'released'
          })
        )
        .catch(error => {
          if (!['AI_BUDGET_NOT_FOUND', 'AI_BUDGET_CONFLICT'].includes(error.code)) throw error;
        });
      await repository.replace(
        'aiJobAttempt',
        {
          ...activeAttempt,
          status: 'timedOut',
          deliveryUncertain: activeAttempt.status === 'sent',
          finishedAt: new Date().toISOString()
        },
        hashRecord(activeAttempt)
      );
    }
    const job = await repository.get('aiJob', jobId);
    if (job && ['pending', 'retrying', 'running', 'cancelling'].includes(job.status)) {
      await repository.replace(
        'aiJob',
        {
          ...job,
          status: job.status === 'cancelling' ? 'cancelled' : 'failed',
          phase: 'finished',
          updatedAt: new Date(Math.max(Date.now(), Date.parse(job.updatedAt) + 1)).toISOString()
        },
        hashRecord(job)
      );
    }
  }

  async function cancel(jobId) {
    const result = await recoveryWorker.cancel(jobId);
    const running = active.get(jobId);
    if (running) {
      running.child.send({ type: 'cancel', jobId });
      setTimeout(() => void running.stop(failure('AI_CANCELLED', '任务已取消。')), 250).unref?.();
    }
    return result;
  }
  function close() {
    closed = true;
    return recovery.close(async () => {
      while (waiting.length) waiting.shift()();
      await Promise.all(
        [...active.keys()].map(async jobId => {
          await Promise.resolve()
            .then(() => recoveryWorker.cancel(jobId))
            .catch(() => undefined);
          await active.get(jobId)?.stop(failure('AI_CANCELLED', 'AI 功能已关闭。'));
        })
      );
    });
  }
  return { run, cancel, recover: () => recovery.run(recoveryWorker.recover), close };
}
