import { createAiRecoveryScope } from './recovery-scope.ts';

export interface AiRuntimeLifecyclePorts {
  attachments?: { recover?(): unknown; close?(): unknown } | null;
  conversationStore?: { recoverInterrupted?(): unknown } | null;
  agent?: { recover?(): unknown; close?(): unknown } | null;
  worker?: { recover?(): unknown; close?(): unknown } | null;
}

export interface AiRuntimeLifecycleOwner {
  recover(names?: Iterable<string>): Promise<void>;
  close(): Promise<void>;
}

const owners = new WeakMap<AiRuntimeLifecyclePorts, AiRuntimeLifecycleOwner>();

/** 启动恢复属于持库宿主；HTTP 关闭仅停网络，宿主须在关库前等待此 owner。 */
export function aiRuntimeLifecycle(runtime?: AiRuntimeLifecyclePorts | null): AiRuntimeLifecycleOwner {
  if (runtime && owners.has(runtime)) return owners.get(runtime)!;
  const scope = createAiRecoveryScope();
  const stages: Record<string, unknown> = {
    attachments: () => runtime?.attachments?.recover?.(),
    conversation: () => runtime?.conversationStore?.recoverInterrupted?.(),
    agent: () => runtime?.agent?.recover?.(),
    worker: () => runtime?.worker?.recover?.()
  };
  const owner = {
    recover(names: Iterable<string> = ['attachments', 'conversation', 'agent', 'worker']) {
      return scope.run(async () => {
        for (const name of names) {
          if (scope.closed) return;
          // 沿用动态属性调用：未知键或不可调用的继承属性仍由原生调用抛错，且保留 this。
          await (stages[name] as () => unknown)();
        }
      });
    },
    close: () =>
      scope.close(async () => {
        const results = await Promise.allSettled([
          Promise.resolve().then(() => runtime?.attachments?.close?.()),
          Promise.resolve().then(() => runtime?.agent?.close?.()),
          Promise.resolve().then(() => runtime?.worker?.close?.())
        ]);
        const failures = results.filter(result => result.status === 'rejected').map(result => result.reason);
        if (failures.length) throw new AggregateError(failures, 'AI 执行器关闭失败。');
      })
  };
  if (runtime) owners.set(runtime, owner);
  return owner;
}
