import { sameEntity } from './entity-contract.ts';
import { syncError } from './journal.ts';
import type { SyncStoredEntity, SyncWorkingEntity } from './domain-types.ts';

/**
 * 单条待办的同步入站规则；字段与整棵树的结构不变量由批次最终状态统一校验。
 * 待办只做软删除（deletedAt），不接受同步硬删除；已归档记录封存，不能再改。
 */
export function assertTodoSyncChange(old: SyncStoredEntity | undefined, value: SyncWorkingEntity | null): void {
  if (!value) throw syncError('TODO_SYNC_DELETE_UNSUPPORTED', '待办只能通过删除标记同步，不能直接移除记录。', 422);
  const previous = old as { archivedAt?: string | null; createdAt?: string } | undefined;
  const next = value as { createdAt?: string };
  if (previous?.archivedAt && !sameEntity('personalTodos', old, value))
    throw syncError('TODO_ARCHIVED', '已归档的待办不能再修改。', 422);
  if (previous && previous.createdAt !== next.createdAt)
    throw syncError('SYNC_ENTITY_INVALID', '待办创建时间不能改变。', 422);
}
