import { localDateOf } from './dates.ts';
import { byOrder } from './tree.ts';
import type { TodoIndex } from './tree.ts';
import type { Todo } from './types.ts';

export type NextStep = { kind: 'item'; todo: Todo } | { kind: 'confirmParent'; todo: Todo } | { kind: 'none' };

/**
 * 下一步：按用户排序自上而下找第一个未完成、未暂停的具体可执行项；
 * 某父级的下级全部完成而父级未完成时，提示确认完成该父级。剩余项全部暂停时不算满足收尾条件。
 */
export function nextStep(index: TodoIndex, rootId: string): NextStep {
  const root = index.byId.get(rootId);
  if (!root || root.status !== 'active') return { kind: 'none' };
  const visit = (node: Todo): NextStep | null => {
    const kids = index.children(node.id);
    if (!kids.length) return node.status === 'active' ? { kind: 'item', todo: node } : null;
    for (const kid of kids) {
      if (kid.status !== 'active') continue;
      const found = visit(kid);
      if (found) return found;
    }
    return kids.every(kid => kid.status === 'done') ? { kind: 'confirmParent', todo: node } : null;
  };
  return visit(root) ?? { kind: 'none' };
}

export interface TodoProgress {
  done: number;
  total: number;
  paused: number;
}

/** 进展按直接下级统计；暂停项计入总数并单独标出。 */
export function progressOf(index: TodoIndex, id: string): TodoProgress {
  const kids = index.children(id);
  return {
    done: kids.filter(kid => kid.status === 'done').length,
    total: kids.length,
    paused: kids.filter(kid => kid.status === 'paused').length
  };
}

export const isOverdue = (todo: Todo, today: string) =>
  todo.status !== 'done' && todo.dueDate !== null && todo.dueDate < today;
export const isDueToday = (todo: Todo, today: string) => todo.status !== 'done' && todo.dueDate === today;

export interface TodayView {
  /** 计划日期为今天的进行中事项。 */
  today: Todo[];
  /** 计划日期已过仍未完成，保留原计划日期，不称逾期。 */
  earlier: Todo[];
  /** 今天完成的事项。 */
  doneToday: Todo[];
  /** 今日截止或已逾期（含暂停项），不随折叠隐藏。 */
  dueAlerts: Todo[];
}

const visible = (todo: Todo) => !todo.deletedAt && !todo.archivedAt;
const byPlanThenOrder = (left: Todo, right: Todo) =>
  (left.plannedDate ?? '').localeCompare(right.plannedDate ?? '') || byOrder(left, right);

/** today 为设备本地日期；toLocalDate 用于把完成时间换算成本地日期（测试可注入）。 */
export function todayView(
  todos: readonly Todo[],
  today: string,
  toLocalDate: (iso: string) => string = localDateOf
): TodayView {
  const items = todos.filter(visible);
  return {
    today: items.filter(todo => todo.status === 'active' && todo.plannedDate === today).sort(byOrder),
    earlier: items
      .filter(todo => todo.status === 'active' && todo.plannedDate !== null && todo.plannedDate < today)
      .sort(byPlanThenOrder),
    doneToday: items
      .filter(todo => todo.status === 'done' && todo.completedAt !== null && toLocalDate(todo.completedAt) === today)
      .sort((left, right) => (right.completedAt ?? '').localeCompare(left.completedAt ?? '')),
    dueAlerts: items
      .filter(todo => isOverdue(todo, today) || isDueToday(todo, today))
      .sort((left, right) => (left.dueDate ?? '').localeCompare(right.dueDate ?? '') || byOrder(left, right))
  };
}

export interface PlanGroup {
  date: string;
  todos: Todo[];
}

/** 计划视图：今天之后的进行中安排按日期分组。 */
export function planView(todos: readonly Todo[], today: string): PlanGroup[] {
  const groups = new Map<string, Todo[]>();
  for (const todo of todos)
    if (visible(todo) && todo.status === 'active' && todo.plannedDate !== null && todo.plannedDate > today) {
      const list = groups.get(todo.plannedDate) ?? [];
      list.push(todo);
      groups.set(todo.plannedDate, list);
    }
  return [...groups.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([date, list]) => ({ date, todos: list.sort(byOrder) }));
}

/** 「加入今天」在已有未来计划日期时应显示为「改到今天」。 */
export const todayActionOf = (todo: Todo, today: string): 'addToToday' | 'moveToToday' | 'alreadyToday' =>
  todo.plannedDate === today
    ? 'alreadyToday'
    : todo.plannedDate !== null && todo.plannedDate > today
      ? 'moveToToday'
      : 'addToToday';

export type DateWarning = 'plannedAfterAncestorDue' | 'dueAfterAncestorDue' | 'reminderAfterDue';

/** 日期冲突只提示，不阻止保存。 */
export function dateWarnings(index: TodoIndex, todo: Todo): DateWarning[] {
  const warnings: DateWarning[] = [];
  const ancestorDue = index
    .ancestors(todo.id)
    .map(node => node.dueDate)
    .filter((date): date is string => date !== null)
    .sort()[0];
  if (ancestorDue && todo.plannedDate && todo.plannedDate > ancestorDue) warnings.push('plannedAfterAncestorDue');
  if (ancestorDue && todo.dueDate && todo.dueDate > ancestorDue) warnings.push('dueAfterAncestorDue');
  if (
    todo.reminder?.kind === 'fixed' &&
    todo.reminder.state === 'pending' &&
    todo.dueDate &&
    localDateOf(todo.reminder.at) > todo.dueDate
  )
    warnings.push('reminderAfterDue');
  return warnings;
}

export type TodoListFilter = 'open' | 'paused' | 'done' | 'archived';

/** 主线、支线列表的筛选；open 包含进行中，暂停与已完成作为单独筛选。 */
export function topLevelTodos(
  todos: readonly Todo[],
  kind: 'mainline' | 'sideline',
  filter: TodoListFilter,
  { starredOnly = false } = {}
): Todo[] {
  return todos
    .filter(todo => !todo.deletedAt && todo.parentId === null && todo.kind === kind)
    .filter(todo => (starredOnly ? todo.starred : true))
    .filter(todo => {
      if (filter === 'archived') return todo.archivedAt !== null;
      if (todo.archivedAt) return false;
      if (filter === 'open') return todo.status === 'active';
      if (filter === 'paused') return todo.status === 'paused';
      return todo.status === 'done';
    })
    .sort(byOrder);
}
