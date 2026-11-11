import { createAppError } from '../../errors/app-error.ts';
import {
  applyTodoCommand,
  mergeTodoChanges,
  TodoRuleError
} from '../../../../../packages/web-core/src/personal-todos/index.ts';
import type { Todo, TodoCommand, TodoRuleCode } from '../../../../../packages/web-core/src/personal-todos/index.ts';

/**
 * 待办存储端口：JSON、SQLite 与 PostgreSQL 各自实现。
 * update 在一次原子事务内读取当前全部待办、交给回调计算变更并写回；回调抛错必须整体回滚。
 */
export interface PersonalTodoStore {
  list(): Todo[] | Promise<Todo[]>;
  update(compute: (todos: Todo[]) => Todo[]): Todo[] | Promise<Todo[]>;
}

const STATUS: Record<TodoRuleCode, number> = {
  TODO_NOT_FOUND: 404,
  TODO_REVISION_CONFLICT: 409,
  TODO_ALREADY_EXISTS: 409,
  TODO_ARCHIVED: 409,
  TODO_INVALID_INPUT: 422,
  TODO_INVALID_MOVE: 422,
  TODO_DEPTH_EXCEEDED: 422,
  TODO_HAS_OPEN_CHILDREN: 409,
  TODO_INVALID_STATE: 409,
  TODO_PAUSED_BY_PARENT: 409,
  TODO_NOT_ARCHIVABLE: 409
};

const COMMAND_TYPES = new Set([
  'create',
  'update',
  'move',
  'promote',
  'pause',
  'resume',
  'complete',
  'reopen',
  'delete',
  'restore',
  'archive',
  'setReminder',
  'ackReminder'
]);

export function createPersonalTodoService({
  store,
  now = () => new Date().toISOString()
}: {
  store: PersonalTodoStore | null;
  now?: () => string;
}) {
  const requireStore = () => {
    if (!store) throw createAppError('PERSONAL_TODOS_UNAVAILABLE', '当前存储暂不支持个人待办', 503);
    return store;
  };
  return {
    available: store !== null,
    async list() {
      const todos = await requireStore().list();
      return todos.filter(todo => !todo.deletedAt);
    },
    async execute(input: unknown) {
      const command = input as TodoCommand | null;
      if (!command || typeof command !== 'object' || !COMMAND_TYPES.has((command as { type?: string }).type ?? ''))
        throw createAppError('TODO_INVALID_INPUT', '待办命令无效', 422);
      const at = now();
      try {
        let changed: Todo[] = [];
        await requireStore().update(todos => {
          changed = applyTodoCommand(todos, command, { now: at }).changed;
          return changed;
        });
        return { changed };
      } catch (error) {
        if (error instanceof TodoRuleError) throw createAppError(error.code, error.message, STATUS[error.code]);
        throw error;
      }
    }
  };
}

export type PersonalTodoService = ReturnType<typeof createPersonalTodoService>;

/** JSON 与 SQLite 共用：两者都通过同步事务修改内存中的 personalTodos 集合并整体落盘。 */
export function createStateBackedTodoStore(dataStore: {
  state: { personalTodos?: Todo[] };
  runTransaction<Result>(operation: () => Result): Result;
  flush(): void;
}): PersonalTodoStore {
  const collection = () => {
    if (!Array.isArray(dataStore.state.personalTodos))
      throw createAppError('PERSONAL_TODOS_UNAVAILABLE', '当前资料库还不支持个人待办', 503);
    return dataStore.state.personalTodos;
  };
  return {
    list: () => structuredClone(collection()),
    update: compute =>
      dataStore.runTransaction(() => {
        const current = collection();
        const changed = compute(structuredClone(current));
        if (!changed.length) return [];
        current.splice(0, current.length, ...mergeTodoChanges(current, changed));
        dataStore.flush();
        return changed;
      })
  };
}
