import { formatDateLabel, addDaysToDate } from '../../components/ui/input/DatePicker';
import {
  isDueToday,
  isOverdue,
  planView,
  todayView,
  topLevelTodos,
  type Todo,
  type TodoIndex
} from '@study-accelerator/web-core';

export { addDaysToDate, formatDateLabel };

/** 「今天」「明天」「昨天」，其余为「11月12日 周三」。 */
export function relativeDateLabel(date: string, today: string) {
  if (date === today) return '今天';
  if (date === addDaysToDate(today, 1)) return '明天';
  if (date === addDaysToDate(today, -1)) return '昨天';
  return formatDateLabel(date, today);
}

export function daysBetween(from: string, to: string) {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

export type DueTone = 'overdue' | 'today' | 'soon' | 'normal';

export function dueTone(todo: Todo, today: string): DueTone | null {
  if (!todo.dueDate || todo.status === 'done') return null;
  if (isOverdue(todo, today)) return 'overdue';
  if (isDueToday(todo, today)) return 'today';
  return daysBetween(today, todo.dueDate) <= 2 ? 'soon' : 'normal';
}

export function dueLabel(todo: Todo, today: string) {
  if (!todo.dueDate) return '';
  const tone = dueTone(todo, today);
  if (tone === 'overdue') return `已逾期 ${daysBetween(todo.dueDate, today)} 天`;
  if (tone === 'today') return '今天截止';
  return `${relativeDateLabel(todo.dueDate, today)}截止`;
}

/** 行内上下文：所属主线／支线与父任务，帮助在「今天」等平铺视图中认出事项。 */
export function contextPath(index: TodoIndex, todo: Todo) {
  return index
    .ancestors(todo.id)
    .reverse()
    .map(node => node.title);
}

export const KIND_LABEL: Record<Todo['kind'], string> = { mainline: '主线', sideline: '支线', item: '任务' };

export function statusLabel(todo: Todo) {
  if (todo.archivedAt) return '已归档';
  if (todo.status === 'done') return '已完成';
  if (todo.status === 'paused') return todo.pausedBy === 'parent' ? '随上级暂停' : '已暂停';
  return '进行中';
}

/** 待办所在顶层（主线或支线）。 */
export function topLevelOf(index: TodoIndex, todo: Todo) {
  const chain = index.ancestors(todo.id);
  return chain.length ? chain[chain.length - 1]! : todo;
}

/** 四个入口的数量：今天为需要处理的事项（今日安排、之前未完成、截止提醒去重），其余为进行中的条目。 */
export function pageCounts(todos: Todo[], today: string) {
  const view = todayView(todos, today);
  return {
    today: new Set([...view.today, ...view.earlier, ...view.dueAlerts].map(todo => todo.id)).size,
    plan: planView(todos, today).reduce((sum, group) => sum + group.todos.length, 0),
    mainlines: topLevelTodos(todos, 'mainline', 'open').length,
    sidelines: topLevelTodos(todos, 'sideline', 'open').length
  };
}
