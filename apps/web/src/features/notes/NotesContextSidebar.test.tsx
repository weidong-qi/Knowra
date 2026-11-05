import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createEmptyWorkspaceSnapshot, type Note, type Tag, type WorkspaceApi } from '@study-accelerator/web-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppStoreProvider } from '../../store/AppStoreProvider';
import { createAppStore } from '../../store/createAppStore';
import { NotesContextSidebar } from './NotesContextSidebar';
import { DEFAULT_NOTES_INDEX_APPEARANCE, setNotesIndexAppearance } from './notesIndexAppearanceModel';

beforeEach(() => {
  localStorage.removeItem('knowra:pinned-tags');
  act(() => setNotesIndexAppearance(DEFAULT_NOTES_INDEX_APPEARANCE));
});
afterEach(() => {
  localStorage.removeItem('knowra:pinned-tags');
});

describe('NotesContextSidebar', () => {
  it('侧栏快速创建支持自定义色，错误草稿不能提交', async () => {
    const user = userEvent.setup();
    const { api, store } = renderSidebar();
    act(() =>
      store.setState({
        serverData: {
          ...store.getState().serverData,
          tagGroups: [
            {
              id: 'ordinary',
              spaceId: 'space-1',
              name: '普通标签',
              code: 'ordinary',
              selectionMode: 'multiple',
              isSystem: true,
              sortOrder: 0
            }
          ]
        }
      })
    );
    vi.mocked(api.createTag).mockResolvedValue({
      id: 'custom',
      name: '自定义标签',
      color: '#3c68ff',
      groupId: 'ordinary'
    });
    await user.click(screen.getByRole('button', { name: '新建标签' }));
    await user.type(screen.getByRole('textbox', { name: '标签名称' }), '自定义标签');
    const color = screen.getByRole('textbox', { name: '十六进制颜色' });
    await user.type(color, '#fff');
    expect(screen.getByRole('button', { name: '创建标签' })).toBeDisabled();
    await user.clear(color);
    await user.type(color, '#3C68FF');
    await user.click(screen.getByRole('button', { name: '创建标签' }));
    await waitFor(() =>
      expect(api.createTag).toHaveBeenCalledWith({
        spaceId: 'space-1',
        name: '自定义标签',
        color: '#3c68ff',
        groupId: 'ordinary'
      })
    );
  });
  it('侧栏不再显示最近更新时间分布', () => {
    renderSidebar();
    expect(screen.queryByRole('region', { name: '已加载笔记 · 最近更新时间分布' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /回收站1/ })).toBeInTheDocument();
  });
  it('侧栏始终使用全局定稿外观与明暗模式', () => {
    act(() => setNotesIndexAppearance({ mode: 'dark' }));
    renderSidebar();
    const surface = document.querySelector('[data-ni-mode]');
    expect(surface).toHaveAttribute('data-ni-mode', 'dark');
    expect(surface).toHaveAttribute('data-ni-shape', 'pill');
    expect(screen.getByRole('button', { name: /全部笔记3/ })).toBeInTheDocument();
  });
  it('uses a header search action without a permanent search field', async () => {
    const onOpenSearch = vi.fn();
    renderSidebar({ onOpenSearch });
    expect(screen.queryByRole('searchbox', { name: '搜索笔记目录' })).not.toBeInTheDocument();
    const search = screen.getByRole('button', { name: '搜索笔记' });
    const create = screen.getByRole('button', { name: '新建' });
    expect(search.compareDocumentPosition(create) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    await userEvent.click(search);
    expect(onOpenSearch).toHaveBeenCalledOnce();
  });
  it('derives counts from workspace data and switches quick filters', async () => {
    const onOpenIndex = vi.fn();
    const { store } = renderSidebar({ onOpenIndex });

    expect(screen.getByRole('button', { name: /全部笔记3/ })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('button', { name: /收藏1/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /未整理1/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /回收站1/ })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /收藏1/ }));
    expect(store.getState().notesIndex.scope).toBe('favorites');
    expect(screen.getByRole('button', { name: /收藏1/ })).toHaveAttribute('aria-current', 'page');
    expect(onOpenIndex).toHaveBeenCalledOnce();

    await userEvent.click(screen.getByRole('button', { name: /回收站1/ }));
    expect(store.getState().notesIndex.scope).toBe('trash');
    expect(onOpenIndex).toHaveBeenCalledTimes(2);
  });

  it('exposes the note library entry before the folder tree', async () => {
    const onOpenIndex = vi.fn();
    const { store } = renderSidebar({ onOpenIndex });

    const rootEntry = screen.getByRole('button', { name: /笔记库2/ });
    const firstFolder = screen.getByRole('button', { name: /产品设计2/ });
    expect(rootEntry.compareDocumentPosition(firstFolder) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    await userEvent.click(rootEntry);

    expect(store.getState().notesIndex.scope).toBe('root');
    expect(rootEntry).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('button', { name: /全部笔记3/ })).not.toHaveAttribute('aria-current');
    expect(onOpenIndex).toHaveBeenCalledOnce();
  });

  it('文件夹行悬停操作：更多操作菜单提供子文件夹、笔记、移动、重命名与删除', async () => {
    renderSidebar();

    expect(screen.getByRole('button', { name: '在产品设计中新建笔记' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '产品设计更多操作' }));
    for (const name of ['新建子文件夹', '新建笔记', '移动到…', '重命名', '删除']) {
      expect(await screen.findByRole('menuitem', { name })).toBeInTheDocument();
    }
  });

  it('「文件夹」区块可折叠，行为与「标签」区块一致', async () => {
    renderSidebar();

    const toggle = screen.getByRole('button', { name: '文件夹' });
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('tree', { name: '笔记文件夹' })).toBeInTheDocument();
    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('tree', { name: '笔记文件夹' })).not.toBeInTheDocument();
    await userEvent.click(toggle);
    expect(screen.getByRole('tree', { name: '笔记文件夹' })).toBeInTheDocument();
  });

  it('selects folders and tags, expands note children, and delegates text search to the backend', async () => {
    const { api, store } = renderSidebar();

    const folderButton = screen.getByRole('button', { name: /产品设计2/ });
    await userEvent.click(folderButton);
    expect(store.getState().navigation.selectedFolderId).toBe('folder-1');
    expect(store.getState().notesIndex.scope).toBe('all');
    // 点击文件夹行只选中并打开索引，不改变展开状态；展开与收起只由箭头负责。
    expect(store.getState().navigation.openFolders['folder-1']).toBeFalsy();
    expect(screen.queryByRole('button', { name: '规划草案' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '展开产品设计' }));
    expect(store.getState().navigation.openFolders['folder-1']).toBe(true);
    expect(screen.getByRole('button', { name: '规划草案' })).toBeInTheDocument();
    await userEvent.click(folderButton);
    expect(store.getState().navigation.selectedFolderId).toBe('folder-1');
    expect(store.getState().notesIndex.scope).toBe('all');
    expect(store.getState().navigation.openFolders['folder-1']).toBe(true);
    expect(screen.getByRole('button', { name: '规划草案' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '收起产品设计' }));
    expect(screen.queryByRole('button', { name: '规划草案' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '展开产品设计' }));
    expect(screen.getByRole('button', { name: '规划草案' })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: '设计' }));
    expect(store.getState().notesIndex.selectedTagId).toBeNull();
    expect(store.getState().navigation.selectedFolderId).toBeNull();

    act(() => store.getState().setNotesQuery('正文关键词'));
    await waitFor(() =>
      expect(api.searchNoteIds).toHaveBeenCalledWith({
        query: '正文关键词',
        spaceId: 'space-1'
      })
    );
    expect(screen.getByText('没有匹配的文件夹')).toBeInTheDocument();
  });

  it('keeps the tag section expanded by default and exposes an accessible collapse control', async () => {
    renderSidebar();

    const collapseButton = screen.getByRole('button', { name: '标签' });
    expect(collapseButton).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('button', { name: '设计' })).toBeInTheDocument();

    await userEvent.click(collapseButton);
    expect(screen.getByRole('button', { name: '标签' })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('button', { name: '设计' })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: '标签' }));
    expect(screen.getByRole('button', { name: '设计' })).toBeInTheDocument();
  });

  it('按存活笔记使用量稳定排序，重复引用只计一次，并保留零使用标签与八项上限', () => {
    const tags = [
      { id: 'tag-zero', name: '未使用' },
      { id: 'tag-tie-first', name: '同量在前' },
      { id: 'tag-popular', name: '常用' },
      { id: 'tag-repeated', name: '重复引用' },
      { id: 'tag-deleted', name: '仅回收站' },
      { id: 'tag-tie-last', name: '同量在后' },
      { id: 'tag-zero-two', name: '空标签二' },
      { id: 'tag-zero-three', name: '空标签三' },
      { id: 'tag-zero-four', name: '空标签四' }
    ];
    const { store } = renderSidebar({
      tags,
      notes: [
        createNote('live-1', '存活一', null, {
          tagIds: ['tag-popular', 'tag-tie-first', 'tag-repeated', 'tag-repeated', 'tag-repeated', 'tag-tie-last']
        }),
        createNote('live-2', '存活二', null, { tagIds: ['tag-popular'] }),
        createNote('deleted-1', '已删除一', null, { deleted: true, tagIds: ['tag-repeated', 'tag-deleted'] }),
        createNote('deleted-2', '已删除二', null, { deleted: true, tagIds: ['tag-repeated', 'tag-deleted'] })
      ]
    });
    const tagButtons = () =>
      within(screen.getByLabelText('标签筛选'))
        .getAllByRole('button')
        .filter(button => !button.textContent?.startsWith('全部标签'))
        .map(button => button.textContent);

    expect(tagButtons()).toEqual([
      '常用',
      '同量在前',
      '重复引用',
      '同量在后',
      '未使用',
      '仅回收站',
      '空标签二',
      '空标签三'
    ]);
    expect(screen.queryByRole('button', { name: '空标签四' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '全部标签·9' })).toBeInTheDocument();

    act(() =>
      store.setState(state => ({
        serverData: {
          ...state.serverData,
          notes: [createNote('live-3', '新存活笔记', null, { tagIds: ['tag-zero-four', 'tag-zero-four'] })]
        }
      }))
    );
    expect(tagButtons()).toEqual([
      '空标签四',
      '未使用',
      '同量在前',
      '常用',
      '重复引用',
      '仅回收站',
      '同量在后',
      '空标签二'
    ]);
  });

  it('固定标签优先于使用量，展开后显示全部标签并可收起', async () => {
    localStorage.setItem('knowra:pinned-tags', JSON.stringify(['tag-zero', 'tag-missing', 'tag-low']));
    renderSidebar({
      tags: [
        { id: 'tag-popular', name: '常用' },
        { id: 'tag-low', name: '较少使用' },
        { id: 'tag-zero', name: '未使用' }
      ],
      notes: [
        createNote('live-1', '存活一', null, { tagIds: ['tag-popular', 'tag-low'] }),
        createNote('live-2', '存活二', null, { tagIds: ['tag-popular'] })
      ]
    });

    expect(
      within(screen.getByLabelText('标签筛选'))
        .getAllByRole('button')
        .map(button => button.textContent)
    ).toEqual(['未使用', '较少使用', '全部标签·3']);
    expect(screen.queryByRole('button', { name: '常用' })).not.toBeInTheDocument();
    const initialHash = window.location.hash;
    await userEvent.click(screen.getByRole('button', { name: '全部标签·3' }));
    expect(window.location.hash).toBe(initialHash);
    expect(screen.getByRole('button', { name: '常用' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '收起标签' })).toHaveAttribute('aria-expanded', 'true');
    await userEvent.click(screen.getByRole('button', { name: '收起标签' }));
    expect(screen.queryByRole('button', { name: '常用' })).not.toBeInTheDocument();
  });

  it('uses the shared menu for tag context actions and closes it with Escape', async () => {
    const user = userEvent.setup();
    renderSidebar();
    const tag = screen.getByRole('button', { name: '设计' });

    fireEvent.contextMenu(tag, { clientX: 160, clientY: 120 });
    expect(await screen.findByRole('menu', { name: '标签操作' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: '固定标签' })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('menu', { name: '标签操作' })).not.toBeInTheDocument());

    fireEvent.contextMenu(tag, { clientX: 180, clientY: 130 });
    await user.click(await screen.findByRole('menuitem', { name: '固定标签' }));
    fireEvent.contextMenu(tag, { clientX: 180, clientY: 130 });
    expect(await screen.findByRole('menuitem', { name: '取消固定' })).toBeInTheDocument();
  });

  it('offers folder creation from the folder section when the library is empty', async () => {
    renderSidebar({ empty: true });

    expect(screen.getByText('暂无文件夹，可使用右侧按钮创建')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '新建文件夹' }));
    expect(screen.getByRole('dialog', { name: '新建文件夹' })).toBeInTheDocument();
  });

  it('opens the existing design-system dialogs for note and folder creation', async () => {
    renderSidebar();

    await userEvent.click(screen.getByRole('button', { name: '新建' }));
    await userEvent.click(screen.getByRole('menuitem', { name: '新建笔记' }));
    expect(screen.getByRole('dialog', { name: '新建笔记' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '取消' }));

    await userEvent.click(screen.getByRole('button', { name: '笔记更多操作' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: '新建文件夹' }));
    expect(screen.getByRole('dialog', { name: '新建文件夹' })).toBeInTheDocument();
  });

  it('opens the folder context menu and creates entries under the captured folder', async () => {
    const { api } = renderSidebar();
    fireEvent.contextMenu(screen.getByRole('button', { name: /产品设计2/ }), {
      clientX: 120,
      clientY: 80
    });

    expect(await screen.findByRole('menu')).toHaveAttribute('aria-label', '产品设计文件夹操作');
    expect(screen.getByRole('menuitem', { name: '新建子文件夹' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: '新建笔记' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: '重命名' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: '删除' })).toHaveAttribute('data-danger', 'true');

    await userEvent.click(screen.getByRole('menuitem', { name: '新建子文件夹' }));
    await userEvent.type(screen.getByRole('textbox', { name: '文件夹名称' }), '研究资料');
    await userEvent.click(screen.getByRole('button', { name: '创建' }));
    await waitFor(() =>
      expect(api.createFolder).toHaveBeenCalledWith({
        spaceId: 'space-1',
        parentId: 'folder-1',
        name: '研究资料'
      })
    );
  });

  it('renames a folder and confirms folder deletion through project dialogs', async () => {
    const { api } = renderSidebar();
    const folderButton = screen.getByRole('button', { name: /产品设计2/ });
    fireEvent.contextMenu(folderButton);
    await userEvent.click(await screen.findByRole('menuitem', { name: '重命名' }));
    const input = screen.getByRole('textbox', { name: '文件夹名称' });
    await userEvent.clear(input);
    await userEvent.type(input, '产品资料');
    await userEvent.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() =>
      expect(api.updateFolder).toHaveBeenCalledWith('folder-1', {
        name: '产品资料',
        parentId: null
      })
    );

    fireEvent.contextMenu(screen.getByRole('button', { name: /产品设计2/ }));
    await userEvent.click(await screen.findByRole('menuitem', { name: '删除' }));
    expect(screen.getByRole('dialog', { name: '删除文件夹？' })).toHaveTextContent('请选择其中笔记的处理方式');
    await userEvent.click(screen.getByRole('button', { name: '删除' }));
    await waitFor(() =>
      expect(api.deleteFolder).toHaveBeenCalledWith('folder-1', { mode: 'keep', destinationId: null })
    );
  });

  it('offers favorite, rename and delete actions from a note context menu', async () => {
    const { api } = renderSidebar();
    await userEvent.click(screen.getByRole('button', { name: '展开产品设计' }));
    fireEvent.contextMenu(screen.getByRole('button', { name: '规划草案' }));

    expect(await screen.findByRole('menu')).toHaveAttribute('aria-label', '规划草案笔记操作');
    expect(screen.getByRole('menuitem', { name: '取消收藏' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: '重命名' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: '删除' })).toHaveAttribute('data-danger', 'true');
    await userEvent.click(screen.getByRole('menuitem', { name: '取消收藏' }));
    await waitFor(() => expect(api.setNoteFavorite).toHaveBeenCalledWith('note-1', false));
  });

  it('delegates note opening while keeping tree selection inside the sidebar', async () => {
    const onOpenNote = vi.fn();
    const { store } = renderSidebar({ onOpenNote });
    await userEvent.click(screen.getByRole('button', { name: '展开产品设计' }));
    await userEvent.click(screen.getByRole('button', { name: '规划草案' }));

    expect(store.getState().navigation.selectedNoteId).toBe('note-1');
    expect(onOpenNote).toHaveBeenCalledWith('note-1');
  });

  it('keeps note selection and section toggles accessible from the keyboard', async () => {
    const user = userEvent.setup();
    const onOpenNote = vi.fn();
    renderSidebar({ onOpenNote });
    const folderToggle = screen.getByRole('button', { name: '展开产品设计' });
    folderToggle.focus();
    await user.keyboard('{Enter}');
    const note = screen.getByRole('button', { name: '规划草案' });
    note.focus();
    await user.keyboard('{Enter}');
    expect(note).toHaveAttribute('aria-current', 'page');
    expect(note).toHaveFocus();
    expect(onOpenNote).toHaveBeenCalledWith('note-1');

    const tagsToggle = screen.getByRole('button', { name: '标签' });
    tagsToggle.focus();
    await user.keyboard(' ');
    expect(tagsToggle).toHaveAttribute('aria-expanded', 'false');
    expect(tagsToggle).toHaveFocus();
    expect(screen.getByRole('button', { name: /回收站1/ }).closest('footer')).not.toBeNull();
  });

  it('renames and confirms deletion for notes without native browser dialogs', async () => {
    const { api } = renderSidebar();
    await userEvent.click(screen.getByRole('button', { name: '展开产品设计' }));
    const noteButton = screen.getByRole('button', { name: '设计复盘' });
    fireEvent.contextMenu(noteButton);
    await userEvent.click(await screen.findByRole('menuitem', { name: '重命名' }));
    const input = screen.getByRole('textbox', { name: '笔记名称' });
    await userEvent.clear(input);
    await userEvent.type(input, '设计总结');
    await userEvent.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() => expect(api.updateNote).toHaveBeenCalledWith('note-2', { title: '设计总结' }));

    await userEvent.click(screen.getByRole('button', { name: '展开产品设计' }));
    fireEvent.contextMenu(screen.getByRole('button', { name: '设计复盘' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: '删除' }));
    expect(screen.getByRole('dialog', { name: '删除笔记？' })).toHaveTextContent('将移入回收站');
    await userEvent.click(screen.getByRole('button', { name: '删除' }));
    await waitFor(() => expect(api.deleteNote).toHaveBeenCalledWith('note-2'));
  });
});

function renderSidebar({
  empty = false,
  notes,
  tags,
  onOpenNote,
  onOpenIndex,
  onOpenSearch
}: {
  empty?: boolean;
  notes?: Note[];
  tags?: Tag[];
  onOpenNote?(noteId: string): void;
  onOpenIndex?(): void;
  onOpenSearch?(): void;
} = {}) {
  const api = createApi();
  const store = createAppStore({ api, cacheKey: 'sidebar-test', mockSnapshot: createEmptyWorkspaceSnapshot() });
  const folder = { id: 'folder-1', name: '产品设计', parentId: null, children: [] };
  store.setState({
    dataMode: 'api',
    workspaceLoadState: 'ready',
    serverData: {
      spaces: [{ id: 'space-1' }],
      currentSpaceId: 'space-1',
      folderTree: empty ? [] : [folder],
      foldersById: empty ? {} : { [folder.id]: folder },
      notes:
        notes ??
        (empty
          ? []
          : [
              createNote('note-1', '规划草案', 'folder-1', { favorite: true, tagIds: ['tag-1'] }),
              createNote('note-2', '设计复盘', 'folder-1'),
              createNote('note-3', '收件箱', null),
              createNote('note-4', '已删除', null, { deleted: true })
            ]),
      tags: tags ?? (empty ? [] : [{ id: 'tag-1', name: '设计' }]),
      tagGroups: []
    }
  });
  render(
    <AppStoreProvider
      store={store}
      dependencies={{ api, cacheKey: 'sidebar-test', mockSnapshot: createEmptyWorkspaceSnapshot() }}
    >
      <NotesContextSidebar onOpenNote={onOpenNote} onOpenIndex={onOpenIndex} onOpenSearch={onOpenSearch} />
    </AppStoreProvider>
  );
  return { api, store };
}

function createApi(): WorkspaceApi {
  return {
    listKnowledgeSpaces: vi.fn().mockResolvedValue([{ id: 'space-1' }]),
    createDefaultKnowledgeSpace: vi.fn().mockResolvedValue({ id: 'space-1' }),
    loadWorkspaceResources: vi.fn().mockResolvedValue({
      folderTree: [{ id: 'folder-1', name: '产品设计', parentId: null, children: [] }],
      notes: [
        createNote('note-1', '规划草案', 'folder-1', { favorite: true, tagIds: ['tag-1'] }),
        createNote('note-2', '设计复盘', 'folder-1'),
        createNote('note-3', '收件箱', null),
        createNote('note-4', '已删除', null, { deleted: true })
      ],
      tags: [{ id: 'tag-1', name: '设计' }],
      tagGroups: []
    }),
    searchNoteIds: vi.fn().mockResolvedValue(['note-2']),
    createNote: vi.fn().mockResolvedValue({ id: 'created-note' }),
    importMarkdownNotes: vi.fn().mockResolvedValue([{ id: 'imported-note' }]),
    getNote: vi.fn().mockResolvedValue({ id: 'note-1' }),
    createFolder: vi.fn().mockResolvedValue({ id: 'created-folder' }),
    updateNote: vi.fn().mockResolvedValue({ id: 'note-1' }),
    deleteNote: vi.fn().mockResolvedValue({ id: 'note-1' }),
    restoreNote: vi.fn().mockResolvedValue({ id: 'note-1' }),
    permanentlyDeleteNote: vi.fn().mockResolvedValue({ id: 'note-1' }),
    setNoteFavorite: vi.fn().mockResolvedValue({ id: 'note-1' }),
    setNoteTags: vi.fn().mockResolvedValue({ id: 'note-1' }),
    createTag: vi.fn(),
    updateTag: vi.fn(),
    deleteTag: vi.fn(),
    mergeTags: vi.fn(),
    reorderTags: vi.fn(),
    createTagGroup: vi.fn(),
    updateTagGroup: vi.fn(),
    deleteTagGroup: vi.fn(),
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
    getNoteVersion: vi.fn().mockResolvedValue({ id: 'version-1' }),
    listNoteAttachments: vi.fn().mockResolvedValue([]),
    uploadNoteAttachment: vi.fn().mockResolvedValue({ id: 'attachment-1' }),
    renameNoteAttachment: vi.fn().mockResolvedValue({ id: 'attachment-1' }),
    inspectAttachmentDeletion: vi.fn().mockResolvedValue({
      asset: { type: 'attachment', id: 'attachment-1' },
      decision: 'can-purge-no-history',
      references: [],
      reasonCodes: [],
      coverage: { persistedCurrentAndHistory: true }
    }),
    verifyNoteAttachment: vi.fn(),
    restoreNoteAttachment: vi.fn(),
    listAttachmentCleanup: vi.fn().mockResolvedValue({ items: [], pending: 0 }),
    retryAttachmentCleanup: vi.fn().mockResolvedValue({ completed: 0, pending: 0 }),
    deleteNoteAttachment: vi.fn().mockResolvedValue({ id: 'attachment-1' }),
    updateFolder: vi.fn().mockResolvedValue({ id: 'folder-1' }),
    deleteFolder: vi.fn().mockResolvedValue([]),
    emptyRecycleBin: vi.fn()
  };
}

function createNote(
  id: string,
  title: string,
  folderId: string | null,
  overrides: { favorite?: boolean; deleted?: boolean; tagIds?: string[] } = {}
) {
  return {
    id,
    title,
    folderId,
    tagIds: overrides.tagIds ?? [],
    internalLinks: [],
    rawMarkdown: '',
    contentLoaded: false,
    favorite: overrides.favorite ?? false,
    deleted: overrides.deleted ?? false,
    updatedAt: '2026-08-23T08:00:00.000Z'
  };
}
