import { createDeepSeekAdapter } from './infrastructure/providers/deepseek-adapter.ts';

// 子进程只持有本次供应商请求；没有业务 repository、预算或笔记服务入口。
const adapter = createDeepSeekAdapter();
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
  const message = /** @type {import('./boundary-types.ts').ProviderMessage} */ (rawMessage);
  if (message?.type !== 'complete' || !Number.isSafeInteger(message.id)) return;
  try {
    const result = await adapter.complete(message.request);
    process.send?.({ type: 'result', id: message.id, result });
  } catch (error) {
    process.send?.({
      type: 'error',
      id: message.id,
      error: {
        code:
          typeof error?.code === 'string' && /^AI_[A-Z0-9_]+$/.test(error.code)
            ? error.code
            : 'AI_PROVIDER_UNAVAILABLE',
        message: typeof error?.message === 'string' ? error.message : '模型执行失败。',
        retryable: error?.retryable === true,
        httpStatus: Number.isInteger(error?.httpStatus) ? error.httpStatus : null
      }
    });
  }
});
