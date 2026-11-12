import { fork } from 'node:child_process';
import { AiGatewayError } from './gateway.ts';
import { watchChildResources } from './process-resource-guard.ts';

export const AI_PROCESS_LIMITS = Object.freeze({
  concurrency: 2,
  queue: 8,
  wallMs: 100_000,
  heapMb: 128,
  cpuMs: 20_000,
  rssBytes: 201_326_592,
  requestBytes: 1_048_576,
  responseBytes: 4_194_304
});

/** 仅供应商网络调用进入子进程；业务读写、授权及预算始终留在宿主。 */
export function createIsolatedDeepSeekAdapter({
  childUrl = new URL('./provider-child.js', import.meta.url),
  limits = AI_PROCESS_LIMITS,
  spawn = fork
} = {}) {
  let active = 0;
  const waiting = [];
  const capabilities = () => ({
    provider: 'deepseek',
    protocol: 'chat-completions',
    advertised: {
      text: true,
      streaming: true,
      toolCalls: true,
      jsonObject: true,
      cancel: true,
      usage: true
    },
    verified: false
  });

  const queueTimeout = () => new AiGatewayError('AI_QUEUE_TIMEOUT', 'AI 请求排队超时，请重试。', { retryable: true });

  function enter(signal, expiresAt) {
    if (signal?.aborted) return Promise.reject(new AiGatewayError('AI_CANCELLED', '模型请求已取消。'));
    const remaining = expiresAt === undefined ? limits.wallMs : Math.min(limits.wallMs, expiresAt - Date.now());
    if (!Number.isFinite(remaining) || remaining <= 0) return Promise.reject(queueTimeout());
    if (active < limits.concurrency) {
      active++;
      return Promise.resolve();
    }
    if (waiting.length >= limits.queue) return Promise.reject(new AiGatewayError('AI_QUEUE_FULL', 'AI 请求队列已满。'));
    return new Promise((resolve, reject) => {
      const item = { resolve, reject, signal, abort: null, timer: null };
      const cancel = error => {
        const index = waiting.indexOf(item);
        if (index < 0) return;
        waiting.splice(index, 1);
        clearTimeout(item.timer);
        signal?.removeEventListener('abort', item.abort);
        reject(error);
      };
      item.abort = () => cancel(new AiGatewayError('AI_CANCELLED', '模型请求已取消。'));
      signal?.addEventListener('abort', item.abort, { once: true });
      waiting.push(item);
      item.timer = setTimeout(() => cancel(queueTimeout()), remaining);
      item.timer.unref?.();
    });
  }
  function leave() {
    const item = waiting.shift();
    if (item) {
      clearTimeout(item.timer);
      item.signal?.removeEventListener('abort', item.abort);
      item.resolve();
    } else active--;
  }

  return {
    provider: 'deepseek',
    deferredSendValidation: true,
    capabilities,
    /** @param {import('./infrastructure/providers/deepseek-adapter.ts').ProviderRequest} request
     * @param {Parameters<import('./boundary-types.ts').GatewayOptions['adapter']['complete']>[1]} [control]
     */
    async complete(request, { verifyBeforeSend, onSend, expiresAt } = {}) {
      // 信号不可通过 IPC 克隆；其余字段必须有上限，防止子进程内存积压。
      const { signal, ...payload } = request;
      const size = Buffer.byteLength(JSON.stringify(payload));
      if (size > limits.requestBytes) throw new AiGatewayError('AI_REQUEST_LIMIT', '模型请求超过进程传输上限。');
      const deadline = Math.min(Date.now() + limits.wallMs, expiresAt ?? Infinity);
      await enter(signal, deadline);
      try {
        if (signal?.aborted) throw new AiGatewayError('AI_CANCELLED', '模型请求已取消。');
        if (typeof verifyBeforeSend === 'function') await verifyBeforeSend();
        if (signal?.aborted) throw new AiGatewayError('AI_CANCELLED', '模型请求已取消。');
        if (deadline <= Date.now()) throw queueTimeout();
        onSend?.();
        return await new Promise((resolve, reject) => {
          const child = spawn(childUrl, [], {
            execArgv: [`--max-old-space-size=${limits.heapMb}`],
            env: { NODE_ENV: 'production', ...(process.versions.electron ? { ELECTRON_RUN_AS_NODE: '1' } : {}) },
            stdio: ['ignore', 'ignore', 'ignore', 'ipc']
          });
          let finished = false;
          const guard = watchChildResources(child, limits, () =>
            finish(new AiGatewayError('AI_PROCESS_LIMIT', '模型执行进程超出资源限额。'))
          );
          const finish = (error, result) => {
            if (finished) return;
            finished = true;
            clearTimeout(timer);
            guard.close();
            signal?.removeEventListener('abort', abort);
            child.kill('SIGKILL');
            if (error) reject(error);
            else resolve(result);
          };
          const abort = () => finish(new AiGatewayError('AI_CANCELLED', '模型请求已取消。'));
          const timer = setTimeout(
            () => finish(new AiGatewayError('AI_PROCESS_TIMEOUT', '模型执行进程超时。', { retryable: true })),
            limits.wallMs
          );
          signal?.addEventListener('abort', abort, { once: true });
          child.on('error', () => finish(new AiGatewayError('AI_PROCESS_FAILED', '模型执行进程启动失败。')));
          child.on('exit', () =>
            finish(new AiGatewayError('AI_PROCESS_FAILED', '模型执行进程异常退出。', { retryable: true }))
          );
          child.on('message', rawMessage => {
            const message = /** @type {import('./boundary-types.ts').ProviderMessage} */ (rawMessage);
            if (message?.type === 'resource') {
              guard.report(message);
              return;
            }
            if (message?.id !== 1) return;
            if (Buffer.byteLength(JSON.stringify(message)) > limits.responseBytes) {
              finish(new AiGatewayError('AI_RESPONSE_TOO_LARGE', '模型进程响应超过上限。'));
              return;
            }
            if (message.type === 'result') finish(null, message.result);
            else if (message.type === 'error')
              finish(
                new AiGatewayError(
                  message.error?.code ?? 'AI_PROCESS_FAILED',
                  message.error?.message ?? '模型执行失败。',
                  { retryable: message.error?.retryable, httpStatus: message.error?.httpStatus }
                )
              );
          });
          child.send({ type: 'complete', id: 1, request: payload }, error => {
            if (error) finish(new AiGatewayError('AI_PROCESS_FAILED', '模型请求无法发送至执行进程。'));
          });
        });
      } finally {
        leave();
      }
    },
    // eslint-disable-next-line require-yield -- 保留异步生成器协议，在消费时明确拒绝尚不支持的流式调用。
    async *stream() {
      throw new AiGatewayError('AI_STREAM_UNAVAILABLE', '隔离执行器尚未启用流式响应。');
    }
  };
}
