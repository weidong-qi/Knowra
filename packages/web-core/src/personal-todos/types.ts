/** 个人待办首版共享契约。规则依据 docs/打卡与待办/规划与需求.md 与 个人待办首版-技术方案.md。 */

export type TodoKind = 'mainline' | 'sideline' | 'item';
export type TodoStatus = 'active' | 'paused' | 'done';
export type TodoPausedBy = 'self' | 'parent';
export type ReminderState = 'pending' | 'fired' | 'missed' | 'cancelled';

export interface FixedReminder {
  kind: 'fixed';
  /** 带时区偏移或 Z 的 ISO 时间。 */
  at: string;
  dueAt: string;
  state: ReminderState;
}

export interface BeforeDueReminder {
  kind: 'beforeDue';
  daysBefore: number;
  /** HH:mm，按设置时的 utcOffsetMinutes 解释。 */
  time: string;
  utcOffsetMinutes: number;
  /** 由截止日期推导；截止日期变化时随之重算。 */
  dueAt: string;
  state: ReminderState;
}

export type TodoReminder = FixedReminder | BeforeDueReminder;

export interface Todo {
  id: string;
  parentId: string | null;
  kind: TodoKind;
  title: string;
  note: string;
  /** 仅主线使用：目标说明与完成标准。 */
  goal: string;
  /** 同级排序键，按字符串比较。 */
  order: string;
  starred: boolean;
  status: TodoStatus;
  pausedBy: TodoPausedBy | null;
  pauseReason: string | null;
  /** YYYY-MM-DD */
  plannedDate: string | null;
  /** YYYY-MM-DD */
  dueDate: string | null;
  /** 最近一次完成时间；重新打开后保留，状态以 status 为准。 */
  completedAt: string | null;
  archivedAt: string | null;
  deletedAt: string | null;
  reminder: TodoReminder | null;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export type ReminderInput =
  { kind: 'fixed'; at: string } | { kind: 'beforeDue'; daysBefore: number; time: string; utcOffsetMinutes: number };

export interface TodoEditableFields {
  title: string;
  note: string;
  goal: string;
  starred: boolean;
  plannedDate: string | null;
  dueDate: string | null;
}

export type TodoCommand =
  | {
      type: 'create';
      id: string;
      parentId: string | null;
      /** 顶层可选主线或支线，默认支线；非顶层忽略。 */
      kind?: 'mainline' | 'sideline';
      title: string;
      note?: string;
      goal?: string;
      starred?: boolean;
      plannedDate?: string | null;
      dueDate?: string | null;
      /** 放在该兄弟之后；null 表示放在最前；缺省放在最后。 */
      afterId?: string | null;
    }
  | { type: 'update'; id: string; expectedRevision: number; patch: Partial<TodoEditableFields> }
  | {
      type: 'move';
      id: string;
      expectedRevision: number;
      parentId: string | null;
      /** 放在该兄弟之后；null 表示最前；缺省放在末尾。 */
      afterId?: string | null;
    }
  | { type: 'promote'; id: string; expectedRevision: number }
  | { type: 'pause'; id: string; expectedRevision: number; reason?: string | null }
  | { type: 'resume'; id: string; expectedRevision: number }
  | { type: 'complete'; id: string; expectedRevision: number; includeChildren?: boolean }
  | { type: 'reopen'; id: string; expectedRevision: number }
  | { type: 'delete'; id: string; expectedRevision: number }
  | { type: 'restore'; id: string }
  | { type: 'archive'; id: string; expectedRevision: number }
  | { type: 'setReminder'; id: string; expectedRevision: number; reminder: ReminderInput | null }
  | { type: 'ackReminder'; id: string; dueAt: string; outcome: 'fired' | 'missed' };

export type TodoCommandType = TodoCommand['type'];

export type TodoRuleCode =
  | 'TODO_NOT_FOUND'
  | 'TODO_REVISION_CONFLICT'
  | 'TODO_ARCHIVED'
  | 'TODO_INVALID_INPUT'
  | 'TODO_INVALID_MOVE'
  | 'TODO_DEPTH_EXCEEDED'
  | 'TODO_HAS_OPEN_CHILDREN'
  | 'TODO_INVALID_STATE'
  | 'TODO_PAUSED_BY_PARENT'
  | 'TODO_NOT_ARCHIVABLE'
  | 'TODO_ALREADY_EXISTS';

export class TodoRuleError extends Error {
  readonly code: TodoRuleCode;
  constructor(code: TodoRuleCode, message: string) {
    super(message);
    this.name = 'TodoRuleError';
    this.code = code;
  }
}

export const TODO_MAX_DEPTH = 5;
export const TODO_TITLE_MAX = 200;
export const TODO_TEXT_MAX = 5000;
export const TODO_PAUSE_REASON_MAX = 200;
/** 提醒到期后超过此时长才打开应用，视为错过，不补发。 */
export const REMINDER_GRACE_MS = 10 * 60 * 1000;
