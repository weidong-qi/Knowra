import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  applyTodoCommand,
  localDateOf,
  mergeTodoChanges,
  type Todo,
  type TodoCommand
} from '@study-accelerator/web-core';
import { TodoReminderRunner, planReminders } from './TodoReminderRunner';
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
  return { store: createTodoStore(requestJson as never), commands, todos: () => todos };
}

const withReminder = (at: string): TodoCommand[] => [
  { type: 'create', id: 'r', parentId: null, title: '交实验报告' },
  { type: 'setReminder', id: 'r', expectedRevision: 1, reminder: { kind: 'fixed', at } }
];

describe('提醒投递', () => {
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
    expect(planReminders(server.todos(), now(), { has: () => false }).deliver).toEqual([]);
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
    expect(reminder.kind === 'beforeDue' && reminder.dueAt).toBeTruthy();
  });
});
