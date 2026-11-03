import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEmptyWorkspaceSnapshot, type Note, type NoteQueryPage, type WorkspaceApi } from '@study-accelerator/web-core';
import { AppStoreProvider } from '../../store/AppStoreProvider';
import { createAppStore } from '../../store/createAppStore';
import { NotesIndexView } from './NotesIndexView';

const title = '规划草案';
const fixtureNow = new Date(2026, 0, 15, 12).getTime();
const createNote = (id: string, overrides: Partial<Note> = {}): Note => ({
  id, title: id === 'note-1' ? title : id, folderId: null, tagIds: [], internalLinks: [], rawMarkdown: '',
  contentLoaded: false, favorite: false, deleted: false, status: 'draft', updatedAt: new Date(fixtureNow - 1_000).toISOString(), ...overrides
});

async function setup(options: { notes?: Note[]; readOnly?: boolean; view?: 'list' | 'grid' } = {}) {
  const api = createApi();
  const store = createAppStore({ api, cacheKey: 'notes-redesign-test', mockSnapshot: createEmptyWorkspaceSnapshot() });
  const folder = { id: 'folder-1', name: '设计资料', parentId: null, children: [] };
  const notes = options.notes ?? [createNote('note-1', { folderId: folder.id, summary: '索引改版真实摘要' }), createNote('note-2', { title: '已发布资料', status: 'published' })];
  store.setState({ dataMode: options.readOnly ? 'cache' : 'api', workspaceLoadState: 'ready', serverData: {
    spaces: [{ id: 'space-1' }], currentSpaceId: 'space-1', folderTree: [folder], foldersById: { [folder.id]: folder }, notes, tags: [], tagGroups: []
  } });
  vi.mocked(api.queryNotes).mockImplementation(async input => {
    let found = notes.filter(note => input.deletedOnly ? note.deleted : !note.deleted);
    if (input.folderId) found = found.filter(note => note.folderId === input.folderId);
    if (input.favoriteOnly) found = found.filter(note => note.favorite);
    if (input.query) found = found.filter(note => note.title.includes(input.query!));
    found = [...found].sort((a, b) => input.sortBy === 'title' ? a.title.localeCompare(b.title, 'zh-CN') : Date.parse(a.updatedAt!) - Date.parse(b.updatedAt!));
    if (input.order === 'desc') found.reverse();
    const offset = input.offset ?? 0;
    const end = offset + (input.limit ?? 30);
    return { items: found.slice(offset, end), hasNext: end < found.length };
  });
  const onOpenNote = vi.fn();
  const view = render(<AppStoreProvider store={store} dependencies={{ api, cacheKey: 'notes-redesign-test', mockSnapshot: createEmptyWorkspaceSnapshot() }}><NotesIndexView path={[]} onOpenNote={onOpenNote} /></AppStoreProvider>);
  await vi.waitFor(() => expect(screen.queryByText('正在从服务端加载筛选结果…')).not.toBeInTheDocument());
  if (options.view !== 'grid') await userEvent.click(screen.getByRole('button', { name: '列表视图' }));
  return { ...view, api, store, onOpenNote, user: userEvent.setup() };
}

async function chooseType(user: ReturnType<typeof userEvent.setup>, label: string) {
  await user.click(screen.getByRole('button', { name: '显示选项（布局、分组、排序、属性）' }));
  const dialog = screen.getByRole('dialog', { name: '索引显示选项' });
  await user.click(within(within(dialog).getByRole('group', { name: '类型' })).getByRole('button', { name: new RegExp(`^${label}`) }));
  await user.keyboard('{Escape}');
}

async function chooseGroup(user: ReturnType<typeof userEvent.setup>, label: string) {
  await user.click(screen.getByRole('button', { name: '显示选项（布局、分组、排序、属性）' }));
  const dialog = screen.getByRole('dialog', { name: '索引显示选项' });
  await user.click(within(within(dialog).getByRole('group', { name: '分组' })).getByRole('button', { name: label === '更新时间' ? '时间' : label }));
  await user.keyboard('{Escape}');
}

describe('笔记索引新版真实交互', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(fixtureNow);
  });
  afterEach(() => vi.useRealTimers());

  it('三种视图读取同一数据并保留笔记打开行为', async () => {
    const { user, onOpenNote } = await setup({ view: 'grid' });
    expect(screen.getByRole('button', { name: '图标视图' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getAllByLabelText('笔记图标视图').length).toBeGreaterThan(0);
    await user.click(screen.getByRole('button', { name: '卡片视图' }));
    expect(screen.getAllByLabelText('笔记卡片视图').length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: '卡片视图' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('索引改版真实摘要')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '列表视图' }));
    await user.click(screen.getByRole('button', { name: title }));
    expect(onOpenNote).toHaveBeenCalledExactlyOnceWith('note-1');
  });

  it('真实分组可折叠和展开，切换分组清除旧折叠状态', async () => {
    const { user } = await setup();
    const today = screen.getByRole('button', { name: /^今天/ });
    await user.click(today);
    expect(today).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('button', { name: title })).not.toBeInTheDocument();
    await user.click(today);
    expect(screen.getByRole('button', { name: title })).toBeInTheDocument();
    await chooseGroup(user, '状态');
    expect(screen.getByRole('button', { name: /^草稿/ })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('button', { name: /^已发布\s*1$/ })).toBeInTheDocument();
    await chooseGroup(user, '不分组');
    expect(screen.queryByRole('button', { name: /^今天/ })).not.toBeInTheDocument();
    expect(screen.getAllByRole('table')).toHaveLength(1);
  });

  it('状态与时间只筛选已加载项目，空结果仍可用原始游标加载后续命中项', async () => {
    const notes = Array.from({ length: 35 }, (_, index) => createNote(`paged-${index}`, {
      status: index === 34 ? 'draft' : 'active', title: index === 34 ? '后续批次草稿' : `进行中 ${index}`,
      updatedAt: new Date(fixtureNow - (index + 1) * 1_000).toISOString()
    }));
    const { user, api } = await setup({ notes });
    await user.click(screen.getByRole('button', { name: '筛选' }));
    await user.click(screen.getByRole('menuitem', { name: /状态/ }));
    expect(screen.getByText('状态筛选仅作用于已加载笔记。')).toBeInTheDocument();
    await user.click(screen.getByRole('menuitemcheckbox', { name: /草稿/ }));
    await user.click(screen.getByRole('menuitem', { name: '返回' }));
    await user.click(screen.getByRole('menuitem', { name: /更新时间/ }));
    await user.click(screen.getByRole('menuitemradio', { name: '今天' }));
    await user.keyboard('{Escape}');
    expect(screen.getByRole('group', { name: '已启用的筛选' })).toHaveTextContent('状态与时间仅筛选已加载笔记，可在底部加载更多');
    expect(screen.getByText('没有符合当前条件的结果')).toBeInTheDocument();
    expect(api.queryNotes).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole('button', { name: '加载更多' }));
    await vi.waitFor(() => expect(api.queryNotes).toHaveBeenLastCalledWith(expect.objectContaining({ offset: 30, limit: 30 })));
    expect(await screen.findByRole('button', { name: '后续批次草稿' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '设计资料' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '加载更多' })).not.toBeInTheDocument();
  });

  it('预览选择不提前导航，关闭和再次打开不会触发笔记操作', async () => {
    const { user, onOpenNote, api } = await setup();
    await user.click(screen.getByRole('button', { name: '预览栏' }));
    expect(screen.getByText('选择一项以预览')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: title }));
    const preview = screen.getByRole('complementary', { name: '笔记预览' });
    expect(within(preview).getByRole('heading', { name: title })).toBeInTheDocument();
    expect(onOpenNote).not.toHaveBeenCalled();
    expect(api.getNote).not.toHaveBeenCalled();
    await user.click(within(preview).getByRole('button', { name: '关闭预览栏' }));
    expect(screen.queryByRole('complementary', { name: '笔记预览' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '预览栏' }));
    await user.click(screen.getByRole('button', { name: title }));
    await user.click(screen.getByRole('button', { name: '打开笔记' }));
    expect(onOpenNote).toHaveBeenCalledExactlyOnceWith('note-1');
    expect(api.updateNote).not.toHaveBeenCalled();
  });

  it('预览在筛选改变后清除旧选择，不留下不可见笔记的打开入口', async () => {
    const { user, store, onOpenNote } = await setup();
    await user.click(screen.getByRole('button', { name: '预览栏' }));
    await user.click(screen.getByRole('button', { name: title }));
    act(() => store.getState().setNotesQuery('不存在的查询'));
    expect(screen.queryByRole('button', { name: '打开笔记' })).not.toBeInTheDocument();
    expect(screen.getByText('选择一项以预览')).toBeInTheDocument();
    expect(onOpenNote).not.toHaveBeenCalled();
  });

  it('缓存只读下禁止新建、导入、批量和行内写入，仍能预览', async () => {
    const { user, api } = await setup({ readOnly: true });
    expect(screen.getByRole('button', { name: '新建' })).toBeDisabled();
    expect(screen.getByRole('button', { name: title })).toHaveAttribute('draggable', 'false');
    await user.click(screen.getByRole('button', { name: '更多操作' }));
    expect(screen.getByRole('menuitem', { name: '批量管理' })).toHaveAttribute('aria-disabled', 'true');
    await user.keyboard('{Escape}');
    await user.click(screen.getByRole('button', { name: `${title}的笔记操作` }));
    expect(screen.getByRole('menuitem', { name: '删除' })).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByRole('menuitem', { name: '重命名' })).toHaveAttribute('aria-disabled', 'true');
    await user.keyboard('{Escape}');
    await user.click(screen.getByRole('button', { name: '预览栏' }));
    await user.click(screen.getByRole('button', { name: title }));
    expect(screen.getByRole('button', { name: '打开笔记' })).toBeInTheDocument();
    expect(api.createNote).not.toHaveBeenCalled();
    expect(api.importMarkdownNotes).not.toHaveBeenCalled();
    expect(api.deleteNote).not.toHaveBeenCalled();
  });

  it('恶意标题和摘要保持纯文本，卡片与预览不创建脚本、图片或可执行链接', async () => {
    const maliciousTitle = '<img src=x onerror="window.compromised=1">';
    const summary = '<script>window.compromised=1</script><a href="javascript:alert(1)">摘要</a>';
    const { user, container, onOpenNote } = await setup({ notes: [createNote('note-1', { title: maliciousTitle, summary })] });
    expect(screen.getByRole('button', { name: maliciousTitle })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '卡片视图' }));
    expect(container.querySelector('script, img, a[href^="javascript:"]')).toBeNull();
    await user.click(screen.getByRole('button', { name: '列表视图' }));
    await user.click(screen.getByRole('button', { name: '预览栏' }));
    await user.click(screen.getByRole('button', { name: maliciousTitle }));
    const preview = screen.getByRole('complementary', { name: '笔记预览' });
    expect(within(preview).getByText(summary)).toBeInTheDocument();
    expect(preview.querySelector('script, img, a[href^="javascript:"]')).toBeNull();
    expect(onOpenNote).not.toHaveBeenCalled();
  });

  it('跨页先按完整状态分组，折叠后重排分页且全部折叠仍保留标题', async () => {
    const notes = Array.from({ length: 40 }, (_, index) => createNote(`grouped-${index}`, { status: index % 2 ? 'active' : 'draft' }));
    const { user } = await setup({ notes, readOnly: true });
    await chooseType(user, '笔记');
    await chooseGroup(user, '状态');
    expect(screen.getByRole('button', { name: /^草稿\s*20$/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^进行中\s*20$/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '第 2 页' }));
    expect(screen.getByRole('button', { name: /^进行中\s*20$/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^草稿\s*20$/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '第 1 页' }));
    await user.click(screen.getByRole('button', { name: /^草稿\s*20$/ }));
    expect(screen.getByRole('button', { name: /^草稿\s*20$/ })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByRole('button', { name: /^进行中\s*20$/ })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getAllByRole('table')).toHaveLength(1);
    expect(within(screen.getByRole('table')).getAllByRole('row')).toHaveLength(20);
    await user.click(screen.getByRole('button', { name: /^进行中\s*20$/ }));
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^草稿\s*20$/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^进行中\s*20$/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '第 2 页' })).not.toBeInTheDocument();
    expect(screen.queryByText('没有符合当前条件的结果')).not.toBeInTheDocument();
  });

  it('末页折叠到单页后重新展开仍停留第1页，不恢复过期页码', async () => {
    // 默认按更新时间降序，让 collapse-0 明确位于首页，不依赖生成夹具时的毫秒差。
    const notes = Array.from({ length: 40 }, (_, index) => createNote(`collapse-${index}`, {
      updatedAt: new Date(fixtureNow - (index + 1) * 1_000).toISOString()
    }));
    const { user } = await setup({ notes, readOnly: true });
    await chooseType(user, '笔记');
    await chooseGroup(user, '状态');
    await user.click(screen.getByRole('button', { name: '第 2 页' }));
    expect(screen.getByRole('button', { name: '第 2 页' })).toHaveAttribute('aria-current', 'page');
    await user.click(screen.getByRole('button', { name: /^草稿\s*40$/ }));
    expect(screen.getByRole('button', { name: '第 1 页' })).toHaveAttribute('aria-current', 'page');
    expect(screen.queryByRole('button', { name: '第 2 页' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /^草稿\s*40$/ }));
    expect(screen.getByRole('button', { name: '第 1 页' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('button', { name: '第 2 页' })).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('button', { name: 'collapse-0' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'collapse-39' })).not.toBeInTheDocument();
  });

  it.each(['search', 'folder'] as const)('丢弃加载更多期间发生%s切换后的旧分页响应', async change => {
    const notes = [
      ...Array.from({ length: 35 }, (_, index) => createNote(`old-${index}`, { updatedAt: new Date(fixtureNow - (index + 1) * 1_000).toISOString() })),
      createNote('current', { title: '当前结果', folderId: 'folder-1', updatedAt: new Date(fixtureNow - 60_000).toISOString() })
    ];
    const { user, api, store } = await setup({ notes });
    let finish!: (page: NoteQueryPage) => void;
    const pending = new Promise<NoteQueryPage>(resolve => { finish = resolve; });
    vi.mocked(api.queryNotes).mockImplementationOnce(() => pending);
    await user.click(screen.getByRole('button', { name: '加载更多' }));
    expect(api.queryNotes).toHaveBeenLastCalledWith(expect.objectContaining({ offset: 30 }));
    act(() => {
      if (change === 'search') store.getState().setNotesQuery('当前结果');
      else store.getState().selectNotesFolder('folder-1');
    });
    await vi.waitFor(() => expect(api.queryNotes).toHaveBeenLastCalledWith(expect.objectContaining({
      offset: 0, ...(change === 'search' ? { query: '当前结果' } : { folderId: 'folder-1' })
    })));
    expect(await screen.findByRole('button', { name: '当前结果' })).toBeInTheDocument();
    await act(async () => {
      finish({ items: [createNote('stale', { title: '旧分页迟到笔记', folderId: 'folder-1' })], hasNext: true });
      await pending;
    });
    expect(screen.queryByRole('button', { name: '旧分页迟到笔记' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '当前结果' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '加载更多' })).not.toBeInTheDocument();
  });

  it('列表快捷键：J/K 移动焦点，X 选择，Space 预览而不是打开', async () => {
    const { user, onOpenNote } = await setup();
    const rows = Array.from(document.querySelectorAll<HTMLElement>('[data-entry-item]'));
    const focusables = rows.map(row => row.querySelector<HTMLElement>('button')!);
    const noteIndex = rows.findIndex(row => row.dataset.kind === 'note');
    expect(rows.length).toBeGreaterThan(1);
    focusables[noteIndex].focus();
    await user.keyboard('j');
    expect(focusables[noteIndex + 1] ?? focusables[noteIndex]).toHaveFocus();
    await user.keyboard('k');
    expect(focusables[noteIndex]).toHaveFocus();
    await user.keyboard('x');
    expect(screen.getAllByRole('checkbox', { checked: true })).toHaveLength(1);
    await user.keyboard(' ');
    expect(onOpenNote).not.toHaveBeenCalled();
    expect(screen.getByRole('complementary', { name: '笔记预览' })).toBeInTheDocument();
    await user.keyboard('{Enter}');
    expect(onOpenNote).toHaveBeenCalledTimes(1);
  });

  it.each(['list', 'grid', 'card'] as const)('附属菜单按钮保留 Space 激活（%s）', async view => {
    const { user } = await setup({ view: view === 'card' ? 'grid' : view });
    if (view === 'card') await user.click(screen.getByRole('button', { name: '卡片视图' }));
    const trigger = document.querySelector<HTMLButtonElement>('[data-index-item-menu-trigger]')!;
    trigger.focus();
    await user.keyboard(' ');
    expect(screen.getByRole('menu')).toBeInTheDocument();
    expect(screen.queryByRole('complementary', { name: '笔记预览' })).not.toBeInTheDocument();
  });

  it('触屏紧凑工具通过显示选项开启预览', async () => {
    const original = window.matchMedia;
    window.matchMedia = vi.fn(query => ({ matches: query.includes('coarse'), media: query, onchange: null,
      addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn() })) as typeof window.matchMedia;
    try {
      const { user } = await setup({ view: 'grid' });
      await user.click(screen.getByRole('button', { name: '显示选项（布局、分组、排序、属性）' }));
      await user.click(screen.getByRole('switch', { name: '预览栏' }));
      await user.keyboard('{Escape}');
      expect(screen.getByRole('complementary', { name: '笔记预览' })).toBeInTheDocument();
    } finally { window.matchMedia = original; }
  });

  it('名称降序使用服务端排序，不只倒序当前页', async () => {
    const { user, api } = await setup();
    await user.click(screen.getByRole('button', { name: '显示选项（布局、分组、排序、属性）' }));
    const sort = within(screen.getByRole('group', { name: '排序' }));
    await user.click(sort.getByRole('button', { name: '名称' }));
    await user.click(sort.getByRole('button', { name: /名称/ }));
    await vi.waitFor(() => expect(api.queryNotes).toHaveBeenLastCalledWith(expect.objectContaining({ sortBy: 'title', order: 'desc', offset: 0 })));
  });
});

function createApi(): WorkspaceApi {
  return {
    listKnowledgeSpaces: vi.fn().mockResolvedValue([{ id: 'space-1' }]),
    createDefaultKnowledgeSpace: vi.fn().mockResolvedValue({ id: 'space-1' }),
    loadWorkspaceResources: vi.fn().mockResolvedValue({ folderTree: [], notes: [], tags: [], tagGroups: [] }),
    searchNoteIds: vi.fn().mockResolvedValue([]),
    createNote: vi.fn(),
    importMarkdownNotes: vi.fn(),
    getNote: vi.fn(),
    createFolder: vi.fn(),
    updateNote: vi.fn(),
    deleteNote: vi.fn(),
    restoreNote: vi.fn(),
    permanentlyDeleteNote: vi.fn(),
    setNoteFavorite: vi.fn(),
    setNoteTags: vi.fn(),
    createTag: vi.fn(), updateTag: vi.fn(), deleteTag: vi.fn(), mergeTags: vi.fn(), reorderTags: vi.fn(),
    createTagGroup: vi.fn(), updateTagGroup: vi.fn(), deleteTagGroup: vi.fn(),
    deleteNotes: vi.fn().mockResolvedValue([]),
    assignTagToNotes: vi.fn().mockResolvedValue([]),
    updateTagsForNotes: vi.fn().mockResolvedValue([]),
    queryNotes: vi.fn().mockResolvedValue({ items: [], hasNext: false }),
    getLinkedNotes: vi.fn().mockResolvedValue([]),
    listAnnotations: vi.fn().mockResolvedValue([]),
    createAnnotation: vi.fn(),
    deleteAnnotation: vi.fn(),
    restoreAnnotation: vi.fn(),
    updateAnnotationAnchor: vi.fn(),
    listNoteVersions: vi.fn().mockResolvedValue([]),
    getNoteVersion: vi.fn(),
    listNoteAttachments: vi.fn().mockResolvedValue([]),
    uploadNoteAttachment: vi.fn(),
    renameNoteAttachment: vi.fn(),
    inspectAttachmentDeletion: vi.fn().mockResolvedValue({ asset: { type: 'attachment', id: 'attachment-1' }, decision: 'can-purge-no-history', references: [], reasonCodes: [], coverage: { persistedCurrentAndHistory: true } }),
    verifyNoteAttachment: vi.fn(),
    restoreNoteAttachment: vi.fn(),
    listAttachmentCleanup: vi.fn().mockResolvedValue({ items: [], pending: 0 }),
    retryAttachmentCleanup: vi.fn().mockResolvedValue({ completed: 0, pending: 0 }),
    deleteNoteAttachment: vi.fn(),
    updateFolder: vi.fn(),
    deleteFolder: vi.fn(),
    emptyRecycleBin: vi.fn()
  };
}
