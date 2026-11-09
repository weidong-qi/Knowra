import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  applyTodoCommand,
  localDateOf,
  mergeTodoChanges,
  type Todo,
  type TodoCommand
} from '@study-accelerator/web-core';
import { TodosView, parseTodoRoute } from './TodosView';
import { createTodoStore } from './todoStore';
import { dueLabel, pageCounts, relativeDateLabel } from './todoPresentation';
import { addDaysToDate } from '../../components/ui/input/DatePicker';

afterEach(cleanup);

/** 内存里的假服务端：与真实服务端执行同一份共享规则。 */
function fakeServer(seed: TodoCommand[] = []) {
  let todos: Todo[] = [];
  let clock = Date.parse('2026-11-09T02:00:00.000Z');
  const apply = (command: TodoCommand) => {
    clock += 1000;
    const { changed } = applyTodoCommand(todos, command, { now: new Date(clock).toISOString() });
    todos = mergeTodoChanges(todos, changed);
    return changed;
  };
  seed.forEach(apply);
  const commands: TodoCommand[] = [];
  const requestJson = vi.fn(async (url: string, options: { method?: string; body?: string } = {}) => {
    if (url === '/api/todos') return { data: { todos: todos.filter(todo => !todo.deletedAt) } };
    const { command } = JSON.parse(options.body ?? '{}') as { command: TodoCommand };
    commands.push(command);
    return { data: { changed: apply(command) } };
  });
  return { store: createTodoStore(requestJson as never), commands, todos: () => todos };
}

const today = localDateOf(new Date());

describe('待办路由与展示', () => {
  it('解析四个入口与主线详情地址', () => {
    expect(parseTodoRoute('/learning')).toEqual({ page: 'today' });
    expect(parseTodoRoute('/learning/plan')).toEqual({ page: 'plan' });
    expect(parseTodoRoute('/learning/sidelines')).toEqual({ page: 'sidelines' });
    expect(parseTodoRoute('/learning/mainlines/m%201')).toEqual({ page: 'mainline', id: 'm 1' });
  });

  it('日期文案区分计划与截止：错过计划不称逾期，过截止才逾期', () => {
    expect(relativeDateLabel(today, today)).toBe('今天');
    expect(relativeDateLabel(addDaysToDate(today, 1), today)).toBe('明天');
    const base = { status: 'active', dueDate: addDaysToDate(today, -2) } as Todo;
    expect(dueLabel(base, today)).toBe('已逾期 2 天');
    expect(dueLabel({ ...base, dueDate: today }, today)).toBe('今天截止');
  });
});

describe('今天页面', () => {
  it('分组显示今日安排、之前未完成与截止提醒，并统计入口数量', async () => {
    const server = fakeServer([
      { type: 'create', id: 'a', parentId: null, title: '写周报', plannedDate: today },
      { type: 'create', id: 'b', parentId: null, title: '回邮件', plannedDate: addDaysToDate(today, -1) },
      { type: 'create', id: 'c', parentId: null, title: '续费服务器', dueDate: addDaysToDate(today, -1) }
    ]);
    render(<TodosView pathname="/learning" store={server.store} />);
    expect(await screen.findByText('写周报')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /今日安排/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /之前未完成/ })).toBeInTheDocument();
    expect(screen.getByText('截止提醒')).toBeInTheDocument();
    expect(screen.getByText('已逾期 1 天')).toBeInTheDocument();
    expect(pageCounts(server.todos(), today).today).toBe(3);
  });

  it('快速添加只填名称即可保存为今天的支线', async () => {
    const server = fakeServer();
    const user = userEvent.setup();
    render(<TodosView pathname="/learning" store={server.store} />);
    const input = await screen.findByRole('textbox', { name: '添加今天要做的事（作为支线）' });
    await user.type(input, '买牛奶{Enter}');
    await screen.findByText('买牛奶');
    expect(server.commands[0]).toMatchObject({ type: 'create', parentId: null, title: '买牛奶', plannedDate: today });
    expect(input).toHaveValue('');
  });

  it('父任务还有未完成步骤时先确认，选择全部完成后才提交', async () => {
    const server = fakeServer([
      { type: 'create', id: 's', parentId: null, title: '办理报销', plannedDate: today },
      { type: 'create', id: 's1', parentId: 's', title: '整理票据' }
    ]);
    const user = userEvent.setup();
    render(<TodosView pathname="/learning" store={server.store} />);
    await user.click(await screen.findByRole('checkbox', { name: '完成「办理报销」' }));
    const dialog = await screen.findByRole('dialog', { name: '还有未完成的步骤' });
    expect(server.commands).toEqual([]);
    await user.click(within(dialog).getByRole('button', { name: '全部标为完成' }));
    await waitFor(() => expect(server.commands[0]).toMatchObject({ type: 'complete', includeChildren: true }));
    expect(server.todos().find(todo => todo.id === 's1')?.status).toBe('done');
    expect(await screen.findByText('已完成「办理报销」')).toBeInTheDocument();
  });
});

describe('删除与撤销', () => {
  it('删除带步骤的支线前提示范围，撤销后整体恢复', async () => {
    const server = fakeServer([
      { type: 'create', id: 's', parentId: null, title: '办理报销' },
      { type: 'create', id: 's1', parentId: 's', title: '整理票据' }
    ]);
    const user = userEvent.setup();
    render(<TodosView pathname="/learning/sidelines" store={server.store} />);
    await user.click(await screen.findByRole('button', { name: '「办理报销」更多操作' }));
    await user.click(await screen.findByRole('menuitem', { name: '删除' }));
    const dialog = await screen.findByRole('dialog', { name: '删除「办理报销」' });
    expect(within(dialog).getByText(/连同它下面的 1 项/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: '删除' }));
    await waitFor(() => expect(screen.queryByText('办理报销')).toBeNull());
    await user.click(await screen.findByRole('button', { name: '撤销' }));
    expect(await screen.findByText('办理报销')).toBeInTheDocument();
    expect(server.commands.at(-1)).toEqual({ type: 'restore', id: 's' });
  });
});

describe('主线', () => {
  it('详情页按排序显示下一步，完成后顺延', async () => {
    const server = fakeServer([
      { type: 'create', id: 'm', parentId: null, kind: 'mainline', title: '完成分类项目', goal: '准确率 90%' },
      { type: 'create', id: 'm1', parentId: 'm', title: '准备数据' },
      { type: 'create', id: 'm2', parentId: 'm', title: '训练模型' }
    ]);
    const user = userEvent.setup();
    render(<TodosView pathname="/learning/mainlines/m" store={server.store} />);
    expect(await screen.findByText('准确率 90%')).toBeInTheDocument();
    const next = () => screen.getByText('下一步').parentElement!;
    expect(within(next()).getByText('准备数据')).toBeInTheDocument();
    await user.click(within(next()).getByRole('button', { name: '完成' }));
    await waitFor(() => expect(within(next()).getByText('训练模型')).toBeInTheDocument());
  });

  it('当前存储不支持待办时如实提示', async () => {
    const store = createTodoStore((async () => {
      const { ApiRequestError } = await import('@study-accelerator/web-core');
      throw new ApiRequestError('当前存储暂不支持个人待办', { status: 503, code: 'PERSONAL_TODOS_UNAVAILABLE' });
    }) as never);
    render(<TodosView pathname="/learning" store={store} />);
    expect(await screen.findByText(/请升级服务端后再试/)).toBeInTheDocument();
  });
});

it('后台刷新不覆盖期间已成功的命令，并合并随后读到的远端数据', async () => {
  let reads = 0;
  let finish!: (value: unknown) => void;
  const fresh = applyTodoCommand(
    [],
    { type: 'create', id: 'fresh', parentId: null, title: '新待办' },
    { now: new Date().toISOString() }
  ).changed;
  const store = createTodoStore((async (url: string) => {
    if (url === '/api/todos') {
      reads += 1;
      if (reads === 1) return { data: { todos: [] } };
      if (reads === 2)
        return new Promise(resolve => {
          finish = resolve;
        });
      return { data: { todos: fresh } };
    }
    return { data: { changed: fresh } };
  }) as never);
  await store.load();
  const refreshing = store.load();
  await store.execute({ type: 'create', id: 'fresh', parentId: null, title: '新待办' });
  finish({ data: { todos: [] } });
  await refreshing;
  expect(store.getState().todos.map(todo => todo.id)).toEqual(['fresh']);
  expect(reads).toBe(3);
});

it('折叠今日安排后保留截止警示，展开后同一事项仍只显示一次', async () => {
  const server = fakeServer([
    { type: 'create', id: 'due', parentId: null, title: '今日截止材料', plannedDate: today, dueDate: today }
  ]);
  const user = userEvent.setup();
  render(<TodosView pathname="/learning" store={server.store} />);
  expect(await screen.findByText('今天截止')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: /今日安排/ }));
  expect(screen.getByText('今天截止')).toBeInTheDocument();
  expect(screen.getByText('截止提醒')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: /今日安排/ }));
  expect(screen.getAllByText('今日截止材料')).toHaveLength(1);
  expect(screen.queryByText('截止提醒')).not.toBeInTheDocument();
});
