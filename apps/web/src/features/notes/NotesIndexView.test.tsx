import { fireEvent, render, screen, within, type RenderResult } from '@testing-library/react';
import { useState, type ReactNode } from 'react';
import { RouterContext } from '../../app/router';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { createEmptyWorkspaceSnapshot, type Tag, type WorkspaceApi } from '@study-accelerator/web-core';
import { AppShell } from '../../shell/AppShell';
import { AppStoreProvider } from '../../store/AppStoreProvider';
import { createAppStore } from '../../store/createAppStore';
import { NotesContextSidebar } from './NotesContextSidebar';
import { NotesIndexView } from './NotesIndexView';

describe('Notes index skeleton', () => {
  it('keeps one flat workspace title and a sibling context sidebar', () => {
    renderWithStore(
      <AppShell
        contextSidebar={<NotesContextSidebar />}
        activeDomain="materials"
        onSelectDomain={vi.fn()}
        onReturnHome={vi.fn()}
        statusbar={{ path: [{ id: 'home', label: '主页' }, { id: 'materials:root', label: '笔记库' }, { id: 'materials:index', label: '全部笔记', current: true }], dataMode: 'api' }}
      >
        <NotesIndexView path={[{ id: 'home', label: '主页' }, { id: 'materials:root', label: '笔记库', onNavigate: vi.fn() }, { id: 'materials:index', label: '全部笔记', current: true }]} />
      </AppShell>
    );

    expect(screen.getByRole('article', { name: '笔记索引' })).toBeInTheDocument();
    expect(screen.queryByText(/个文件夹/)).not.toBeInTheDocument();
    expect(screen.queryByText('INDEX / LIST')).not.toBeInTheDocument();
    expect(screen.queryByText('INDEX')).not.toBeInTheDocument();
    expect(screen.queryByText('QUICK LOOK')).not.toBeInTheDocument();
    expect(screen.getByRole('complementary', { name: '笔记上下文导航' })).toBeInTheDocument();
    expect(screen.getByRole('main')).toBeInTheDocument();
    expect(screen.getByRole('main').querySelectorAll('main')).toHaveLength(0);
  });

  it('separates the address from the title and navigates to the library root', async () => {
    renderWithStore(<NotesIndexView path={[]} />);
    expect(screen.getByRole('article', { name: '笔记索引' })).toBeInTheDocument();
    const location = screen.getByRole('navigation', { name: '当前位置' });
    expect(location).toHaveTextContent('笔记库 / 全部笔记');
    expect(within(location).queryByRole('heading')).not.toBeInTheDocument();
    await userEvent.click(within(location).getByRole('button', { name: '跳转到「笔记库」' }));
    expect(screen.getByRole('navigation', { name: '当前位置' })).toHaveTextContent('笔记库');
  });

  it('keeps the content scroll area between fixed controls and pagination', () => {
    renderWithStore(<NotesIndexView path={[]} />);
    const content = screen.getByTestId('notes-index-scroll');
    expect(within(content).getAllByLabelText('笔记图标视图').length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: '图标视图' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('navigation', { name: '笔记分页' })).toBeInTheDocument();
    expect(within(content).queryByRole('toolbar')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '后退' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '前进' })).not.toBeInTheDocument();
    const search = screen.getByRole('searchbox', { name: '搜索笔记索引' });
    expect(search.parentElement).toHaveAttribute('data-shadow-token', '--shadow-search-rest');
  });

  it('opens the existing Markdown importer from the index', async () => {
    renderWithStore(<NotesIndexView path={[]} />);
    await userEvent.click(screen.getByRole('button', { name: '新建' }));
    await userEvent.click(screen.getByRole('menuitem', { name: '导入 Markdown' }));
    expect(screen.getByRole('dialog', { name: '导入 Markdown' })).toBeInTheDocument();
  });

  it('removes the summary block and applies the tag filter from the filter menu', async () => {
    const user = userEvent.setup();
    renderWithStore(<StatefulRouter><NotesIndexView path={[]} /></StatefulRouter>, {
      tags: [{ id: 'tag-1', name: '重点', color: 'orange' }]
    });

    expect(screen.queryByText(/个文件夹/)).not.toBeInTheDocument();
    expect(screen.queryByText(/篇文稿/)).not.toBeInTheDocument();
    expect(screen.queryByRole('group', { name: '已启用的筛选' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '筛选' }));
    await user.click(screen.getByRole('menuitem', { name: /标签/ }));
    await user.click(screen.getByRole('menuitemcheckbox', { name: /重点/ }));
    await user.keyboard('{Escape}');
    const chips = screen.getByRole('group', { name: '已启用的筛选' });
    expect(chips).toHaveTextContent('标签');
    expect(chips).toHaveTextContent('重点');

    await user.click(screen.getByRole('button', { name: '移除标签筛选' }));
    expect(screen.queryByRole('group', { name: '已启用的筛选' })).not.toBeInTheDocument();
  });

  it('delegates note opening without coupling the index to routing', async () => {
    const onOpenNote = vi.fn();
    renderWithStore(
      <NotesIndexView
        path={[{ id: 'materials:index', label: '全部笔记', current: true }]}
        onOpenNote={onOpenNote}
      />
    );

    await userEvent.click(screen.getByRole('button', { name: '列表视图' }));
    await userEvent.click(screen.getByRole('button', { name: '规划草案' }));
    expect(onOpenNote).toHaveBeenCalledWith('note-1');
  });

  it('uses line icons in lists and decorative paper icons in icon views', async () => {
    renderWithStore(<NotesIndexView path={[{ id: 'materials:index', label: '全部笔记', current: true }]} />);

    await userEvent.click(screen.getByRole('button', { name: '图标视图' }));
    const iconView = screen.getByTestId('notes-index-scroll');
    expect(iconView).toBeInTheDocument();
    expect(iconView.querySelectorAll('[data-art-kind="folder"]')).toHaveLength(3);
    expect(iconView.querySelectorAll('[data-art-kind="document"]')).toHaveLength(3);
    expect(iconView.querySelectorAll('[data-art-kind] > svg')).toHaveLength(6);
    expect(iconView.querySelectorAll('[data-art-kind][aria-hidden="true"]')).toHaveLength(6);

    await userEvent.click(screen.getByRole('button', { name: '列表视图' }));
    const table = screen.getByTestId('notes-index-scroll');
    expect(table.querySelector('[data-art-kind="folder"]')).toBeInTheDocument();
    expect(table.querySelector('[data-art-kind="document"] > svg')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: '图标视图' }));
    const iconViewAfterToggle = screen.getByTestId('notes-index-scroll');
    expect(iconViewAfterToggle.querySelectorAll('[data-art-kind="folder"]')).toHaveLength(3);
    expect(iconViewAfterToggle.querySelectorAll('[data-art-kind="document"]')).toHaveLength(3);
    expect(screen.getByRole('button', { name: '显示选项（布局、分组、排序、属性）' })).toBeInTheDocument();
  });

  it('opens the shared item menu by right-clicking a list row', async () => {
    renderWithStore(<NotesIndexView path={[{ id: 'materials:index', label: '全部笔记', current: true }]} />);

    await userEvent.click(screen.getByRole('button', { name: '列表视图' }));
    const noteRow = screen.getByRole('button', { name: '规划草案' }).closest('tr');
    expect(noteRow).not.toBeNull();
    fireEvent.contextMenu(noteRow as HTMLTableRowElement, { clientX: 280, clientY: 240 });

    expect(await screen.findByRole('menu')).toHaveAttribute('aria-label', '规划草案笔记操作');
    expect(screen.getByRole('menuitem', { name: '收藏笔记' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: '重命名' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: '删除' })).toHaveAttribute('data-danger', 'true');
  });

  it('opens the shared item menu by right-clicking an icon tile', async () => {
    const user = userEvent.setup();
    renderWithStore(<NotesIndexView path={[{ id: 'materials:index', label: '全部笔记', current: true }]} />);

    await user.click(screen.getByRole('button', { name: '图标视图' }));
    const noteTile = within(screen.getByTestId('notes-index-scroll')).getByText('规划草案', { exact: true }).closest('[data-entry-item]');
    expect(noteTile).not.toBeNull();
    fireEvent.contextMenu(noteTile as HTMLElement, { clientX: 360, clientY: 300 });
    expect(await screen.findByRole('menu')).toHaveAttribute('aria-label', '规划草案笔记操作');
  });

  it('keeps a visible keyboard-operable item menu trigger', async () => {
    const user = userEvent.setup();
    renderWithStore(<NotesIndexView path={[{ id: 'materials:index', label: '全部笔记', current: true }]} />);
    await user.click(screen.getByRole('button', { name: '图标视图' }));
    await user.click(screen.getByRole('button', { name: '规划草案的笔记操作' }));
    expect(await screen.findByRole('menu')).toHaveAttribute('aria-label', '规划草案笔记操作');
  });

  it('restores one note from the recycle bin through its accessible action menu', async () => {
    const user = userEvent.setup();
    const { api } = renderWithStore(
      <NotesIndexView path={[{ id: 'materials:index', label: '回收站', current: true }]} />,
      { scope: 'trash' }
    );

    await user.click(screen.getByRole('button', { name: '已删除的回收站操作' }));
    await user.click(screen.getByRole('menuitem', { name: '恢复笔记' }));
    expect(api.restoreNote).toHaveBeenCalledWith('note-trash');
  });

  it('requires confirmation before permanently deleting one recycled note', async () => {
    const user = userEvent.setup();
    const { api } = renderWithStore(
      <NotesIndexView path={[{ id: 'materials:index', label: '回收站', current: true }]} />,
      { scope: 'trash' }
    );

    await user.click(screen.getByRole('button', { name: '已删除的回收站操作' }));
    await user.click(screen.getByRole('menuitem', { name: '彻底删除' }));
    expect(screen.getByRole('dialog', { name: '彻底删除这篇笔记？' })).toBeInTheDocument();
    expect(api.permanentlyDeleteNote).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: '彻底删除' }));
    expect(api.permanentlyDeleteNote).toHaveBeenCalledWith('note-trash');
  });

  it('paginates folders and notes together and resets type and page-size changes', async () => {
    const user = userEvent.setup();
    renderWithStore(<NotesIndexView path={[]} />);
    await user.click(screen.getByRole('button', { name: '列表视图' }));
    await vi.waitFor(() => expect(screen.queryByText('正在从服务端加载筛选结果…')).not.toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: '每页条数' }));
    await user.click(screen.getByRole('menuitemradio', { name: '每页 5 条' }));
    expect(screen.getByTestId('notes-index-scroll').querySelectorAll('tr[data-entry-item]')).toHaveLength(5);
    expect(screen.getByText('第 1 / 2 页 · 共 6 条')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '第 2 页' }));
    expect(screen.getByTestId('notes-index-scroll').querySelectorAll('tr[data-entry-item]')).toHaveLength(1);
    async function chooseType(label: string) {
      await user.click(screen.getByRole('button', { name: /^显示选项/ }));
      const dialog = screen.getByRole('dialog', { name: '索引显示选项' });
      const group = within(dialog).getByRole('group', { name: '类型' });
      const button = within(group).getByRole('button', { name: new RegExp(`^${label}`) });
      await user.click(button);
      await user.keyboard('{Escape}');
      return button;
    }
    expect((await chooseType('全部'))).toHaveTextContent('6');
    await chooseType('文件夹');
    expect(screen.getByText('第 1 / 1 页 · 共 3 条')).toBeInTheDocument();
    await chooseType('全部');
    await user.click(screen.getByRole('button', { name: '每页条数' }));
    await user.click(screen.getByRole('menuitemradio', { name: '每页 20 条' }));
    expect(screen.getByTestId('notes-index-scroll').querySelectorAll('tr[data-entry-item]')).toHaveLength(6);
  });

  it('explains unavailable desktop deletion before an action and still permits restoring', async () => {
    const user = userEvent.setup();
    const { api } = renderWithStore(<><NotesContextSidebar /><NotesIndexView path={[]} /></>, { scope: 'trash', persistenceMode: 'desktop-local' });
    expect(screen.getByText(/桌面端暂不支持彻底删除/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '已删除的回收站操作' }));
    const deletion = screen.getByRole('menuitem', { name: '彻底删除（请在网页版操作）' });
    expect(deletion).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByRole('menuitem', { name: '恢复笔记' })).not.toHaveAttribute('aria-disabled', 'true');
    await user.click(deletion);
    expect(api.permanentlyDeleteNote).not.toHaveBeenCalled();
    await user.keyboard('{Escape}');
    await user.click(screen.getByRole('button', { name: '笔记更多操作' }));
    expect(screen.getByRole('menuitem', { name: '清空回收站（请在网页版操作）' })).toHaveAttribute('aria-disabled', 'true');
    expect(api.emptyRecycleBin).not.toHaveBeenCalled();
  });

  it('loads server batches incrementally without rendering every icon at once', async () => {
    const user = userEvent.setup();
    const { api } = renderWithStore(<NotesIndexView path={[]} />, { extraNotes: 35 });
    await vi.waitFor(() => expect(api.queryNotes).toHaveBeenCalledWith(expect.objectContaining({ offset: 0, limit: 30 })));
    expect(api.queryNotes).not.toHaveBeenCalledWith(expect.objectContaining({ offset: 30 }));
    await user.click(screen.getByRole('button', { name: '图标视图' }));
    await vi.waitFor(() => {
      expect(screen.getByTestId('notes-index-scroll').querySelectorAll('[data-entry-item]')).toHaveLength(20);
      expect(screen.getByText('第 1 / 2 页 · 已载入 33 条')).toBeInTheDocument();
    });
    await user.click(screen.getByRole('button', { name: '加载更多' }));
    await vi.waitFor(() => expect(api.queryNotes).toHaveBeenCalledWith(expect.objectContaining({ offset: 30 })));
    await vi.waitFor(() => expect(screen.getByText('第 1 / 3 页 · 共 41 条')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: '第 3 页' }));
    expect(screen.getByTestId('notes-index-scroll').querySelectorAll('[data-entry-item]')).toHaveLength(1);
  });

  it('focuses index search with slash without intercepting global Mod+K and selects sorting from display options', async () => {
    const user = userEvent.setup();
    const { api } = renderWithStore(<NotesIndexView path={[]} />);
    fireEvent.keyDown(window, { key: '/' });
    expect(screen.getByRole('searchbox', { name: '搜索笔记索引' })).toHaveFocus();
    await user.click(screen.getByRole('button', { name: '显示选项（布局、分组、排序、属性）' }));
    await user.click(within(screen.getByRole('group', { name: '排序' })).getByRole('button', { name: '最早' }));
    await vi.waitFor(() => expect(api.queryNotes).toHaveBeenLastCalledWith(expect.objectContaining({ order: 'asc' })));
  });

  it('uses the server query and confirms a selected batch delete', async () => {
    const user = userEvent.setup();
    const { api } = renderWithStore(<NotesIndexView path={[{ id: 'materials:index', label: '全部笔记', current: true }]} />);
    await vi.waitFor(() => expect(api.queryNotes).toHaveBeenCalledWith(expect.objectContaining({
      sortBy: 'updatedAt', order: 'desc', offset: 0, limit: 30
    })));

    await user.click(screen.getByRole('button', { name: '更多操作' }));
    await user.click(screen.getByRole('menuitem', { name: '批量管理' }));
    await user.click(screen.getByRole('checkbox', { name: '选择规划草案' }));
    expect(screen.getByText('已选 1 篇')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '移入回收站' }));
    const dialog = screen.getByRole('dialog', { name: '将选中笔记移入回收站？' });
    await user.click(within(dialog).getByRole('button', { name: '移入回收站' }));
    await vi.waitFor(() => expect(api.deleteNotes).toHaveBeenCalledWith(['note-1']));
  });
});

function renderWithStore(ui: ReactNode, options: { scope?: 'trash'; extraNotes?: number; persistenceMode?: 'remote' | 'desktop-local'; tags?: Tag[] } = {}): RenderResult & {
  api: WorkspaceApi;
  store: ReturnType<typeof createAppStore>;
} {
  const api = createApi();
  const store = createAppStore({
    api,
    persistenceMode: options.persistenceMode,
    cacheKey: 'notes-index-test',
    mockSnapshot: createEmptyWorkspaceSnapshot()
  });
  const folders = [
    { id: 'folder-1', name: '产品设计', parentId: null, children: [] },
    { id: 'folder-2', name: '学习', parentId: null, children: [] },
    { id: 'folder-3', name: '灵感', parentId: null, children: [] }
  ];
  store.setState({
    dataMode: 'api',
    workspaceLoadState: 'ready',
    serverData: {
      spaces: [{ id: 'space-1' }],
      currentSpaceId: 'space-1',
      folderTree: folders,
      foldersById: Object.fromEntries(folders.map((folder) => [folder.id, folder])),
      notes: [
        ...Array.from({ length: options.extraNotes ?? 0 }, (_, index) => createNote(`extra-${index}`, `额外笔记 ${index}`, null)),
        createNote('note-1', '规划草案', 'folder-1'),
        createNote('note-2', '注意力机制', 'folder-2'),
        createNote('note-3', '灵感记录', null),
        { ...createNote('note-trash', '已删除', null), deleted: true }
      ],
      tags: options.tags ?? [],
      tagGroups: []
    },
    ...(options.scope ? {
      notesIndex: { ...store.getState().notesIndex, scope: options.scope }
    } : {})
  });
  vi.mocked(api.queryNotes).mockImplementation(async (input) => {
    let notes = store.getState().serverData.notes.filter((item) => input.deletedOnly ? item.deleted : !item.deleted);
    if (input.folderId) notes = notes.filter((item) => item.folderId === input.folderId);
    if (input.tagId) notes = notes.filter((item) => item.tagIds.includes(input.tagId as string));
    if (input.favoriteOnly) notes = notes.filter((item) => item.favorite);
    if (input.query) notes = notes.filter((item) => item.title.includes(input.query as string));
    notes = [...notes].sort((left, right) => input.sortBy === 'title'
      ? left.title.localeCompare(right.title, 'zh-CN')
      : Date.parse(left.updatedAt ?? '') - Date.parse(right.updatedAt ?? ''));
    if (input.order === 'desc') notes.reverse();
    const offset = input.offset ?? 0;
    const limit = input.limit ?? 30;
    return { items: notes.slice(offset, offset + limit), hasNext: notes.length > offset + limit };
  });
  const result = render(
    <AppStoreProvider
      store={store}
      dependencies={{ api, cacheKey: 'notes-index-test', mockSnapshot: createEmptyWorkspaceSnapshot() }}
    >
      {ui}
    </AppStoreProvider>
  );
  return Object.assign(result, { api, store });
}

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

function createNote(id: string, title: string, folderId: string | null) {
  return {
    id,
    title,
    folderId,
    tagIds: [],
    internalLinks: [],
    rawMarkdown: '',
    contentLoaded: false,
    favorite: false,
    deleted: false,
    updatedAt: '2026-08-23T08:00:00.000Z'
  };
}


function StatefulRouter({ children }: { children: ReactNode }) {
  const [pathname, setPathname] = useState('/materials');
  return <RouterContext.Provider value={{ pathname, navigate: setPathname }}>{children}</RouterContext.Provider>;
}
