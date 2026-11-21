import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  applyTodoCommand,
  localDateOf,
  mergeTodoChanges,
  remindersToDeliver,
  type Todo,
  type TodoCommand
} from '@study-accelerator/web-core';
import { TodoReminderRunner } from './TodoReminderRunner';
import { TodosView } from './TodosView';
import { createTodoStore } from './todoStore';

afterEach(cleanup);
beforeEach(() => {
  try {
    window.localStorage.clear();
  } catch {
    /* 测试环境可能没有存储。 */
  }
});

const T0 = Date.parse('2026-11-09T01:00:00.000Z');

function fakeServer(seed: TodoCommand[]) {
  let todos: Todo[] = [];
  let clock = T0;
  const apply = (command: TodoCommand) => {
    clock += 1000;
    const { changed } = applyTodoCommand(todos, command, { now: new Date(clock).toISOString() });
    todos = mergeTodoChanges(todos, changed);
    return changed;
  };
  seed.forEach(apply);
  const commands: TodoCommand[] = [];
  const requestJson = vi.fn(async (url: string, options: { body?: string } = {}) => {
    if (url === '/api/todos') return { data: { todos: todos.filter(todo => !todo.deletedAt) } };
    const { command } = JSON.parse(options.body ?? '{}') as { command: TodoCommand };
    commands.push(command);
    return { data: { changed: apply(command) } };
  });
  return { store: createTodoStore(requestJson as never), commands, todos: () => todos, requestJson };
}

const withReminder = (at: string, id = 'r'): TodoCommand[] => [
  { type: 'create', id, parentId: null, title: '交实验报告' },
  { type: 'setReminder', id, expectedRevision: 1, reminder: { kind: 'fixed', at } }
];

describe('提醒投递', () => {
  it('首条回写耗时 11 分钟时，30 秒后到期的另一条仍按时投递', async () => {
    const aDue = '2026-11-09T02:00:00.000Z';
    const bDue = '2026-11-09T02:00:30.000Z';
    vi.useFakeTimers({ now: Date.parse(aDue) });
    try {
      const server = fakeServer([...withReminder(aDue, 'a'), ...withReminder(bDue, 'b')]);
      const execute = server.store.execute;
      vi.spyOn(server.store, 'execute').mockImplementationOnce(async command => {
        await new Promise(resolve => setTimeout(resolve, 11 * 60_000));
        return execute(command);
      });
      const notify = vi.fn(async (_todo: Todo) => true);
      render(<TodoReminderRunner store={server.store} notify={notify} />);
      await act(() => vi.advanceTimersByTimeAsync(30_000));
      expect(notify.mock.calls.map(([todo]) => todo.id)).toEqual(['a', 'b']);
      expect(server.commands).toEqual([{ type: 'ackReminder', id: 'b', dueAt: bDue, outcome: 'fired' }]);
      await act(() => vi.advanceTimersByTimeAsync(11 * 60_000));
      expect(notify).toHaveBeenCalledTimes(2);
      expect(server.commands).toEqual([
        { type: 'ackReminder', id: 'b', dueAt: bDue, outcome: 'fired' },
        { type: 'ackReminder', id: 'a', dueAt: aDue, outcome: 'fired' }
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('回写失败后即使超过宽限期，仍只补写已提醒', async () => {
    const at = '2026-11-09T02:00:00.000Z';
    vi.useFakeTimers({ now: Date.parse(at) });
    try {
      const server = fakeServer(withReminder(at));
      const ack = vi.spyOn(server.store, 'execute').mockRejectedValueOnce(new Error('暂时离线'));
      const notify = vi.fn(async () => true);
      render(<TodoReminderRunner store={server.store} notify={notify} />);
      await act(() => vi.advanceTimersByTimeAsync(0));
      expect(ack).toHaveBeenCalledTimes(1);
      vi.setSystemTime(Date.parse(at) + 11 * 60_000);
      await act(() => vi.advanceTimersByTimeAsync(30_000));
      expect(notify).toHaveBeenCalledTimes(1);
      expect(server.commands).toEqual([{ type: 'ackReminder', id: 'r', dueAt: at, outcome: 'fired' }]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('首次加载跨过轮询间隔且首条回写延迟时，每条到期提醒只投递一次', async () => {
    vi.useFakeTimers();
    try {
      const at = '2026-11-09T02:00:00.000Z';
      const server = fakeServer([...withReminder(at, 'a'), ...withReminder(at, 'b')]);
      let finishLoad!: () => void;
      const loading = new Promise<void>(resolve => {
        finishLoad = resolve;
      });
      server.requestJson.mockImplementationOnce(async () => {
        await loading;
        return { data: { todos: server.todos() } };
      });
      const firstLoad = server.store.load();
      let finishAck!: () => void;
      const ack = new Promise<void>(resolve => {
        finishAck = resolve;
      });
      const execute = server.store.execute;
      vi.spyOn(server.store, 'execute').mockImplementationOnce(async command => {
        await ack;
        return execute(command);
      });
      const notify = vi.fn(async (_todo: Todo) => true);
      render(<TodoReminderRunner store={server.store} notify={notify} now={() => at} />);
      await act(() => vi.advanceTimersByTimeAsync(30_001));
      await act(async () => {
        finishLoad();
        await firstLoad;
      });
      await act(async () => {
        finishAck();
      });
      await act(() => vi.advanceTimersByTimeAsync(30_000));
      expect(notify.mock.calls.map(([todo]) => todo.id)).toEqual(['a', 'b']);
      expect(server.commands.map(command => command.id).sort()).toEqual(['a', 'b']);
    } finally {
      vi.useRealTimers();
    }
  });

  it('到点交给系统通知并回写已提醒，同一设备不重复投递', async () => {
    const server = fakeServer(withReminder('2026-11-09T02:00:00.000Z'));
    const notify = vi.fn(async () => true);
    const now = () => '2026-11-09T02:03:00.000Z';
    const { unmount } = render(<TodoReminderRunner store={server.store} notify={notify} now={now} />);
    await waitFor(() =>
      expect(server.commands).toEqual([
        { type: 'ackReminder', id: 'r', dueAt: '2026-11-09T02:00:00.000Z', outcome: 'fired' }
      ])
    );
    expect(notify).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('alert')).toBeNull();
    unmount();
    expect(remindersToDeliver(server.todos(), now())).toEqual([]);
  });

  it('系统通知不可用时在应用内弹出提醒卡', async () => {
    const server = fakeServer(withReminder('2026-11-09T02:00:00.000Z'));
    render(
      <TodoReminderRunner store={server.store} notify={async () => false} now={() => '2026-11-09T02:01:00.000Z'} />
    );
    const card = await screen.findByRole('alert');
    expect(within(card).getByText('交实验报告')).toBeInTheDocument();
  });

  it('应用关闭期间到期的提醒标为错过，不补发', async () => {
    const server = fakeServer(withReminder('2026-11-09T02:00:00.000Z'));
    const notify = vi.fn(async () => true);
    render(<TodoReminderRunner store={server.store} notify={notify} now={() => '2026-11-09T05:00:00.000Z'} />);
    await waitFor(() => expect(server.commands[0]).toMatchObject({ type: 'ackReminder', outcome: 'missed' }));
    expect(notify).not.toHaveBeenCalled();
  });

  it('暂停中的事项不提醒', async () => {
    const server = fakeServer([
      ...withReminder('2026-11-09T02:00:00.000Z'),
      { type: 'pause', id: 'r', expectedRevision: 2 }
    ]);
    const notify = vi.fn(async () => true);
    render(<TodoReminderRunner store={server.store} notify={notify} now={() => '2026-11-09T02:01:00.000Z'} />);
    await waitFor(() => expect(server.store.getState().status).toBe('ready'));
    expect(notify).not.toHaveBeenCalled();
    expect(server.commands).toEqual([]);
  });
});

describe('提醒设置', () => {
  it('在详情卡里按截止日期设置提醒，截止日期变化时提醒跟随', async () => {
    const today = localDateOf(new Date());
    const server = fakeServer([
      { type: 'create', id: 's', parentId: null, title: '交材料', plannedDate: today, dueDate: '2099-01-10' }
    ]);
    const user = userEvent.setup();
    render(<TodosView pathname="/learning" store={server.store} />);
    await user.click(await screen.findByRole('button', { name: '打开「交材料」详情' }));
    await user.click(await screen.findByRole('switch', { name: '启用提醒' }));
    await user.click(await screen.findByRole('button', { name: '设置提醒' }));
    const dialog = await screen.findByRole('dialog', { name: '设置提醒' });
    expect(within(dialog).getByRole('button', { name: '相对截止' })).toHaveAttribute('aria-pressed', 'true');
    await user.click(within(dialog).getByRole('button', { name: '保存' }));
    await waitFor(() =>
      expect(server.commands.at(-1)).toMatchObject({
        type: 'setReminder',
        reminder: { kind: 'beforeDue', daysBefore: 1, time: '09:00' }
      })
    );
    expect(await screen.findByRole('button', { name: /提醒：截止前 1 天 09:00/ })).toBeInTheDocument();
    const reminder = server.todos()[0]!.reminder!;
    expect(reminder.state).toBe('pending');
    await act(async () => {
      await server.store.execute({
        type: 'update',
        id: 's',
        expectedRevision: server.todos()[0]!.revision,
        patch: { dueDate: '2099-01-11' }
      });
    });
    const updated = server.todos()[0]!.reminder!;
    expect(Date.parse(updated.dueAt) - Date.parse(reminder.dueAt)).toBe(86_400_000);
  });
});
