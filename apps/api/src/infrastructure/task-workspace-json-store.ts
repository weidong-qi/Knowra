import { randomUUID } from 'node:crypto';
import { TASK_WORKSPACE_COLLECTIONS } from '../modules/task-workspaces/repository-port.ts';
import { validateTaskWorkspaceSnapshot } from '../modules/task-workspaces/storage-validation.ts';
import { fail } from '../modules/task-workspaces/contract.ts';
import type { AppError } from '../errors/app-error.ts';
import type {
  Collection,
  GuardResult,
  TaskWorkspaceRecords,
  TaskWorkspaceSnapshot,
  TaskWorkspaceStore,
  TaskWorkspaceTransaction
} from '../modules/task-workspaces/repository-port.ts';

export interface JsonTaskWorkspaceCommitOptions {
  beforeCommit?: () => GuardResult;
}
export interface JsonTaskWorkspaceStoreDependencies {
  readState(): unknown;
  writeState(state: TaskWorkspaceSnapshot): void;
  transaction<T>(operation: () => T, options?: { beforeCommit?: () => void }): T;
}

export function createEmptyTaskWorkspaceSnapshot(
  datasetId: string = randomUUID(),
  datasetEpoch: string = randomUUID()
): TaskWorkspaceSnapshot {
  return {
    version: 1,
    datasetId,
    datasetEpoch,
    ...(Object.fromEntries<TaskWorkspaceRecords[Collection][]>(TASK_WORKSPACE_COLLECTIONS.map(k => [k, []])) as Pick<
      TaskWorkspaceSnapshot,
      Collection
    >)
  };
}
/** Host fileDataStore supplies its existing locked atomic transaction and extension persistence. */
export function createJsonTaskWorkspaceStore({
  readState,
  writeState,
  transaction
}: JsonTaskWorkspaceStoreDependencies): TaskWorkspaceStore {
  const port = (
    state: TaskWorkspaceSnapshot,
    writable: boolean,
    lifetime: { active: boolean }
  ): TaskWorkspaceTransaction => {
    const assertActive = () => {
      if (!lifetime.active) fail('FORBIDDEN');
    };
    return {
      identity() {
        assertActive();
        return { datasetId: state.datasetId, datasetEpoch: state.datasetEpoch };
      },
      get<K extends Collection>(kind: K, id: string) {
        assertActive();
        collection(kind);
        return structuredClone((state[kind] as TaskWorkspaceRecords[K][]).find(r => r.id === id) ?? null);
      },
      list<K extends Collection>(kind: K) {
        assertActive();
        collection(kind);
        return structuredClone(state[kind] as TaskWorkspaceRecords[K][]);
      },
      insert<K extends Collection>(kind: K, row: TaskWorkspaceRecords[K]) {
        assertActive();
        collection(kind);
        if (!writable) fail('FORBIDDEN');
        if (state[kind].some(r => r.id === row.id)) fail('CONFLICT');
        (state[kind] as TaskWorkspaceRecords[K][]).push(structuredClone(row));
      },
      replace<K extends Collection>(kind: K, row: TaskWorkspaceRecords[K], expectedRevision?: number) {
        assertActive();
        collection(kind);
        if (!writable) fail('FORBIDDEN');
        const at = state[kind].findIndex(r => r.id === row.id);
        if (
          at < 0 ||
          (expectedRevision !== undefined && (state[kind][at] as { revision?: number }).revision !== expectedRevision)
        )
          fail('CONFLICT');
        (state[kind] as TaskWorkspaceRecords[K][])[at] = structuredClone(row);
      }
    };
  };
  const collection = (kind: Collection) => {
    if (!TASK_WORKSPACE_COLLECTIONS.includes(kind)) fail();
  };
  return {
    available: true,
    readSnapshot<T>(callback: (tx: TaskWorkspaceTransaction) => T): T {
      const snapshot = validateTaskWorkspaceSnapshot(structuredClone(readState()));
      const lifetime = { active: true };
      try {
        const result = callback(port(snapshot, false, lifetime));
        if ((result as Partial<PromiseLike<T>> | null | undefined)?.then)
          throw new TypeError('任务工作区快照必须同步。');
        readState(); // 宿主复核跨进程磁盘身份，拒绝读取期间发生的恢复。
        return structuredClone(result);
      } finally {
        lifetime.active = false;
      }
    },
    runTransaction<T>(
      callback: (tx: TaskWorkspaceTransaction) => T,
      { beforeCommit }: JsonTaskWorkspaceCommitOptions = {}
    ): T {
      const lifetime = { active: true };
      const finalGuard = () => {
        const result = beforeCommit?.();
        if (result === false || (result as Partial<PromiseLike<boolean | void>> | null | undefined)?.then)
          fail('FORBIDDEN');
      };
      try {
        return transaction(
          () => {
            const next = validateTaskWorkspaceSnapshot(structuredClone(readState()));
            const result = callback(port(next, true, lifetime));
            if ((result as Partial<PromiseLike<T>> | null | undefined)?.then)
              throw new TypeError('任务工作区事务必须同步。');
            const detachedResult = structuredClone(result);
            validateTaskWorkspaceSnapshot(next);
            readState();
            finalGuard();
            writeState(structuredClone(next));
            return detachedResult;
          },
          { beforeCommit: finalGuard }
        );
      } catch (error) {
        const failure = error as AppError;
        if (((failure?.cause as AppError | null | undefined)?.code ?? failure?.code) === 'STORAGE_EXTERNAL_CHANGE')
          fail('CONFLICT');
        if (((failure?.cause as AppError | null | undefined)?.code ?? failure?.code) === 'STORAGE_MAINTENANCE_BUSY')
          fail('UNAVAILABLE');
        throw error;
      } finally {
        lifetime.active = false;
      }
    }
  };
}
