import { Ajv } from 'ajv';
import addFormats from 'ajv-formats';
import { createAppError } from '../../errors/app-error.ts';

// 只读兼容已安装过的个人待办 v1；不提供命令、提醒投递或领域初始化。
interface Reminder {
  kind: 'fixed' | 'relative';
  at?: string;
  daysBefore?: number;
  time?: string;
  timeZone?: string;
  dueAt: string;
  state: string;
}
interface Todo {
  id: string;
  parentId: string | null;
  kind: string;
  status: string;
  dueDate: string | null;
  completedAt: string | null;
  archivedAt: string | null;
  reminder: Reminder | null;
}
export interface PersonalTodoHistory {
  version: 1;
  owners: {
    ownerId: string;
    revision: number;
    todos: Todo[];
    receipts: { requestId: string }[];
    undo: { token: string; revision: number; todos: Todo[] } | null;
  }[];
}
const text = (maxLength: number, required = false) => ({
  type: 'string',
  maxLength,
  ...(required ? { minLength: 1, pattern: '\\S' } : {})
});
const instant = { type: 'string', format: 'date-time' };
const nullable = (schema: object) => ({ anyOf: [schema, { type: 'null' }] });
const object = (properties: Record<string, object>, optional: string[] = []) => ({
  type: 'object',
  properties,
  required: Object.keys(properties).filter(key => !optional.includes(key)),
  additionalProperties: false
});
const reminder = {
  anyOf: [
    { type: 'null' },
    object({
      kind: { const: 'fixed' },
      at: instant,
      dueAt: instant,
      state: { enum: ['pending', 'delivered', 'missed', 'cancelled'] }
    }),
    object({
      kind: { const: 'relative' },
      daysBefore: { type: 'integer', minimum: 0, maximum: 3650 },
      time: { type: 'string', pattern: '^(?:[01]\\d|2[0-3]):[0-5]\\d$' },
      timeZone: text(100, true),
      dueAt: instant,
      state: { enum: ['pending', 'delivered', 'missed', 'cancelled'] }
    })
  ]
};
const todo = object({
  id: text(100, true),
  parentId: nullable(text(100, true)),
  kind: { enum: ['main', 'side', 'task'] },
  title: text(500, true),
  description: text(10000),
  goal: text(10000),
  completionCriteria: text(10000),
  plannedDate: nullable({ type: 'string', format: 'date' }),
  dueDate: nullable({ type: 'string', format: 'date' }),
  starred: { type: 'boolean' },
  order: { type: 'integer', minimum: 0 },
  status: { enum: ['active', 'paused', 'completed'] },
  pauseReason: text(2000),
  completedAt: nullable(instant),
  completionHistory: { type: 'array', items: object({ completedAt: instant, reopenedAt: nullable(instant) }) },
  archivedAt: nullable(instant),
  createdAt: instant,
  updatedAt: instant,
  reminder
});
const todos = { type: 'array', items: todo };
const schema = object({
  version: { const: 1 },
  owners: {
    type: 'array',
    items: object({
      ownerId: text(200, true),
      revision: { type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
      todos,
      receipts: {
        type: 'array',
        items: object(
          {
            requestId: text(100, true),
            fingerprint: { type: 'string', pattern: '^[a-f0-9]{64}$' },
            undoToken: text(100, true)
          },
          ['undoToken']
        )
      },
      undo: nullable(object({ token: text(100, true), revision: { type: 'integer', minimum: 0 }, todos }))
    })
  }
});
const ajv = new Ajv({ strict: false, allErrors: false });
(addFormats as unknown as import('ajv-formats').FormatsPlugin)(ajv);
const validate = ajv.compile<PersonalTodoHistory>(schema);
function fail(): never {
  throw createAppError('PERSONAL_TODO_HISTORY_INVALID', '个人待办历史资料契约无效，原资料已保留。', 422);
}
function reminderDueAt(reminder: Reminder, dueDate: string | null): string {
  if (reminder.kind === 'fixed') return reminder.at!;
  if (!dueDate) fail();
  const day = new Date(`${dueDate}T00:00:00Z`);
  day.setUTCDate(day.getUTCDate() - reminder.daysBefore!);
  const wall = Date.parse(`${day.toISOString().slice(0, 10)}T${reminder.time}:00Z`);
  const format = new Intl.DateTimeFormat('en-CA', {
    timeZone: reminder.timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23'
  });
  let value = wall;
  for (let attempt = 0; attempt < 4; attempt++) {
    const parts = Object.fromEntries(format.formatToParts(value).map(part => [part.type, part.value]));
    const delta =
      wall - Date.parse(`${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}Z`);
    if (delta === 0) return new Date(value).toISOString();
    value += delta;
  }
  return fail();
}
function validateTodos(values: Todo[]): void {
  const byId = new Map(values.map(todo => [todo.id, todo]));
  if (byId.size !== values.length) fail();
  for (const todo of values) {
    if (
      !(todo.parentId === null ? ['main', 'side'] : ['task']).includes(todo.kind) ||
      (todo.status === 'completed') !== (todo.completedAt !== null) ||
      (todo.archivedAt && todo.status !== 'completed')
    )
      fail();
    const seen = new Set([todo.id]);
    let current = todo;
    while (current.parentId !== null) {
      const parent = byId.get(current.parentId);
      if (
        !parent ||
        seen.has(parent.id) ||
        seen.size >= 64 ||
        (todo.status !== 'completed' && parent.status === 'completed') ||
        (todo.archivedAt && parent.archivedAt !== todo.archivedAt) ||
        (parent.archivedAt && !todo.archivedAt)
      )
        fail();
      seen.add(parent.id);
      current = parent;
    }
    if (todo.reminder) {
      if ((todo.status === 'completed' || todo.archivedAt) && todo.reminder.state === 'pending') fail();
      try {
        if (reminderDueAt(todo.reminder, todo.dueDate) !== todo.reminder.dueAt) fail();
      } catch {
        fail();
      }
    }
  }
}
export function validatePersonalTodoHistory(input: unknown): PersonalTodoHistory {
  if (!validate(input)) fail();
  const owners = new Set<string>();
  for (const owner of input.owners) {
    if (
      owners.has(owner.ownerId) ||
      new Set(owner.receipts.map(receipt => receipt.requestId)).size !== owner.receipts.length
    )
      fail();
    owners.add(owner.ownerId);
    validateTodos(owner.todos);
    if (owner.undo) {
      if (owner.undo.revision !== owner.revision) fail();
      validateTodos(owner.undo.todos);
      const archived = new Set(owner.todos.filter(todo => todo.archivedAt).map(todo => todo.id));
      if (owner.undo.todos.some(todo => archived.has(todo.parentId ?? '') && !archived.has(todo.id))) fail();
      for (const todo of owner.todos.filter(todo => todo.archivedAt))
        if (JSON.stringify(owner.undo.todos.find(row => row.id === todo.id)) !== JSON.stringify(todo)) fail();
    }
  }
  return structuredClone(input);
}
