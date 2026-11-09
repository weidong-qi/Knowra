import { syncKey } from '../../api/src/modules/sync/journal.ts';
import { applyTodoCommand, mergeTodoChanges } from '../../../packages/web-core/src/personal-todos/commands.ts';
import { cancelReminder, missPastReminder } from '../../../packages/web-core/src/personal-todos/reminders.ts';
import { indexTodos } from '../../../packages/web-core/src/personal-todos/tree.ts';
import { sameEntity } from '../../api/src/modules/sync/entity-contract.ts';

/** 前后像的关联分量：移动会连接旧树与新树，未修改的中间节点也参与连通。 */
export function todoComponents(...snapshots) {
  const parents = new Map();
  const root = id => {
    if (!parents.has(id)) parents.set(id, id);
    let current = id;
    while (parents.get(current) !== current) current = parents.get(current);
    while (parents.get(id) !== id) {
      const next = parents.get(id);
      parents.set(id, current);
      id = next;
    }
    return current;
  };
  for (const todo of snapshots.flat()) {
    root(todo.id);
    if (todo.parentId != null) parents.set(root(todo.id), root(todo.parentId));
  }
  return new Map([...parents.keys()].map(id => [id, root(id)]));
}

const fail = (code, message) => {
  throw Object.assign(new Error(message), { code });
};

/** 采用本地记录后恢复树的不变量；沿用重新打开祖先、暂停继承和提醒错过的领域规则。 */
export function reconcileLocalTodoChoice(todos, chosen, remote, now = new Date().toISOString()) {
  let result = structuredClone(todos);
  for (const entry of chosen) {
    if (entry.collection !== 'personalTodos' || !entry.value) continue;
    const authoritative = remote.get(syncKey('personalTodos', entry.id))?.value;
    if (authoritative?.archivedAt && !sameEntity('personalTodos', authoritative, entry.value))
      fail('TODO_ARCHIVED', '云端待办已归档，请采用云端；采用时本地修改会保存在恢复记录中。');
    const index = indexTodos(result);
    const node = index.byId.get(entry.id);
    if (!node) continue;
    const ancestors = index.ancestors(node.id);
    if ([node, ...ancestors].some(item => item.parentId !== null && !index.byId.has(item.parentId)))
      fail('TODO_SYNC_RESTORE_REQUIRED', '云端上级已删除，请先采用云端并显式恢复上级。');
    if (node.status !== 'done') {
      const done = ancestors.find(parent => parent.status === 'done');
      if (done)
        result = mergeTodoChanges(
          result,
          applyTodoCommand(
            result,
            {
              type: 'reopen',
              id: done.id,
              expectedRevision: done.revision
            },
            { now }
          ).changed
        );
    }
  }
  // 本地父任务的完成、删除、归档选择也作用于同步后新出现的步骤；保留这些记录及其内容。
  // 使用包含墓碑的索引，才能从已删除父任务继续向下传播删除标记。
  const fullIndex = indexTodos(result, { includeDeleted: true });
  const all = new Map(result.map(todo => [todo.id, todo]));
  const write = next => {
    const before = all.get(next.id);
    if (sameEntity('personalTodos', before, next)) return;
    const authoritative = remote.get(syncKey('personalTodos', next.id))?.value;
    if (authoritative?.archivedAt && !sameEntity('personalTodos', authoritative, next))
      fail('TODO_ARCHIVED', '云端待办已归档，请采用云端；采用时本地修改会保存在恢复记录中。');
    all.set(next.id, {
      ...next,
      revision: Math.max(before.revision, authoritative?.revision ?? 0) + 1,
      updatedAt: now
    });
  };
  for (const node of [...fullIndex.byId.values()].sort((a, b) => fullIndex.depth(a.id) - fullIndex.depth(b.id))) {
    if (node.deletedAt) continue;
    const parent = all.get(node.parentId);
    if (!parent) continue;
    if (parent.deletedAt) {
      write({ ...node, deletedAt: parent.deletedAt, reminder: cancelReminder(node.reminder) });
      continue;
    }
    let next = node;
    if (parent.status === 'done' && node.status !== 'done')
      next = {
        ...next,
        status: 'done',
        pausedBy: null,
        pauseReason: null,
        completedAt: now,
        reminder: cancelReminder(next.reminder)
      };
    if (parent.archivedAt) next = { ...next, archivedAt: parent.archivedAt, reminder: cancelReminder(next.reminder) };
    write(next);
  }
  const index = indexTodos([...all.values()]);
  for (const node of [...index.byId.values()].sort((a, b) => index.depth(a.id) - index.depth(b.id))) {
    const parent = all.get(node.parentId);
    const inherited = node.status === 'active' && parent?.status === 'paused';
    const released = node.status === 'paused' && node.pausedBy === 'parent' && parent?.status !== 'paused';
    if (!inherited && !released) continue;
    if (node.archivedAt) fail('TODO_ARCHIVED', '已归档的待办不能再修改。');
    write({
      ...node,
      status: inherited ? 'paused' : 'active',
      pausedBy: inherited ? 'parent' : null,
      pauseReason: null,
      reminder: released ? missPastReminder(node.reminder, now) : node.reminder
    });
  }
  return [...all.values()];
}
