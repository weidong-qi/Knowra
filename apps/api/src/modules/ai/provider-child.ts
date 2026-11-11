import type { ProviderRequest } from './infrastructure/providers/deepseek-adapter.ts';
import { createDeepSeekAdapter } from './infrastructure/providers/deepseek-adapter.ts';

type RawProviderError =
  { code?: unknown; message?: unknown; retryable?: unknown; httpStatus?: unknown } | null | undefined;

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
  // 仅沿用原协议的 type/id 检查；request 仍是未经验证的外部输入。
  const message = rawMessage as { type?: unknown; id?: unknown; request?: unknown } | null | undefined;
  if (message?.type !== 'complete' || !Number.isSafeInteger(message.id)) return;
  try {
    // 父进程发送 ProviderRequest；此处保留 adapter 对畸形请求原有的处理/异常，
    // 不把整条 IPC 消息升级为可信协议，也不新增校验改变错误路径。
    const result = await adapter.complete(message.request as ProviderRequest);
    process.send?.({ type: 'result', id: message.id, result });
  } catch (error) {
    // 只读取既有错误字段；下方 typeof / Number.isInteger 保留原有归一化逻辑。
    process.send?.({
      type: 'error',
      id: message.id,
      error: {
        code:
          typeof (error as RawProviderError)?.code === 'string' &&
          /^AI_[A-Z0-9_]+$/.test((error as NonNullable<RawProviderError>).code as string)
            ? ((error as NonNullable<RawProviderError>).code as string)
            : 'AI_PROVIDER_UNAVAILABLE',
        message:
          typeof (error as RawProviderError)?.message === 'string'
            ? (error as NonNullable<RawProviderError>).message
            : '模型执行失败。',
        retryable: (error as RawProviderError)?.retryable === true,
        httpStatus: Number.isInteger((error as RawProviderError)?.httpStatus)
          ? (error as NonNullable<RawProviderError>).httpStatus
          : null
      }
    });
  }
});
