import { isDateOnly, isTimeOfDay, isZonedIso } from './dates.ts';
import { isOrderKey } from './order.ts';
import { indexTodos } from './tree.ts';
import { TODO_MAX_DEPTH, TODO_PAUSE_REASON_MAX, TODO_TEXT_MAX, TODO_TITLE_MAX } from './types.ts';
import type { Todo, TodoReminder } from './types.ts';

const TODO_KEYS = [
  'id',
  'parentId',
  'kind',
  'title',
  'note',
  'goal',
  'order',
  'starred',
  'status',
  'pausedBy',
  'pauseReason',
  'plannedDate',
  'dueDate',
  'completedAt',
  'archivedAt',
  'deletedAt',
  'reminder',
  'revision',
  'createdAt',
  'updatedAt'
].sort();

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const exactKeys = (value: Record<string, unknown>, keys: string[]) =>
  JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort());
const nullable = <T>(value: unknown, check: (value: unknown) => value is T) => value === null || check(value);
const isId = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(value);
const isReminderState = (value: unknown) => ['pending', 'fired', 'missed', 'cancelled'].includes(value as string);

function isReminder(value: unknown): value is TodoReminder {
  if (!isObject(value) || !isZonedIso(value.dueAt) || !isReminderState(value.state)) return false;
  if (value.kind === 'fixed') return exactKeys(value, ['kind', 'at', 'dueAt', 'state']) && isZonedIso(value.at);
  return (
    value.kind === 'beforeDue' &&
    exactKeys(value, ['kind', 'daysBefore', 'time', 'utcOffsetMinutes', 'dueAt', 'state']) &&
    Number.isSafeInteger(value.daysBefore) &&
    (value.daysBefore as number) >= 0 &&
    (value.daysBefore as number) <= 30 &&
    isTimeOfDay(value.time) &&
    Number.isSafeInteger(value.utcOffsetMinutes) &&
    Math.abs(value.utcOffsetMinutes as number) <= 14 * 60
  );
}

/** 单条记录的字段校验（存储读取、同步入站共用）。返回错误说明，合法时为 null。 */
export function todoRecordError(value: unknown): string | null {
  if (!isObject(value) || !exactKeys(value, TODO_KEYS)) return '字段集合不符';
  const text = (field: unknown, max: number) => typeof field === 'string' && field.length <= max;
  if (!isId(value.id) || !nullable(value.parentId, isId)) return 'ID 无效';
  if (!['mainline', 'sideline', 'item'].includes(value.kind as string)) return '类型无效';
  if ((value.parentId === null) === (value.kind === 'item')) return '层级与类型不符';
  if (!text(value.title, TODO_TITLE_MAX) || !(value.title as string).trim()) return '名称无效';
  if (!text(value.note, TODO_TEXT_MAX) || !text(value.goal, TODO_TEXT_MAX)) return '说明无效';
  if (value.goal && value.kind !== 'mainline') return '非主线不能有目标说明';
  if (!isOrderKey(value.order) || typeof value.starred !== 'boolean') return '排序或星标无效';
  if (!['active', 'paused', 'done'].includes(value.status as string)) return '状态无效';
  if (value.status === 'paused' ? !['self', 'parent'].includes(value.pausedBy as string) : value.pausedBy !== null)
    return '暂停来源无效';
  if (value.pauseReason !== null && (value.pausedBy !== 'self' || !text(value.pauseReason, TODO_PAUSE_REASON_MAX)))
    return '暂停原因无效';
  if (!nullable(value.plannedDate, isDateOnly) || !nullable(value.dueDate, isDateOnly)) return '日期无效';
  if (
    !nullable(value.completedAt, isZonedIso) ||
    !nullable(value.archivedAt, isZonedIso) ||
    !nullable(value.deletedAt, isZonedIso)
  )
    return '时间无效';
  if (value.status === 'done' && value.completedAt === null) return '已完成缺少完成时间';
  if (value.archivedAt !== null && value.status !== 'done') return '只有已完成的待办可以归档';
  if (!nullable(value.reminder, isReminder)) return '提醒无效';
  if (!Number.isSafeInteger(value.revision) || (value.revision as number) < 1) return '修订号无效';
  if (!isZonedIso(value.createdAt) || !isZonedIso(value.updatedAt)) return '创建或更新时间无效';
  return null;
}

export function isTodoRecord(value: unknown): value is Todo {
  return todoRecordError(value) === null;
}

/**
 * 整个集合的结构不变量（同步批次提交后的状态必须满足）：
 * 父级存在且未删除、无环、层级不超限、归档整棵一致、已完成节点下没有未完成项、暂停继承一致。
 */
export function todoCollectionErrors(todos: readonly Todo[]): string[] {
  const errors: string[] = [];
  const all = new Map(todos.map(todo => [todo.id, todo]));
  for (const todo of todos) {
    const error = todoRecordError(todo);
    if (error) errors.push(`${todo?.id ?? '?'}: ${error}`);
  }
  if (errors.length) return errors;
  const index = indexTodos(todos);
  for (const todo of todos) {
    if (todo.parentId === null) continue;
    const parent = all.get(todo.parentId);
    if (!parent) {
      errors.push(`${todo.id}: 上级不存在`);
      continue;
    }
    if (todo.deletedAt) continue;
    if (parent.deletedAt) errors.push(`${todo.id}: 上级已删除`);
    if (parent.archivedAt && !todo.archivedAt) errors.push(`${todo.id}: 归档上级下有未归档内容`);
    if (!parent.archivedAt && todo.archivedAt) errors.push(`${todo.id}: 不支持局部归档`);
    if (parent.status === 'done' && todo.status !== 'done') errors.push(`${todo.id}: 已完成上级下有未完成内容`);
    if (parent.status === 'paused' && todo.status === 'active') errors.push(`${todo.id}: 暂停上级下有进行中内容`);
    if (todo.pausedBy === 'parent' && parent.status !== 'paused') errors.push(`${todo.id}: 随上级暂停但上级未暂停`);
  }
  for (const todo of todos) {
    if (todo.deletedAt) continue;
    const seen = new Set<string>();
    let current: Todo | undefined = todo;
    let depth = 0;
    while (current) {
      if (seen.has(current.id)) {
        errors.push(`${todo.id}: 层级成环`);
        break;
      }
      seen.add(current.id);
      depth += 1;
      current = current.parentId === null ? undefined : index.byId.get(current.parentId);
    }
    if (depth > TODO_MAX_DEPTH) errors.push(`${todo.id}: 超过 ${TODO_MAX_DEPTH} 层`);
    if (todo.parentId === null && todo.pausedBy === 'parent') errors.push(`${todo.id}: 顶层不能随上级暂停`);
  }
  return errors;
}
