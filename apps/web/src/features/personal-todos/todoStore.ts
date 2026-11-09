import { useSyncExternalStore } from 'react';
import {
  ApiRequestError,
  createApiClient,
  mergeTodoChanges,
  type Todo,
  type TodoCommand
} from '@study-accelerator/web-core';

export interface TodoUndo {
  id: number;
  message: string;
  command: TodoCommand | null;
}

export interface TodoState {
  status: 'idle' | 'loading' | 'ready' | 'error';
  todos: Todo[];
  error: string | null;
  /** 当前存储不支持待办（例如尚未迁移的服务端）。 */
  unavailable: boolean;
  /** 最近一次可撤销操作；界面显示提示条，过期后清空。 */
  undo: TodoUndo | null;
  /** 最近一次命令失败的提示。 */
  notice: string | null;
}

type Listener = () => void;

/** 待办的前端数据源：命令都交给服务端按共享规则执行，成功后合并返回的变更记录。 */
export function createTodoStore(requestJson = createApiClient().requestJson) {
  let state: TodoState = { status: 'idle', todos: [], error: null, unavailable: false, undo: null, notice: null };
  const listeners = new Set<Listener>();
  let writeVersion = 0;
  let loading: Promise<void> | null = null;
  let undoSeq = 0;
  let undoTimer: ReturnType<typeof setTimeout> | null = null;
  const set = (patch: Partial<TodoState>) => {
    state = { ...state, ...patch };
    for (const listener of listeners) listener();
  };
  function load(): Promise<void> {
    if (loading) return loading;
    set({ status: state.status === 'ready' ? 'ready' : 'loading', error: null });
    loading = (async () => {
      try {
        // 命令成功后，进行中的 GET 可能仍是旧快照；重新读取，不覆盖已确认的修改。
        for (;;) {
          const version = writeVersion;
          const { data } = await requestJson<{ data: { todos: Todo[] } }>('/api/todos');
          if (version !== writeVersion) continue;
          set({ status: 'ready', todos: data.todos, unavailable: false });
          return;
        }
      } catch (error) {
        const code = error instanceof ApiRequestError ? error.code : null;
        set({
          status: 'error',
          unavailable: code === 'PERSONAL_TODOS_UNAVAILABLE',
          error: error instanceof Error ? error.message : '待办加载失败'
        });
      }
    })().finally(() => {
      loading = null;
    });
    return loading;
  }
  function offerUndo(message: string, command: TodoCommand | null) {
    if (undoTimer) clearTimeout(undoTimer);
    const undo = { id: ++undoSeq, message, command };
    set({ undo });
    // 删除撤销在 10 秒内有效（技术方案已确认）。
    undoTimer = setTimeout(() => {
      if (state.undo?.id === undo.id) set({ undo: null });
    }, 10_000);
  }
  async function execute(
    command: TodoCommand,
    options: { undo?: { message: string; command(changed: Todo[]): TodoCommand | null } } = {}
  ) {
    try {
      const { data } = await requestJson<{ data: { changed: Todo[] } }>('/api/todos/commands', {
        method: 'POST',
        body: JSON.stringify({ command })
      });
      writeVersion += 1;
      set({ todos: mergeTodoChanges(state.todos, data.changed), notice: null });
      if (options.undo) offerUndo(options.undo.message, options.undo.command(data.changed));
      return data.changed;
    } catch (error) {
      const code = error instanceof ApiRequestError ? error.code : null;
      set({ notice: error instanceof Error ? error.message : '操作未完成' });
      // 别处已修改：重新读取，界面回到真实状态。
      if (code === 'TODO_REVISION_CONFLICT' || code === 'TODO_NOT_FOUND') void load();
      throw error;
    }
  }
  return {
    getState: () => state,
    subscribe(listener: Listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    load,
    execute,
    async runUndo() {
      const undo = state.undo;
      if (!undo) return;
      set({ undo: null });
      if (undo.command) await execute(undo.command);
    },
    dismissUndo: () => set({ undo: null }),
    clearNotice: () => set({ notice: null })
  };
}

export type TodoStore = ReturnType<typeof createTodoStore>;

let shared: TodoStore | null = null;
export function sharedTodoStore() {
  shared ??= createTodoStore();
  return shared;
}
/** 仅测试使用：替换共享实例。 */
export function setSharedTodoStore(store: TodoStore | null) {
  shared = store;
}

export function useTodoState<Selected>(store: TodoStore, select: (state: TodoState) => Selected): Selected {
  return useSyncExternalStore(store.subscribe, () => select(store.getState()));
}
