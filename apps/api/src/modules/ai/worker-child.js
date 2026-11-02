import { createAiWorker } from './worker.js';
import { createAiGateway } from './gateway.js';
import { createDeepSeekAdapter } from './infrastructure/providers/deepseek-adapter.ts';

let nextId = 0;
const pending = new Map();
const authorized = new Set();
let worker = null;
let paidAttemptId = null;
const rpc = (method, args) =>
  new Promise((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, { resolve, reject });
    process.send?.({ type: 'bridge', id, method, args });
  });
const repository = /** @type {import('./boundary-types.ts').WorkerOptions['repository']} */ (
  Object.fromEntries(
    ['identity', 'get', 'list', 'insert', 'replace', 'appendEvent', 'listEvents'].map(name => [
      name,
      (...args) => rpc(`repository.${name}`, args)
    ])
  )
);
const budget = /** @type {import('./boundary-types.ts').WorkerOptions['budget']} */ (
  Object.fromEntries(['reserve', 'settle'].map(name => [name, (...args) => rpc(`budget.${name}`, args)]))
);

const started = process.cpuUsage();
setInterval(() => {
  const cpu = process.cpuUsage(started);
  process.send?.({
    type: 'resource',
    rssBytes: process.memoryUsage().rss,
    cpuMs: Math.ceil((cpu.user + cpu.system) / 1000)
  });
}, 1000).unref();

process.on('message', async rawMessage => {
  const message = /** @type {import('./boundary-types.ts').WorkerMessage} */ (rawMessage);
  if (message?.type === 'bridgeResult') {
    const entry = pending.get(message.id);
    if (!entry) return;
    pending.delete(message.id);
    if (message.error) {
      /** @type {Error & Partial<Pick<import('../../errors/app-error.ts').AppError, 'code'>>} */
      const error = new Error(message.error.message);
      error.code = message.error.code;
      entry.reject(error);
    } else entry.resolve(message.result);
    return;
  }
  if (message?.type === 'cancel') {
    await worker?.cancel(message.jobId).catch(() => undefined);
    return;
  }
  if (message?.type !== 'run' || worker) return;
  try {
    const gateway = createAiGateway({
      adapter: createDeepSeekAdapter(),
      resolveCredential: reference => rpc('credential.resolve', [reference, message.jobId, paidAttemptId]),
      authorizePaidCall: request => {
        const allowed = authorized.delete(request.budgetAttemptId);
        if (allowed) paidAttemptId = request.budgetAttemptId;
        return allowed;
      }
    });
    worker = createAiWorker({
      repository,
      budget,
      gateway,
      priceProfile: message.priceProfile,
      limits: message.budgetLimits,
      allowExternal: message.allowExternal,
      verifySources: (job, request) => rpc('source.verify', [job.jobId, request]),
      validateResult: (job, result) => rpc('result.validate', [job.jobId, result]),
      authorizeAttempt: id => authorized.add(id),
      revokeAttempt: id => authorized.delete(id),
      logger: { warn() {}, error() {} }
    });
    await worker.run(message.jobId, message.request);
    process.send?.({ type: 'finished', status: 'succeeded' });
  } catch (error) {
    process.send?.({
      type: 'finished',
      status: 'failed',
      code: typeof error?.code === 'string' && /^AI_[A-Z0-9_]+$/.test(error.code) ? error.code : 'AI_TASK_FAILED'
    });
  }
});
