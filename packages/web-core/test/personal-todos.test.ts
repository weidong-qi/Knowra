import { describe, expect, it } from 'vitest';
import {
  applyTodoCommand,
  dateWarnings,
  indexTodos,
  mergeTodoChanges,
  nextStep,
  orderBetween,
  planView,
  progressOf,
  remindersMissed,
  remindersToDeliver,
  todayActionOf,
  todayView,
  todoCollectionErrors,
  TodoRuleError,
  topLevelTodos
} from '../src/personal-todos/index.js';
import type { Todo, TodoCommand } from '../src/personal-todos/index.js';

const T0 = '2026-11-09T02:00:00.000Z';

/** 合成数据工作台：每条命令都在当前状态上执行并合并，最后校验集合不变量。 */
function bench() {
  let todos: Todo[] = [];
  let clock = Date.parse(T0);
  const run = (command: TodoCommand) => {
    clock += 1000;
    const { changed } = applyTodoCommand(todos, command, { now: new Date(clock).toISOString() });
    todos = mergeTodoChanges(todos, changed);
    expect(todoCollectionErrors(todos)).toEqual([]);
    return changed;
  };
  const get = (id: string) => todos.find(todo => todo.id === id)!;
  const rev = (id: string) => get(id).revision;
  const create = (id: string, parentId: string | null, extra: Partial<Extract<TodoCommand, { type: 'create' }>> = {}) =>
    run({ type: 'create', id, parentId, title: id, ...extra });
  const act = (type: 'pause' | 'resume' | 'reopen' | 'delete' | 'archive' | 'promote', id: string) =>
    run({ type, id, expectedRevision: rev(id) } as TodoCommand);
  const complete = (id: string, includeChildren?: boolean) =>
    run({ type: 'complete', id, expectedRevision: rev(id), includeChildren });
  const failsWith = (code: string, fn: () => unknown) => {
    try {
      fn();
    } catch (error) {
      expect(error).toBeInstanceOf(TodoRuleError);
      expect((error as TodoRuleError).code).toBe(code);
      return;
    }
    throw new Error(`应以 ${code} 失败`);
  };
  return {
    run,
    get,
    rev,
    create,
    act,
    complete,
    failsWith,
    all: () => todos,
    now: () => new Date(clock).toISOString()
  };
}

/** 需求文档第七节的示例任务树。 */
function sampleProject() {
  const b = bench();
  b.create('m', null, { kind: 'mainline' });
  b.create('data', 'm');
  b.create('train', 'm');
  b.create('loop', 'train');
  b.create('first', 'train');
  b.create('result', 'm');
  b.complete('data');
  return b;
}

describe('排序键', () => {
  it('在任意两个键之间生成严格介于其间的新键', () => {
    const keys = [orderBetween(null, null)];
    for (let i = 0; i < 50; i += 1) keys.push(orderBetween(keys.at(-1)!, null));
    for (let i = 0; i < 50; i += 1) keys.unshift(orderBetween(null, keys[0]!));
    let left = keys[10]!;
    const right = keys[11]!;
    for (let i = 0; i < 40; i += 1) {
      const middle = orderBetween(left, right);
      expect(left < middle && middle < right).toBe(true);
      left = middle;
    }
    expect([...keys].sort()).toEqual(keys);
  });
});

describe('创建与结构', () => {
  it('顶层默认是支线，主线内部新建成为子任务，并按位置插入', () => {
    const b = bench();
    b.create('s', null);
    b.create('m', null, { kind: 'mainline', goal: '训练出可用模型' });
    b.create('a', 'm');
    b.create('c', 'm');
    b.create('b', 'm', { afterId: 'a' });
    b.create('first', 'm', { afterId: null });
    expect(b.get('s').kind).toBe('sideline');
    expect(b.get('a').kind).toBe('item');
    expect(
      indexTodos(b.all())
        .children('m')
        .map(todo => todo.id)
    ).toEqual(['first', 'a', 'b', 'c']);
    b.failsWith('TODO_INVALID_INPUT', () => b.create('x', 's', { goal: '不允许' }));
    b.failsWith('TODO_INVALID_INPUT', () => b.create('y', null, { title: '  ' }));
  });

  it('最多嵌套 5 层，移动时按整棵子树高度检查', () => {
    const b = bench();
    b.create('l1', null, { kind: 'mainline' });
    for (let i = 2; i <= 5; i += 1) b.create(`l${i}`, `l${i - 1}`);
    b.failsWith('TODO_DEPTH_EXCEEDED', () => b.create('l6', 'l5'));
    b.create('s', null);
    b.create('s2', 's');
    b.failsWith('TODO_DEPTH_EXCEEDED', () =>
      b.run({ type: 'move', id: 's', expectedRevision: b.rev('s'), parentId: 'l4', afterId: null })
    );
  });

  it('支线升级为主线，或整体移入主线成为子任务且只保留一份', () => {
    const b = bench();
    b.create('m', null, { kind: 'mainline' });
    b.create('s', null);
    b.create('step', 's');
    b.complete('step');
    b.act('promote', 's');
    expect(b.get('s').kind).toBe('mainline');
    b.create('s2', null);
    b.create('s2a', 's2');
    b.run({ type: 'move', id: 's2', expectedRevision: b.rev('s2'), parentId: 'm', afterId: null });
    expect(b.get('s2')).toMatchObject({ kind: 'item', parentId: 'm' });
    expect(b.get('s2a').parentId).toBe('s2');
    expect(topLevelTodos(b.all(), 'sideline', 'open')).toEqual([]);
    b.failsWith('TODO_INVALID_MOVE', () =>
      b.run({ type: 'move', id: 'm', expectedRevision: b.rev('m'), parentId: 's', afterId: null })
    );
    b.failsWith('TODO_INVALID_MOVE', () =>
      b.run({ type: 'move', id: 's2', expectedRevision: b.rev('s2'), parentId: 's2a', afterId: null })
    );
  });

  it('修订号不符时拒绝写入', () => {
    const b = bench();
    b.create('s', null);
    b.failsWith('TODO_REVISION_CONFLICT', () =>
      b.run({ type: 'update', id: 's', expectedRevision: 99, patch: { title: '新' } })
    );
  });
});

describe('暂停与恢复', () => {
  it('暂停父级时未完成下级随之暂停，恢复时只恢复随父暂停的下级', () => {
    const b = sampleProject();
    b.run({ type: 'pause', id: 'first', expectedRevision: b.rev('first'), reason: '等数据' });
    b.act('pause', 'm');
    expect(b.get('loop')).toMatchObject({ status: 'paused', pausedBy: 'parent' });
    expect(b.get('first')).toMatchObject({ status: 'paused', pausedBy: 'self', pauseReason: '等数据' });
    expect(b.get('data').status).toBe('done');
    b.failsWith('TODO_PAUSED_BY_PARENT', () => b.act('resume', 'loop'));
    b.act('resume', 'm');
    expect(b.get('loop').status).toBe('active');
    expect(b.get('train').status).toBe('active');
    expect(b.get('first')).toMatchObject({ status: 'paused', pausedBy: 'self' });
  });

  it('暂停期间仍可编辑和调整结构，新建下级同样处于暂停', () => {
    const b = sampleProject();
    b.act('pause', 'm');
    b.run({ type: 'update', id: 'loop', expectedRevision: b.rev('loop'), patch: { note: '改用小批量' } });
    b.create('extra', 'train');
    expect(b.get('extra')).toMatchObject({ status: 'paused', pausedBy: 'parent' });
  });

  it('恢复时已错过的提醒标为错过，不补发', () => {
    const b = bench();
    b.create('s', null);
    b.run({
      type: 'setReminder',
      id: 's',
      expectedRevision: b.rev('s'),
      reminder: { kind: 'fixed', at: '2026-11-09T02:00:00.500Z' }
    });
    b.act('pause', 's');
    expect(remindersToDeliver(b.all(), '2026-11-09T02:01:00.000Z')).toEqual([]);
    b.act('resume', 's');
    expect(b.get('s').reminder?.state).toBe('missed');
  });
});

describe('完成、重新打开与删除', () => {
  it('还有未完成下级时不能静默完成父级，可选择全部标为完成', () => {
    const b = sampleProject();
    b.failsWith('TODO_HAS_OPEN_CHILDREN', () => b.complete('train'));
    b.complete('train', true);
    expect(['train', 'loop', 'first'].map(id => b.get(id).status)).toEqual(['done', 'done', 'done']);
  });

  it('子任务全部完成不自动完成父级，下一步提示确认完成', () => {
    const b = sampleProject();
    b.complete('loop');
    b.complete('first');
    expect(b.get('train').status).toBe('active');
    const step = nextStep(indexTodos(b.all()), 'm');
    expect(step).toMatchObject({ kind: 'confirmParent', todo: { id: 'train' } });
  });

  it('重新打开已完成子任务时，已完成的上级一并重新打开且保留完成时间', () => {
    const b = sampleProject();
    b.complete('m', true);
    const completedAt = b.get('loop').completedAt;
    b.act('reopen', 'loop');
    expect(b.get('loop')).toMatchObject({ status: 'active', completedAt });
    expect(b.get('train').status).toBe('active');
    expect(b.get('m').status).toBe('active');
    expect(b.get('first').status).toBe('done');
  });

  it('删除连同下级一起删除，撤销后整体恢复', () => {
    const b = sampleProject();
    b.act('delete', 'train');
    expect(
      indexTodos(b.all())
        .children('m')
        .map(todo => todo.id)
    ).toEqual(['data', 'result']);
    expect(b.get('loop').deletedAt).not.toBeNull();
    b.run({ type: 'restore', id: 'train' });
    expect(
      indexTodos(b.all())
        .children('train')
        .map(todo => todo.id)
    ).toEqual(['loop', 'first']);
  });

  it('完成或删除取消尚未触发的提醒', () => {
    const b = bench();
    b.create('s', null, { dueDate: '2026-11-20' });
    b.run({
      type: 'setReminder',
      id: 's',
      expectedRevision: b.rev('s'),
      reminder: { kind: 'beforeDue', daysBefore: 1, time: '09:00', utcOffsetMinutes: 480 }
    });
    b.complete('s');
    expect(b.get('s').reminder?.state).toBe('cancelled');
  });
});

describe('归档', () => {
  it('只有整棵已完成的主线或支线可以归档，归档后不能再修改、删除或向内移动', () => {
    const b = sampleProject();
    b.failsWith('TODO_NOT_ARCHIVABLE', () => b.act('archive', 'm'));
    b.complete('m', true);
    b.failsWith('TODO_NOT_ARCHIVABLE', () => b.act('archive', 'train'));
    b.act('archive', 'm');
    expect(b.get('loop').archivedAt).not.toBeNull();
    b.failsWith('TODO_ARCHIVED', () => b.act('reopen', 'loop'));
    b.failsWith('TODO_ARCHIVED', () => b.act('delete', 'm'));
    b.failsWith('TODO_ARCHIVED', () =>
      b.run({ type: 'update', id: 'first', expectedRevision: b.rev('first'), patch: { starred: true } })
    );
    b.failsWith('TODO_ARCHIVED', () => b.create('late', 'train'));
    b.create('s', null);
    b.failsWith('TODO_ARCHIVED', () =>
      b.run({ type: 'move', id: 's', expectedRevision: b.rev('s'), parentId: 'm', afterId: null })
    );
    expect(topLevelTodos(b.all(), 'mainline', 'archived').map(todo => todo.id)).toEqual(['m']);
    expect(topLevelTodos(b.all(), 'mainline', 'done')).toEqual([]);
  });

  it('归档主线下被删除的内容不能借撤销删除恢复进去', () => {
    const b = sampleProject();
    b.act('delete', 'result');
    b.complete('m', true);
    b.act('archive', 'm');
    b.failsWith('TODO_ARCHIVED', () => b.run({ type: 'restore', id: 'result' }));
  });
});

describe('下一步与进展', () => {
  it('按排序逐层找到第一个具体可执行项，完成后顺延', () => {
    const b = sampleProject();
    expect(nextStep(indexTodos(b.all()), 'm')).toMatchObject({ kind: 'item', todo: { id: 'loop' } });
    b.complete('loop');
    expect(nextStep(indexTodos(b.all()), 'm')).toMatchObject({ kind: 'item', todo: { id: 'first' } });
  });

  it('暂停分支整体跳过；剩余项全部暂停时不提示收尾', () => {
    const b = sampleProject();
    b.act('pause', 'train');
    expect(nextStep(indexTodos(b.all()), 'm')).toMatchObject({ kind: 'item', todo: { id: 'result' } });
    b.act('pause', 'result');
    expect(nextStep(indexTodos(b.all()), 'm')).toEqual({ kind: 'none' });
  });

  it('进展按直接下级统计，暂停项单独标出', () => {
    const b = sampleProject();
    b.act('pause', 'result');
    expect(progressOf(indexTodos(b.all()), 'm')).toEqual({ done: 1, total: 3, paused: 1 });
  });
});

describe('今天与计划', () => {
  const today = '2026-11-09';
  const local = (iso: string) => iso.slice(0, 10);

  it('分出今日安排、之前未完成、今日已完成，截止提醒单独保留且包含暂停项', () => {
    const b = bench();
    b.create('today', null, { plannedDate: today });
    b.create('earlier', null, { plannedDate: '2026-11-07', dueDate: '2026-11-20' });
    b.create('future', null, { plannedDate: '2026-11-12' });
    b.create('overdue', null, { dueDate: '2026-11-08' });
    b.create('pausedDue', null, { plannedDate: today, dueDate: today });
    b.act('pause', 'pausedDue');
    b.create('done', null, { plannedDate: today });
    b.complete('done');
    const view = todayView(b.all(), today, local);
    expect(view.today.map(todo => todo.id)).toEqual(['today']);
    expect(view.earlier.map(todo => todo.id)).toEqual(['earlier']);
    expect(view.doneToday.map(todo => todo.id)).toEqual(['done']);
    expect(view.dueAlerts.map(todo => todo.id)).toEqual(['overdue', 'pausedDue']);
    expect(planView(b.all(), today)).toEqual([{ date: '2026-11-12', todos: [b.get('future')] }]);
  });

  it('父级安排在今天不会把下级带入今天', () => {
    const b = sampleProject();
    b.run({ type: 'update', id: 'train', expectedRevision: b.rev('train'), patch: { plannedDate: today } });
    expect(todayView(b.all(), today, local).today.map(todo => todo.id)).toEqual(['train']);
  });

  it('已有未来计划时显示改到今天；日期晚于主线截止只提示', () => {
    const b = sampleProject();
    b.run({ type: 'update', id: 'm', expectedRevision: b.rev('m'), patch: { dueDate: '2026-11-30' } });
    b.run({ type: 'update', id: 'loop', expectedRevision: b.rev('loop'), patch: { plannedDate: '2026-12-02' } });
    expect(todayActionOf(b.get('loop'), today)).toBe('moveToToday');
    expect(todayActionOf(b.get('first'), today)).toBe('addToToday');
    expect(dateWarnings(indexTodos(b.all()), b.get('loop'))).toEqual(['plannedAfterAncestorDue']);
  });
});

describe('提醒', () => {
  it('相对截止提醒随截止日期调整，清除截止日期时取消', () => {
    const b = bench();
    b.create('s', null, { dueDate: '2026-11-20' });
    b.run({
      type: 'setReminder',
      id: 's',
      expectedRevision: b.rev('s'),
      reminder: { kind: 'beforeDue', daysBefore: 1, time: '09:00', utcOffsetMinutes: 480 }
    });
    expect(b.get('s').reminder?.dueAt).toBe('2026-11-19T01:00:00.000Z');
    b.run({ type: 'update', id: 's', expectedRevision: b.rev('s'), patch: { dueDate: '2026-11-25' } });
    expect(b.get('s').reminder?.dueAt).toBe('2026-11-24T01:00:00.000Z');
    b.run({ type: 'update', id: 's', expectedRevision: b.rev('s'), patch: { dueDate: null } });
    expect(b.get('s').reminder?.state).toBe('cancelled');
  });

  it('到期在宽限期内投递，超过宽限期视为错过；确认投递是幂等的', () => {
    const b = bench();
    b.create('s', null);
    b.run({
      type: 'setReminder',
      id: 's',
      expectedRevision: b.rev('s'),
      reminder: { kind: 'fixed', at: '2026-11-10T01:00:00+08:00' }
    });
    const dueAt = b.get('s').reminder!.dueAt;
    expect(remindersToDeliver(b.all(), '2026-11-09T17:05:00.000Z').map(todo => todo.id)).toEqual(['s']);
    expect(remindersMissed(b.all(), '2026-11-09T17:20:00.000Z').map(todo => todo.id)).toEqual(['s']);
    b.run({ type: 'ackReminder', id: 's', dueAt, outcome: 'fired' });
    expect(b.run({ type: 'ackReminder', id: 's', dueAt, outcome: 'fired' })).toEqual([]);
    expect(b.get('s').reminder?.state).toBe('fired');
  });

  it('相对截止提醒要求先有截止日期', () => {
    const b = bench();
    b.create('s', null);
    b.failsWith('TODO_INVALID_INPUT', () =>
      b.run({
        type: 'setReminder',
        id: 's',
        expectedRevision: b.rev('s'),
        reminder: { kind: 'beforeDue', daysBefore: 1, time: '09:00', utcOffsetMinutes: 480 }
      })
    );
  });
});

describe('集合不变量', () => {
  it('拒绝成环、已完成上级下的未完成项与局部归档', () => {
    const b = sampleProject();
    const todos = b.all();
    const cyc = todos.map(todo => (todo.id === 'm' ? { ...todo, kind: 'item' as const, parentId: 'loop' } : todo));
    expect(todoCollectionErrors(cyc).some(error => error.includes('成环'))).toBe(true);
    const doneParent = todos.map(todo =>
      todo.id === 'train' ? { ...todo, status: 'done' as const, completedAt: T0 } : todo
    );
    expect(todoCollectionErrors(doneParent).some(error => error.includes('已完成上级'))).toBe(true);
    const partial = todos.map(todo => (todo.id === 'data' ? { ...todo, archivedAt: T0 } : todo));
    expect(todoCollectionErrors(partial).some(error => error.includes('局部归档'))).toBe(true);
  });
});

describe('排序重平衡', () => {
  it('连续添加超过旧上限后仍保持合法顺序，归档记录不被重排', () => {
    const b = bench();
    b.create('archived', null);
    b.complete('archived');
    b.act('archive', 'archived');
    const archived = structuredClone(b.get('archived'));
    for (let i = 0; i < 450; i += 1) b.create(`todo-${i}`, null);
    const list = indexTodos(b.all())
      .children(null)
      .filter(todo => !todo.archivedAt);
    expect(list.map(todo => todo.id)).toEqual(Array.from({ length: 450 }, (_, i) => `todo-${i}`));
    expect(b.get('archived')).toEqual(archived);
  });

  it('同步产生同键后，可以在两节点间移动和新建', () => {
    const a = applyTodoCommand([], { type: 'create', id: 'a', parentId: null, title: 'a' }, { now: T0 }).changed[0]!;
    const b = { ...a, id: 'b' };
    let todos = [a, b];
    const run = (command: TodoCommand) => {
      todos = mergeTodoChanges(todos, applyTodoCommand(todos, command, { now: T0 }).changed);
      expect(todoCollectionErrors(todos)).toEqual([]);
    };
    run({ type: 'create', id: 'c', parentId: null, title: 'c' });
    run({ type: 'move', id: 'c', expectedRevision: 1, parentId: null, afterId: 'a' });
    expect(
      indexTodos(todos)
        .children(null)
        .map(todo => todo.id)
    ).toEqual(['a', 'c', 'b']);
    run({ type: 'create', id: 'd', parentId: null, title: 'd', afterId: 'a' });
    expect(
      indexTodos(todos)
        .children(null)
        .map(todo => todo.id)
    ).toEqual(['a', 'd', 'c', 'b']);
  });
});
