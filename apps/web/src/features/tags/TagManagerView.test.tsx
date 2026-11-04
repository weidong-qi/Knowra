import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TagManagerView } from './TagManagerView';

const mocked = vi.hoisted(() => ({ state: {} as Record<string, unknown> }));
vi.mock('../../store/AppStoreProvider', () => ({ useAppStore: (selector: (state: Record<string, unknown>) => unknown) => selector(mocked.state) }));
vi.mock('../../app/router', () => ({ useNavigate: () => vi.fn() }));

beforeEach(() => {
  mocked.state = {
    serverData: {
      tags: [{ id: 'tag-1', name: '测试标签', color: 'blue', groupId: 'group-1', sortOrder: 0, isSystem: false }],
      tagGroups: [{ id: 'group-1', name: '普通标签', sortOrder: 0, selectionMode: 'multiple', isSystem: false }],
      notes: []
    },
    canWriteWorkspace: () => true,
    createTag: vi.fn(), updateTag: vi.fn(), deleteTag: vi.fn().mockResolvedValue(undefined), mergeTags: vi.fn(), reorderTags: vi.fn(),
    createTagGroup: vi.fn(), updateTagGroup: vi.fn(), deleteTagGroup: vi.fn()
  };
});
afterEach(() => { vi.useRealTimers(); });

describe('TagManagerView 标签删除', () => {
  it('确认后先提供撤销窗口，撤销不向服务端发送删除', async () => {
    const user = userEvent.setup();
    render(<TagManagerView />);
    await user.click(screen.getByRole('button', { name: /的更多操作$/ }));
    await user.click(screen.getByRole('menuitem', { name: '删除…' }));
    await user.click(screen.getByRole('button', { name: '删除标签' }));
    expect(screen.getByRole('button', { name: '撤销删除' })).toBeInTheDocument();
    expect(mocked.state.deleteTag).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: '撤销删除' }));
    vi.useFakeTimers();
    act(() => { vi.advanceTimersByTime(11000); });
    expect(mocked.state.deleteTag).not.toHaveBeenCalled();
    expect(screen.getByText('测试标签')).toBeInTheDocument();
  });
});

describe('TagManagerView 标签使用统计', () => {
  function setUsageData() {
    const tags = [
      { id: 'tag-zero', name: '未使用' },
      { id: 'tag-repeated', name: '重复引用' },
      { id: 'tag-popular', name: '常用' },
      { id: 'tag-deleted', name: '仅回收站' },
      { id: 'tag-tied', name: '相同用量' }
    ].map((tag, sortOrder) => ({ ...tag, groupId: 'group-1', sortOrder, isSystem: false }));
    const data = {
      tags,
      tagGroups: [{ id: 'group-1', name: '普通标签', sortOrder: 0, selectionMode: 'multiple', isSystem: false }],
      notes: [
        { id: 'live-1', deleted: false, tagIds: ['tag-popular', 'tag-repeated', 'tag-repeated', 'tag-repeated', 'tag-tied'] },
        { id: 'live-2', deleted: false, tagIds: ['tag-popular'] },
        { id: 'deleted-1', deleted: true, tagIds: ['tag-repeated', 'tag-popular', 'tag-deleted'] },
        { id: 'deleted-2', deleted: true, tagIds: ['tag-deleted'] }
      ]
    };
    mocked.state.serverData = data;
    return data;
  }

  /* 筛选、使用情况与排序都在“筛选与排序”浮层里；先打开再操作，Esc 关闭。 */
  const openOptions = (user: ReturnType<typeof userEvent.setup>) => user.click(screen.getByRole('button', { name: '筛选与排序' }));
  const closeOptions = (user: ReturnType<typeof userEvent.setup>) => user.keyboard('{Escape}');

  it('仅按存活笔记去重计数，按使用量稳定排序并筛选全部零使用标签', async () => {
    const user = userEvent.setup();
    setUsageData();
    render(<TagManagerView />);
    for (const [name, count] of [['常用', 2], ['重复引用', 1], ['相同用量', 1], ['未使用', 0], ['仅回收站', 0]] as const) {
      expect(screen.getByText(name, { selector: 'article *' }).closest('article')).toHaveTextContent(`${count} 篇笔记`);
    }
    await openOptions(user);
    expect(screen.getByRole('button', { name: /未使用\s*2/ })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '按使用量' }));
    await closeOptions(user);
    const visibleNames = () => screen.getAllByRole('article').map((card) => within(card).getByText(/^(常用|重复引用|相同用量|未使用|仅回收站)$/).textContent);
    expect(visibleNames()).toEqual(['常用', '重复引用', '相同用量', '未使用', '仅回收站']);

    await openOptions(user);
    await user.click(screen.getByRole('button', { name: /未使用\s*2/ }));
    await closeOptions(user);
    expect(visibleNames()).toEqual(['未使用', '仅回收站']);
    expect(screen.getByText('显示 2 / 5 个标签')).toBeInTheDocument();
    expect(screen.getByText('1 个分组 · 2 个未使用')).toBeInTheDocument();

    await openOptions(user);
    await user.click(screen.getByRole('button', { name: /全部\s*5/ }));
    await closeOptions(user);
    expect(visibleNames()).toEqual(['常用', '重复引用', '相同用量', '未使用', '仅回收站']);
  });

  it('数据更新后同步未使用筛选、计数与删除影响提示', async () => {
    const user = userEvent.setup();
    const data = setUsageData();
    const view = render(<TagManagerView />);
    await openOptions(user);
    await user.click(screen.getByRole('button', { name: /未使用\s*2/ }));
    await closeOptions(user);

    mocked.state.serverData = { ...data, notes: [
      ...data.notes,
      { id: 'live-new', deleted: false, tagIds: ['tag-zero', 'tag-zero'] }
    ] };
    view.rerender(<TagManagerView />);
    expect(screen.getAllByRole('article')).toHaveLength(1);
    expect(screen.getByText('仅回收站')).toBeInTheDocument();
    expect(screen.queryByText('未使用', { selector: 'article *' })).not.toBeInTheDocument();
    expect(screen.getByText('显示 1 / 5 个标签')).toBeInTheDocument();
    await openOptions(user);
    expect(screen.getByRole('button', { name: /未使用\s*1/ })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /全部\s*5/ }));
    await closeOptions(user);
    const updatedCard = screen.getByText('未使用', { selector: 'article *' }).closest('article')!;
    expect(updatedCard).toHaveTextContent('1 篇笔记');
    await user.click(within(updatedCard).getByRole('button', { name: /的更多操作$/ }));
    await user.click(screen.getByRole('menuitem', { name: '删除…' }));
    expect(screen.getByRole('dialog', { name: '删除标签“未使用”？' })).toHaveTextContent('该标签被 1 篇笔记引用。');
    expect(screen.getByRole('button', { name: '移除 1 处引用并删除' })).toBeInTheDocument();
    expect(mocked.state.deleteTag).not.toHaveBeenCalled();
  });

  it('支持原型同名标签，删除弹窗目标离开标签列表后按零引用处理', async () => {
    const user = userEvent.setup();
    const data = setUsageData();
    const tags = [
      { id: '__proto__', name: '原型标签', groupId: 'group-1', sortOrder: 0 },
      { id: 'constructor', name: '构造标签', groupId: 'group-1', sortOrder: 1 }
    ];
    const notes = [
      { id: 'live-prototype-1', deleted: false, tagIds: ['__proto__', '__proto__', 'constructor'] },
      { id: 'live-prototype-2', deleted: false, tagIds: ['constructor'] },
      { id: 'deleted-prototype', deleted: true, tagIds: ['__proto__', 'constructor'] }
    ];
    mocked.state.serverData = { ...data, tags, notes };
    const view = render(<TagManagerView />);
    const prototypeCard = screen.getByText('原型标签').closest('article')!;
    expect(prototypeCard).toHaveTextContent('1 篇笔记');
    expect(screen.getByText('构造标签').closest('article')).toHaveTextContent('2 篇笔记');
    await openOptions(user);
    expect(screen.getByRole('button', { name: /未使用\s*0/ })).toBeInTheDocument();
    await closeOptions(user);

    await user.click(within(prototypeCard).getByRole('button', { name: /的更多操作$/ }));
    await user.click(screen.getByRole('menuitem', { name: '删除…' }));
    expect(screen.getByRole('dialog', { name: '删除标签“原型标签”？' })).toHaveTextContent('该标签被 1 篇笔记引用。');
    mocked.state.serverData = { ...data, tags: [], notes };
    view.rerender(<TagManagerView />);
    expect(screen.getByRole('dialog', { name: '删除标签“原型标签”？' })).toHaveTextContent('该标签尚未使用，可直接删除。');
    expect(screen.getByRole('button', { name: '删除标签' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /合并到/ })).not.toBeInTheDocument();
    expect(mocked.state.deleteTag).not.toHaveBeenCalled();
  });
});
