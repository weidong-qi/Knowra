import { AsyncLocalStorage } from 'node:async_hooks';
import {
  createCoreOperationReceipt,
  coreOperationKey,
  reuseCoreOperationReceipt,
  validateCoreOperationInput,
  validateCoreOperationLookup,
  validateCoreOperationReceipt
} from './core-operation-contract.ts';
import type {
  AsyncCoreOperationStoreDependencies,
  CoreOperationReceipt,
  CoreOperationResult,
  SyncCoreOperationStoreDependencies
} from './core-operation-types.ts';

// 内部提交原语，不授予写权限。宿主的授权、epoch、草稿/CAS 与领域写入必须在 operation 中执行。
export function createSyncCoreOperationStore({ transaction, get, insert }: SyncCoreOperationStoreDependencies) {
  const running = new Set<string>();
  return {
    get(input: unknown) {
      return copy(get(validateCoreOperationLookup(input)));
    },
    commit(input: unknown, operation: () => CoreOperationResult | Promise<CoreOperationResult>) {
      const request = validateCoreOperationInput(input),
        key = coreOperationKey(request);
      if (typeof operation !== 'function') throw new TypeError('核心操作需要同步领域提交函数。');
      if (running.size) throw new TypeError('核心操作不能嵌套或递归执行；批次必须共用一次提交。');
      return transaction(() => {
        const existing = reuseCoreOperationReceipt(get(request), request);
        if (existing) return existing;
        running.add(key);
        try {
          const result = operation();
          if ((result as Partial<PromiseLike<CoreOperationResult>>)?.then)
            throw new TypeError('本地核心提交不能包含异步操作。');
          const receipt = createCoreOperationReceipt(request, result);
          insert(receipt);
          return structuredClone(receipt);
        } finally {
          running.delete(key);
        }
      });
    }
  };
}

export function createAsyncCoreOperationStore<Transaction extends object>({
  transaction,
  get,
  insert
}: AsyncCoreOperationStoreDependencies<Transaction>) {
  const running = new AsyncLocalStorage<Set<string>>();
  return {
    async get(input: unknown) {
      return copy(await get(validateCoreOperationLookup(input)));
    },
    commit(input: unknown, operation: (tx: Transaction) => CoreOperationResult | Promise<CoreOperationResult>) {
      const request = validateCoreOperationInput(input);
      if (typeof operation !== 'function') throw new TypeError('核心操作需要领域提交函数。');
      const key = coreOperationKey(request);
      if (running.getStore()?.size) throw new TypeError('核心操作不能嵌套或递归执行；批次必须共用一次提交。');
      return transaction(async tx => {
        const existing = reuseCoreOperationReceipt(await get(request, tx), request);
        if (existing) return existing;
        return running.run(new Set([...(running.getStore() ?? []), key]), async () => {
          const receipt = createCoreOperationReceipt(request, await operation(tx));
          await insert(receipt, tx);
          return structuredClone(receipt);
        });
      });
    }
  };
}

function copy(value: CoreOperationReceipt | null | undefined) {
  return value == null ? null : validateCoreOperationReceipt(value);
}
