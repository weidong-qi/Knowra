import { isDateOnly, isZonedIso } from './dates.js';
import { orderBetween } from './order.js';
import { buildReminder, cancelReminder, missPastReminder, reminderAfterDueChange } from './reminders.js';
import { indexTodos } from './tree.js';
import type { TodoIndex } from './tree.js';
import { TODO_MAX_DEPTH, TODO_PAUSE_REASON_MAX, TODO_TEXT_MAX, TODO_TITLE_MAX, TodoRuleError } from './types.js';
import type { Todo, TodoCommand, TodoEditableFields } from './types.js';

export interface TodoCommandContext {
  /** 本次命令的统一时间（UTC ISO）。 */
  now: string;
}

export interface TodoCommandResult {
  /** 本次命令改动后的完整记录（已递增 revision、更新 updatedAt）；为空表示幂等无变化。 */
  changed: Todo[];
}

const fail = (code: TodoRuleError['code'], message: string): never => {
  throw new TodoRuleError(code, message);
};

function cleanTitle(value: unknown): string {
  if (typeof value !== 'string') return fail('TODO_INVALID_INPUT', '名称必须是文本');
  const title = value.trim();
  if (!title) return fail('TODO_INVALID_INPUT', '名称不能为空');
  if (title.length > TODO_TITLE_MAX) return fail('TODO_INVALID_INPUT', `名称不能超过 ${TODO_TITLE_MAX} 个字符`);
  return title;
}

function cleanText(value: unknown, label: string): string {
  if (typeof value !== 'string') return fail('TODO_INVALID_INPUT', `${label}必须是文本`);
  if (value.length > TODO_TEXT_MAX) return fail('TODO_INVALID_INPUT', `${label}不能超过 ${TODO_TEXT_MAX} 个字符`);
  return value;
}

function cleanDate(value: unknown, label: string): string | null {
  if (value === null) return null;
  if (!isDateOnly(value)) return fail('TODO_INVALID_INPUT', `${label}格式无效`);
  return value;
}

function cleanId(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(value))
    return fail('TODO_INVALID_INPUT', 'ID 格式无效');
  return value;
}

/** 在内存副本上执行一条命令；所有规则错误以 TodoRuleError 抛出，调用方整体放弃本次写入。 */
export function applyTodoCommand(
  todos: readonly Todo[],
  command: TodoCommand,
  context: TodoCommandContext
): TodoCommandResult {
  if (!isZonedIso(context.now)) throw new TodoRuleError('TODO_INVALID_INPUT', '命令时间无效');
  const now = context.now;
  const all = new Map(todos.map(todo => [todo.id, JSON.parse(JSON.stringify(todo)) as Todo]));
  const touched = new Set<string>();
  let index: TodoIndex = indexTodos([...all.values()]);
  const refresh = () => {
    index = indexTodos([...all.values()]);
  };
  const write = (todo: Todo) => {
    all.set(todo.id, todo);
    touched.add(todo.id);
  };
  const live = (id: string): Todo => {
    const todo = all.get(id);
    if (!todo || todo.deletedAt) return fail('TODO_NOT_FOUND', '待办不存在或已删除');
    return todo;
  };
  const checkRevision = (todo: Todo, expected: number) => {
    if (todo.revision !== expected) fail('TODO_REVISION_CONFLICT', '待办已在别处修改，请刷新后重试');
  };
  const notArchived = (todo: Todo) => {
    if (todo.archivedAt) fail('TODO_ARCHIVED', '已归档的待办只能查看，不能修改');
  };
  const parentPaused = (todo: Todo) => {
    const parent = todo.parentId === null ? undefined : all.get(todo.parentId);
    return parent?.status === 'paused';
  };

  /** 自上而下修正暂停继承：父级暂停时进行中的下级随之暂停；父级不再暂停时解除随父暂停。 */
  const reconcile = (todo: Todo) => {
    const paused = parentPaused(todo);
    if (todo.status === 'active' && paused) write({ ...todo, status: 'paused', pausedBy: 'parent', pauseReason: null });
    else if (todo.status === 'paused' && todo.pausedBy === 'parent' && !paused)
      write({ ...todo, status: 'active', pausedBy: null, reminder: missPastReminder(todo.reminder, now) });
    for (const child of index.children(todo.id)) if (child.status !== 'done') reconcile(all.get(child.id)!);
  };

  /** 重新打开节点：已完成父级下不能留有未完成项，因此沿途已完成的祖先一起重新打开（自顶向下）。 */
  const reopenWithAncestors = (todo: Todo) => {
    for (const node of [...index.ancestors(todo.id).reverse(), todo]) {
      const current = all.get(node.id)!;
      if (current.status !== 'done') continue;
      notArchived(current);
      write(
        parentPaused(current)
          ? { ...current, status: 'paused', pausedBy: 'parent', pauseReason: null }
          : { ...current, status: 'active', pausedBy: null }
      );
    }
  };

  const reopenDoneParent = (parentId: string | null) => {
    if (parentId === null) return;
    const parent = all.get(parentId)!;
    if (parent.status === 'done') reopenWithAncestors(parent);
  };

  const placement = (parentId: string | null, afterId: string | null | undefined, selfId: string) => {
    const siblings = index.children(parentId).filter(todo => todo.id !== selfId);
    if (afterId === undefined) return orderBetween(siblings.at(-1)?.order ?? null, null);
    if (afterId === null) return orderBetween(null, siblings[0]?.order ?? null);
    const position = siblings.findIndex(todo => todo.id === afterId);
    if (position < 0) return fail('TODO_INVALID_MOVE', '放置位置不在目标层级中');
    return orderBetween(siblings[position]!.order, siblings[position + 1]?.order ?? null);
  };

  switch (command.type) {
    case 'create': {
      const id = cleanId(command.id);
      if (all.has(id)) fail('TODO_ALREADY_EXISTS', '待办 ID 已存在');
      const title = cleanTitle(command.title);
      let kind: Todo['kind'] = 'item';
      if (command.parentId === null) {
        kind = command.kind ?? 'sideline';
        if (kind !== 'mainline' && kind !== 'sideline') fail('TODO_INVALID_INPUT', '顶层待办只能是主线或支线');
      } else {
        const parent = live(command.parentId);
        notArchived(parent);
        if (index.depth(parent.id) + 1 > TODO_MAX_DEPTH) fail('TODO_DEPTH_EXCEEDED', `最多嵌套 ${TODO_MAX_DEPTH} 层`);
      }
      const goal = cleanText(command.goal ?? '', '目标说明');
      if (goal && kind !== 'mainline') fail('TODO_INVALID_INPUT', '只有主线可以填写目标说明');
      const todo: Todo = {
        id,
        parentId: command.parentId,
        kind,
        title,
        note: cleanText(command.note ?? '', '说明'),
        goal,
        order: placement(command.parentId, command.afterId, id),
        starred: command.starred === true,
        status: 'active',
        pausedBy: null,
        pauseReason: null,
        plannedDate: cleanDate(command.plannedDate ?? null, '计划日期'),
        dueDate: cleanDate(command.dueDate ?? null, '截止日期'),
        completedAt: null,
        archivedAt: null,
        deletedAt: null,
        reminder: null,
        // 新建记录写入后统一递增为 1。
        revision: 0,
        createdAt: now,
        updatedAt: now
      };
      write(todo);
      refresh();
      reopenDoneParent(todo.parentId);
      reconcile(all.get(id)!);
      break;
    }
    case 'update': {
      const todo = live(command.id);
      checkRevision(todo, command.expectedRevision);
      notArchived(todo);
      const patch = command.patch as Partial<Record<keyof TodoEditableFields, unknown>>;
      const allowed = new Set<string>(['title', 'note', 'goal', 'starred', 'plannedDate', 'dueDate']);
      if (!patch || typeof patch !== 'object' || Object.keys(patch).some(key => !allowed.has(key)))
        fail('TODO_INVALID_INPUT', '修改内容无效');
      const next = { ...todo };
      if ('title' in patch) next.title = cleanTitle(patch.title);
      if ('note' in patch) next.note = cleanText(patch.note, '说明');
      if ('goal' in patch) {
        next.goal = cleanText(patch.goal, '目标说明');
        if (next.goal && todo.kind !== 'mainline') fail('TODO_INVALID_INPUT', '只有主线可以填写目标说明');
      }
      if ('starred' in patch) {
        if (typeof patch.starred !== 'boolean') fail('TODO_INVALID_INPUT', '星标必须是布尔值');
        next.starred = patch.starred as boolean;
      }
      if ('plannedDate' in patch) next.plannedDate = cleanDate(patch.plannedDate, '计划日期');
      if ('dueDate' in patch) {
        next.dueDate = cleanDate(patch.dueDate, '截止日期');
        if (next.status !== 'done') next.reminder = reminderAfterDueChange(next.reminder, next.dueDate);
      }
      write(next);
      break;
    }
    case 'move': {
      const todo = live(command.id);
      checkRevision(todo, command.expectedRevision);
      notArchived(todo);
      if (command.parentId !== null) {
        if (todo.kind === 'mainline') fail('TODO_INVALID_MOVE', '主线不能移入其他待办');
        const parent = live(command.parentId);
        notArchived(parent);
        if (parent.id === todo.id || index.ancestors(parent.id).some(node => node.id === todo.id))
          fail('TODO_INVALID_MOVE', '不能移入自身或自己的下级');
        if (index.depth(parent.id) + index.height(todo.id) > TODO_MAX_DEPTH)
          fail('TODO_DEPTH_EXCEEDED', `移动后会超过 ${TODO_MAX_DEPTH} 层`);
      }
      const kind: Todo['kind'] = command.parentId !== null ? 'item' : todo.kind === 'item' ? 'sideline' : todo.kind;
      const moved: Todo = {
        ...todo,
        parentId: command.parentId,
        kind,
        goal: kind === 'mainline' ? todo.goal : '',
        order: placement(command.parentId, command.afterId, todo.id)
      };
      write(moved);
      refresh();
      if (moved.status !== 'done') reopenDoneParent(moved.parentId);
      reconcile(all.get(moved.id)!);
      break;
    }
    case 'promote': {
      const todo = live(command.id);
      checkRevision(todo, command.expectedRevision);
      notArchived(todo);
      if (todo.kind !== 'sideline' || todo.parentId !== null) fail('TODO_INVALID_STATE', '只有支线可以升级为主线');
      write({ ...todo, kind: 'mainline' });
      break;
    }
    case 'pause': {
      const todo = live(command.id);
      checkRevision(todo, command.expectedRevision);
      notArchived(todo);
      const reason = command.reason == null ? null : String(command.reason).trim() || null;
      if (reason && reason.length > TODO_PAUSE_REASON_MAX)
        fail('TODO_INVALID_INPUT', `暂停原因不能超过 ${TODO_PAUSE_REASON_MAX} 个字符`);
      if (todo.status === 'done' || (todo.status === 'paused' && todo.pausedBy === 'self'))
        fail('TODO_INVALID_STATE', '只有进行中的待办可以暂停');
      write({ ...todo, status: 'paused', pausedBy: 'self', pauseReason: reason });
      reconcile(all.get(todo.id)!);
      break;
    }
    case 'resume': {
      const todo = live(command.id);
      checkRevision(todo, command.expectedRevision);
      notArchived(todo);
      if (todo.status !== 'paused') fail('TODO_INVALID_STATE', '只有已暂停的待办可以恢复');
      if (todo.pausedBy === 'parent') fail('TODO_PAUSED_BY_PARENT', '它随上级一起暂停，请恢复上级');
      if (parentPaused(todo)) {
        // 上级仍暂停：改为随上级暂停，上级恢复时一并恢复。
        write({ ...todo, pausedBy: 'parent', pauseReason: null });
        break;
      }
      write({
        ...todo,
        status: 'active',
        pausedBy: null,
        pauseReason: null,
        reminder: missPastReminder(todo.reminder, now)
      });
      reconcile(all.get(todo.id)!);
      break;
    }
    case 'complete': {
      const todo = live(command.id);
      checkRevision(todo, command.expectedRevision);
      notArchived(todo);
      if (todo.status === 'done') fail('TODO_INVALID_STATE', '待办已完成');
      const open = index.descendants(todo.id).filter(node => node.status !== 'done');
      if (open.length && command.includeChildren !== true)
        fail('TODO_HAS_OPEN_CHILDREN', '还有未完成的下级，请选择全部标为完成或先整理');
      for (const node of [todo, ...open])
        write({
          ...all.get(node.id)!,
          status: 'done',
          pausedBy: null,
          pauseReason: null,
          completedAt: now,
          reminder: cancelReminder(node.reminder)
        });
      break;
    }
    case 'reopen': {
      const todo = live(command.id);
      checkRevision(todo, command.expectedRevision);
      notArchived(todo);
      if (todo.status !== 'done') fail('TODO_INVALID_STATE', '只有已完成的待办可以重新打开');
      reopenWithAncestors(todo);
      break;
    }
    case 'delete': {
      const todo = live(command.id);
      checkRevision(todo, command.expectedRevision);
      notArchived(todo);
      const subtree = [todo, ...index.descendants(todo.id)];
      if (subtree.some(node => node.archivedAt)) fail('TODO_ARCHIVED', '其中包含已归档内容，不能删除');
      for (const node of subtree) write({ ...all.get(node.id)!, deletedAt: now });
      break;
    }
    case 'restore': {
      const todo = all.get(command.id);
      if (!todo) return fail('TODO_NOT_FOUND', '待办不存在');
      if (!todo.deletedAt) fail('TODO_INVALID_STATE', '待办未被删除');
      if (todo.parentId !== null) {
        const parent = all.get(todo.parentId);
        if (!parent || parent.deletedAt) fail('TODO_INVALID_STATE', '上级已删除，请先恢复上级');
        notArchived(parent!);
      }
      const marker = todo.deletedAt;
      const subtree = [todo, ...indexTodos([...all.values()], { includeDeleted: true }).descendants(todo.id)].filter(
        node => node.deletedAt === marker
      );
      for (const node of subtree) write({ ...all.get(node.id)!, deletedAt: null });
      refresh();
      const restored = all.get(todo.id)!;
      if (restored.status !== 'done' || index.descendants(restored.id).some(node => node.status !== 'done'))
        reopenDoneParent(restored.parentId);
      reconcile(all.get(todo.id)!);
      break;
    }
    case 'archive': {
      const todo = live(command.id);
      checkRevision(todo, command.expectedRevision);
      notArchived(todo);
      if (todo.parentId !== null) fail('TODO_NOT_ARCHIVABLE', '首版只能整条归档主线或支线');
      const subtree = [todo, ...index.descendants(todo.id)];
      if (subtree.some(node => node.status !== 'done')) fail('TODO_NOT_ARCHIVABLE', '还有未完成的内容，请先处理再归档');
      for (const node of subtree) write({ ...all.get(node.id)!, archivedAt: now });
      break;
    }
    case 'setReminder': {
      const todo = live(command.id);
      checkRevision(todo, command.expectedRevision);
      notArchived(todo);
      if (command.reminder !== null && todo.status === 'done') fail('TODO_INVALID_STATE', '已完成的待办不能设置提醒');
      write({ ...todo, reminder: command.reminder === null ? null : buildReminder(command.reminder, todo.dueDate) });
      break;
    }
    case 'ackReminder': {
      const todo = all.get(command.id);
      if (!todo) return fail('TODO_NOT_FOUND', '待办不存在');
      if (command.outcome !== 'fired' && command.outcome !== 'missed') fail('TODO_INVALID_INPUT', '提醒结果无效');
      // 幂等：提醒已被其他设备处理、已改期或已取消时不做修改。
      if (todo.reminder?.state === 'pending' && todo.reminder.dueAt === command.dueAt)
        write({ ...todo, reminder: { ...todo.reminder, state: command.outcome } });
      break;
    }
    default:
      fail('TODO_INVALID_INPUT', '未知的待办命令');
  }

  const changed: Todo[] = [];
  for (const id of touched) {
    const before = todos.find(todo => todo.id === id);
    const after = all.get(id)!;
    if (before && JSON.stringify(before) === JSON.stringify(after)) continue;
    changed.push({ ...after, revision: (before?.revision ?? 0) + 1, updatedAt: now });
  }
  return { changed };
}

/** 把命令结果合并回完整列表（客户端乐观更新与服务端写入共用）。 */
export function mergeTodoChanges(todos: readonly Todo[], changed: readonly Todo[]): Todo[] {
  const byId = new Map(todos.map(todo => [todo.id, todo]));
  for (const todo of changed) byId.set(todo.id, todo);
  return [...byId.values()];
}
