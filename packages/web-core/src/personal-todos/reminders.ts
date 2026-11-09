import { addDays, isDateOnly, isTimeOfDay, isZonedIso, zonedDateTimeToIso } from './dates.js';
import { REMINDER_GRACE_MS, TodoRuleError } from './types.js';
import type { ReminderInput, Todo, TodoReminder } from './types.js';

const MAX_DAYS_BEFORE = 30;

export function beforeDueAt(dueDate: string, daysBefore: number, time: string, utcOffsetMinutes: number): string {
  return zonedDateTimeToIso(addDays(dueDate, -daysBefore), time, utcOffsetMinutes);
}

/** 由用户输入构造提醒；相对截止的提醒要求已有截止日期。 */
export function buildReminder(input: ReminderInput, dueDate: string | null): TodoReminder {
  if (input.kind === 'fixed') {
    if (!isZonedIso(input.at)) throw new TodoRuleError('TODO_INVALID_INPUT', '提醒时间格式无效');
    const at = new Date(input.at).toISOString();
    return { kind: 'fixed', at, dueAt: at, state: 'pending' };
  }
  if (
    !Number.isSafeInteger(input.daysBefore) ||
    input.daysBefore < 0 ||
    input.daysBefore > MAX_DAYS_BEFORE ||
    !isTimeOfDay(input.time) ||
    !Number.isSafeInteger(input.utcOffsetMinutes) ||
    Math.abs(input.utcOffsetMinutes) > 14 * 60
  )
    throw new TodoRuleError('TODO_INVALID_INPUT', '相对截止提醒的设置无效');
  if (!dueDate || !isDateOnly(dueDate)) throw new TodoRuleError('TODO_INVALID_INPUT', '相对截止提醒需要先设置截止日期');
  return {
    kind: 'beforeDue',
    daysBefore: input.daysBefore,
    time: input.time,
    utcOffsetMinutes: input.utcOffsetMinutes,
    dueAt: beforeDueAt(dueDate, input.daysBefore, input.time, input.utcOffsetMinutes),
    state: 'pending'
  };
}

/**
 * 截止日期变化后的提醒：相对提醒跟随重算并重新待触发；截止日期被清除时取消。
 * 固定提醒保持不变，冲突由界面提示。
 */
export function reminderAfterDueChange(reminder: TodoReminder | null, dueDate: string | null): TodoReminder | null {
  if (!reminder || reminder.kind !== 'beforeDue') return reminder;
  if (reminder.state === 'cancelled') return reminder;
  if (!dueDate) return { ...reminder, state: 'cancelled' };
  const dueAt = beforeDueAt(dueDate, reminder.daysBefore, reminder.time, reminder.utcOffsetMinutes);
  return dueAt === reminder.dueAt ? reminder : { ...reminder, dueAt, state: 'pending' };
}

export function cancelReminder(reminder: TodoReminder | null): TodoReminder | null {
  return reminder && reminder.state === 'pending' ? { ...reminder, state: 'cancelled' } : reminder;
}

/** 恢复时已过时间的待触发提醒标为错过，不集中补发。 */
export function missPastReminder(reminder: TodoReminder | null, now: string): TodoReminder | null {
  return reminder && reminder.state === 'pending' && Date.parse(reminder.dueAt) <= Date.parse(now)
    ? { ...reminder, state: 'missed' }
    : reminder;
}

/** 此刻应投递的提醒：待触发、已到期、未超过宽限期，且任务仍在进行中。 */
export function remindersToDeliver(todos: readonly Todo[], now: string): Todo[] {
  const nowMs = Date.parse(now);
  return todos.filter(todo => {
    const reminder = todo.reminder;
    if (!reminder || reminder.state !== 'pending' || todo.deletedAt || todo.archivedAt || todo.status !== 'active')
      return false;
    const dueMs = Date.parse(reminder.dueAt);
    return dueMs <= nowMs && nowMs - dueMs <= REMINDER_GRACE_MS;
  });
}

/** 已到期但超过宽限期仍未投递的提醒，应标为错过并提示重新设置。 */
export function remindersMissed(todos: readonly Todo[], now: string): Todo[] {
  const nowMs = Date.parse(now);
  return todos.filter(todo => {
    const reminder = todo.reminder;
    if (!reminder || reminder.state !== 'pending' || todo.deletedAt || todo.archivedAt || todo.status !== 'active')
      return false;
    return nowMs - Date.parse(reminder.dueAt) > REMINDER_GRACE_MS;
  });
}
