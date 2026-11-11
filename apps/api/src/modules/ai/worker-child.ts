import type { AppError } from '../../errors/app-error.ts';
import type { WorkerOptions, GatewayOptions } from './boundary-types.ts';
import type { GatewayRequest } from './gateway.ts';

type Worker = ReturnType<typeof createAiWorker>;
// 父进程 IPC 字段先按未校验输入读取；交给既有 worker/gateway 边界处理。
interface RawWorkerMessage {
  type?: unknown;
  id?: unknown;
  error?: { message?: unknown; code?: unknown } | null;
  result?: unknown;
  jobId?: unknown;
  request?: unknown;
  priceProfile?: unknown;
  budgetLimits?: unknown;
  allowExternal?: unknown;
}

import { createAiWorker } from './worker.ts';
import { createAiGateway } from './gateway.ts';
import { createDeepSeekAdapter } from './infrastructure/providers/deepseek-adapter.ts';

let nextId = 0;
const pending = new Map<unknown, { resolve: (result: unknown) => void; reject: (error: AppError) => void }>();
const authorized = new Set<string | undefined>();
let worker: Worker | null = null;
let paidAttemptId: string | undefined | null = null;
const rpc = (method: string, args: unknown[]) =>
  new Promise<unknown>((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, { resolve, reject });
    process.send?.({ type: 'bridge', id, method, args });
  });
// 这些代理只转发受信父进程的服务返回值，不在 IPC 层另建运行时协议。
const repository = Object.fromEntries(
  ['identity', 'get', 'list', 'insert', 'replace', 'appendEvent', 'listEvents'].map(name => [
    name,
    (...args: unknown[]) => rpc(`repository.${name}`, args)
  ])
) as Partial<NonNullable<WorkerOptions['repository']>> as NonNullable<WorkerOptions['repository']>;
const budget = Object.fromEntries(
  ['reserve', 'settle'].map(name => [name, (...args: unknown[]) => rpc(`budget.${name}`, args)])
) as NonNullable<WorkerOptions['budget']>;

const started = process.cpuUsage();
setInterval(() => {
  const cpu = process.cpuUsage(started);
  process.send?.({
    type: 'resource',
    rssBytes: process.memoryUsage().rss,
    cpuMs: Math.ceil((cpu.user + cpu.system) / 1000)
  });
}, 1000).unref();

process.on('message', async (rawMessage: unknown) => {
  const message = rawMessage as RawWorkerMessage | null;
  if (message?.type === 'bridgeResult') {
    const entry = pending.get(message.id);
    if (!entry) return;
    pending.delete(message.id);
    if (message.error) {
      const error = new Error(message.error.message as string | undefined) as AppError;
      error.code = message.error.code as string;
      entry.reject(error);
    } else entry.resolve(message.result);
    return;
  }
  if (message?.type === 'cancel') {
    await worker?.cancel(message.jobId as string).catch(() => undefined);
    return;
  }
  if (message?.type !== 'run' || worker) return;
  try {
    const gateway = createAiGateway({
      adapter: createDeepSeekAdapter(),
      resolveCredential: reference =>
        rpc('credential.resolve', [reference, message.jobId, paidAttemptId]) as ReturnType<
          NonNullable<GatewayOptions['resolveCredential']>
        >,
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
      priceProfile: message.priceProfile as WorkerOptions['priceProfile'],
      limits: message.budgetLimits as WorkerOptions['limits'],
      allowExternal: message.allowExternal as WorkerOptions['allowExternal'],
      verifySources: (job, request) =>
        rpc('source.verify', [job.jobId, request]) as ReturnType<NonNullable<WorkerOptions['verifySources']>>,
      validateResult: (job, result) =>
        rpc('result.validate', [job.jobId, result]) as ReturnType<NonNullable<WorkerOptions['validateResult']>>,
      authorizeAttempt: id => authorized.add(id),
      revokeAttempt: id => authorized.delete(id),
      logger: { warn() {}, error() {} }
    });
    await worker.run(message.jobId as string, message.request as GatewayRequest);
    process.send?.({ type: 'finished', status: 'succeeded' });
  } catch (error) {
    process.send?.({
      type: 'finished',
      status: 'failed',
      code:
        typeof (error as Partial<AppError> | null)?.code === 'string' &&
        /^AI_[A-Z0-9_]+$/.test((error as AppError).code)
          ? (error as AppError).code
          : 'AI_TASK_FAILED'
    });
  }
});
