import { randomUUID } from 'node:crypto';
import { TASK_WORKSPACE_COLLECTIONS } from '../modules/task-workspaces/repository-port.js';
import { validateTaskWorkspaceSnapshot } from '../modules/task-workspaces/storage-validation.js';
import { fail } from '../modules/task-workspaces/contract.js';
export function createEmptyTaskWorkspaceSnapshot(datasetId = randomUUID(), datasetEpoch = randomUUID()) {
  return {
    version: 1,
    datasetId,
    datasetEpoch,
    ...Object.fromEntries(TASK_WORKSPACE_COLLECTIONS.map(k => [k, []]))
  };
}
/** Host fileDataStore supplies its existing locked atomic transaction and extension persistence. */
export function createJsonTaskWorkspaceStore({ readState, writeState, transaction }) {
  const port = (state, writable, lifetime) => {
    const assertActive = () => {
      if (!lifetime.active) fail('FORBIDDEN');
    };
    return {
      identity() {
        assertActive();
        return { datasetId: state.datasetId, datasetEpoch: state.datasetEpoch };
      },
      get(kind, id) {
        assertActive();
        collection(kind);
        return structuredClone(state[kind].find(r => r.id === id) ?? null);
      },
      list(kind) {
        assertActive();
        collection(kind);
        return structuredClone(state[kind]);
      },
      insert(kind, row) {
        assertActive();
        collection(kind);
        if (!writable) fail('FORBIDDEN');
        if (state[kind].some(r => r.id === row.id)) fail('CONFLICT');
        state[kind].push(structuredClone(row));
      },
      replace(kind, row, expectedRevision) {
        assertActive();
        collection(kind);
        if (!writable) fail('FORBIDDEN');
        const at = state[kind].findIndex(r => r.id === row.id);
        if (at < 0 || (expectedRevision !== undefined && state[kind][at].revision !== expectedRevision))
          fail('CONFLICT');
        state[kind][at] = structuredClone(row);
      }
    };
  };
  const collection = kind => {
    if (!TASK_WORKSPACE_COLLECTIONS.includes(kind)) fail();
  };
  return {
    available: true,
    readSnapshot(callback) {
      const snapshot = structuredClone(readState());
      validateTaskWorkspaceSnapshot(snapshot);
      const lifetime = { active: true };
      try {
        const result = callback(port(snapshot, false, lifetime));
        if (result?.then) throw new TypeError('任务工作区快照必须同步。');
        readState(); // 宿主复核跨进程磁盘身份，拒绝读取期间发生的恢复。
        return structuredClone(result);
      } finally {
        lifetime.active = false;
      }
    },
    /**
     * @param callback
     * @param {{beforeCommit?: () => (boolean & {then?: never}) | undefined | PromiseLike<boolean | void>}} options */
    runTransaction(callback, { beforeCommit } = {}) {
      const lifetime = { active: true };
      const finalGuard = () => {
        const result = beforeCommit?.();
        if (result === false || result?.then) fail('FORBIDDEN');
      };
      try {
        return transaction(
          () => {
            const next = structuredClone(readState());
            validateTaskWorkspaceSnapshot(next);
            const result = callback(port(next, true, lifetime));
            if (result?.then) throw new TypeError('任务工作区事务必须同步。');
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
        if ((error?.cause?.code ?? error?.code) === 'STORAGE_EXTERNAL_CHANGE') fail('CONFLICT');
        if ((error?.cause?.code ?? error?.code) === 'STORAGE_MAINTENANCE_BUSY') fail('UNAVAILABLE');
        throw error;
      } finally {
        lifetime.active = false;
      }
    }
  };
}
