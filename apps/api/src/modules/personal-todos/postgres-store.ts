import { mergeTodoChanges } from '../../../../../packages/web-core/src/personal-todos/index.ts';
import { mapPersonalTodo } from '../knowledge/infrastructure/postgres/mappers.ts';
import { dbPersonalTodo } from '../../infrastructure/migration/db-mappers.ts';
import { createAppError } from '../../errors/app-error.ts';
import { todoCollectionErrors } from '../../../../../packages/web-core/src/personal-todos/validation.ts';
import type * as Models from '@prisma/client';
import type { Todo } from '../../../../../packages/web-core/src/personal-todos/types.ts';
import type { PersonalTodoStore } from './service.ts';

interface TodoDelegate {
  findMany(options: { orderBy: { id: 'asc' } }): Promise<Models.PersonalTodo[]>;
  upsert(options: {
    where: { id: string };
    create: ReturnType<typeof dbPersonalTodo>;
    update: ReturnType<typeof dbPersonalTodo>;
  }): Promise<unknown>;
}
interface TodoTransaction {
  personalTodo: TodoDelegate;
}
interface TodoClient extends TodoTransaction {
  $transaction<Result>(operation: (connection: TodoTransaction) => Promise<Result>): Promise<Result>;
}

/**
 * PostgreSQL 待办存储。必须使用同步运行时包装后的客户端：
 * 事务持有同步咨询锁并把本次写入追加到同步日志，与其他核心集合一次提交。
 */
export function createPostgresTodoStore(client: TodoClient): PersonalTodoStore {
  const read = async (connection: TodoTransaction) => {
    const todos = (await connection.personalTodo.findMany({ orderBy: { id: 'asc' } })).map(
      row => mapPersonalTodo(row) as Todo
    );
    const errors = todoCollectionErrors(todos);
    if (errors.length) throw createAppError('PERSONAL_TODOS_CORRUPTED', `待办数据无效：${errors[0]}`, 500);
    return todos;
  };
  return {
    list: () => read(client),
    update: compute =>
      client.$transaction(async connection => {
        const current = await read(connection);
        const changed = compute(structuredClone(current));
        if (!changed.length) return [];
        const errors = todoCollectionErrors(mergeTodoChanges(current, changed));
        if (errors.length) throw createAppError('PERSONAL_TODOS_CORRUPTED', `待办写入无效：${errors[0]}`, 500);
        for (const todo of changed) {
          const data = dbPersonalTodo(todo);
          await connection.personalTodo.upsert({ where: { id: todo.id }, create: data, update: data });
        }
        return changed;
      })
  };
}
