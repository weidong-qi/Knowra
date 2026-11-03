// 本套验证真实编辑交互；预加载编辑器模块，避免把 Vite 冷编译计入正文就绪断言。
import '../features/editor/MilkdownNoteEditor';
import { StrictMode, useState } from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createEmptyWorkspaceSnapshot, normalizeNotes, type Note, type WorkspaceApi } from '@study-accelerator/web-core';
import { App } from './App';
import { AppProviders } from './AppProviders';
import { RouterProvider } from './router';
import { createAppStore } from '../store/createAppStore';
import { registerNavigationGuard } from './navigationGuard';

describe('V4-05 workspace bootstrap (AppShell + HomeView)', () => {
  it('deduplicates workspace loading under React Strict Mode and renders the home shell', async () => {
    const api = createWorkspaceApiStub();
    const store = createAppStore({
      api,
      cacheKey: 'test-cache',
      mockSnapshot: createEmptyWorkspaceSnapshot()
    });

    render(
      <StrictMode>
        <AppProviders store={store}>
          <App />
        </AppProviders>
      </StrictMode>
    );

    // 等待 loadWorkspace 完成（冻结主页的第一个工作台出现即代表已就绪）
    await screen.findByRole('heading', { name: '笔记工作台' });
    expect(api.listKnowledgeSpaces).toHaveBeenCalledTimes(1);
    expect(api.loadWorkspaceResources).toHaveBeenCalledTimes(1);

    // 冻结外壳：ModuleRail + 主区 + 状态栏
    const rail = screen.getByRole('navigation', { name: '工作域导航' });
    expect(rail).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /，创造者。$/ })).toBeInTheDocument();
    // 状态栏
    expect(screen.queryByRole('contentinfo')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '工作区状态' })).toBeInTheDocument();

    expect(within(rail).queryByRole('button', { name: '全局搜索' })).not.toBeInTheDocument();
    expect(within(rail).queryByRole('button', { name: '新建笔记' })).not.toBeInTheDocument();
    expect(within(rail).queryByRole('button', { name: '组件库' })).not.toBeInTheDocument();

    // 工作台计数来自真实 workspace。
    expect(screen.getByText('1 篇笔记')).toBeInTheDocument();
  });

  it('shows the home with error state and retries after a failed load', async () => {
    const api = createWorkspaceApiStub();
    vi.mocked(api.listKnowledgeSpaces)
      .mockRejectedValueOnce(new Error('网络不可用'))
      .mockResolvedValueOnce([{ id: 'space-1', name: 'Main' }]);
    const store = createAppStore({
      api,
      cacheKey: 'test-cache',
      mockSnapshot: createEmptyWorkspaceSnapshot()
    });

    render(<AppProviders store={store}><App /></AppProviders>);

    // 第一轮：error → EmptyState title 显示 "资料加载失败"
    expect(await screen.findByText('资料加载失败')).toBeInTheDocument();
    expect(screen.getByText('网络不可用')).toBeInTheDocument();
    // 重试按钮在 EmptyState 内
    fireEvent.click(screen.getByRole('button', { name: '重试' }));

    await waitFor(() => {
      expect(screen.queryByText('资料加载失败')).not.toBeInTheDocument();
    });
    // 第二轮成功：工作域卡出现
    expect(screen.getByRole('heading', { name: '笔记工作台' })).toBeInTheDocument();
    expect(api.listKnowledgeSpaces).toHaveBeenCalledTimes(2);
  });

  it('shows an accessible loading state while the workspace request is pending', async () => {
    const api = createWorkspaceApiStub();
    vi.mocked(api.listKnowledgeSpaces).mockImplementation(() => new Promise(() => undefined));
    const store = createAppStore({
      api,
      cacheKey: 'test-cache',
      mockSnapshot: createEmptyWorkspaceSnapshot()
    });

    render(<AppProviders store={store}><App /></AppProviders>);

    const loadingLabel = await screen.findByText('正在加载资料…');
    expect(loadingLabel).toBeInTheDocument();
    expect(loadingLabel.closest('[role="status"]')).toHaveAttribute('aria-busy', 'true');
  });

  it('shows the real empty state when the workspace has no notes', async () => {
    const api = createWorkspaceApiStub();
    vi.mocked(api.loadWorkspaceResources).mockResolvedValue({
      folderTree: [],
      notes: [],
      tags: [],
      tagGroups: []
    });
    const store = createAppStore({
      api,
      cacheKey: 'test-cache',
      mockSnapshot: createEmptyWorkspaceSnapshot()
    });

    render(<AppProviders store={store}><App /></AppProviders>);

    expect(await screen.findByText('还没有资料')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: '打开全局搜索' }).length).toBeGreaterThan(0);
  });

  it('opens the search command via the mobile trigger and supports keyboard navigation', async () => {
    const api = createWorkspaceApiStub();
    const store = createAppStore({
      api,
      cacheKey: 'test-cache',
      mockSnapshot: createEmptyWorkspaceSnapshot()
    });

    render(<AppProviders store={store}><App /></AppProviders>);
    await screen.findByRole('heading', { name: '笔记工作台' });

    const mobileNav = screen.getByRole('navigation', { name: '移动端模块导航' });
    fireEvent.click(within(mobileNav).getByRole('button', { name: '打开全局搜索' }));
    const dialog = await screen.findByRole('dialog', { name: '全局搜索' });
    expect(dialog).toBeInTheDocument();
    // 至少 1 条资料命中
    expect(within(dialog).getByText('Note')).toBeInTheDocument();

    const input = within(dialog).getByRole('combobox');
    fireEvent.change(input, { target: { value: 'Note' } });
    expect(within(dialog).getByRole('button', { name: '清除搜索关键字' })).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: '清除搜索关键字' }));
    expect(input).toHaveValue('');

    // 中文输入法 composing 期间不抢 Enter。
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true });
    expect(screen.getByRole('dialog', { name: '全局搜索' })).toBeInTheDocument();

    // Enter 跳转到该资料并关闭 dialog
    fireEvent.change(input, { target: { value: 'Note' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: '全局搜索' })).not.toBeInTheDocument();
    });
  });

  it('opens the search command via ⌘ K global shortcut', async () => {
    const api = createWorkspaceApiStub();
    const store = createAppStore({
      api,
      cacheKey: 'test-cache',
      mockSnapshot: createEmptyWorkspaceSnapshot()
    });

    render(<AppProviders store={store}><App /></AppProviders>);
    await screen.findByRole('heading', { name: '笔记工作台' });

    fireEvent.keyDown(window, { key: 'k', metaKey: true });
    expect(await screen.findByRole('dialog', { name: '全局搜索' })).toBeInTheDocument();
  });

  it('CmdK 正文投影经过真实 store 能力打开资料路径并选中目录；标签与主页动作保留', async () => {
    const note = { id: 'note/正文', spaceId: 'space-1', title: '合成正文资料', folderId: 'folder-1', summary: '前文'.repeat(120),
      contentLoaded: false, rawMarkdown: '', tagIds: [], internalLinks: [], favorite: false, deleted: false };
    const api = createWorkspaceApiStub({ notes: [note] });
    api.searchCommandNotes = vi.fn(async () => [{ id: note.id, title: note.title, folderId: note.folderId, snippet: '…超过摘要的中文命中…' }]);
    vi.mocked(api.loadWorkspaceResources).mockResolvedValue({
      folderTree: [{ id: 'folder-1', name: '合成目录', parentId: null, children: [] }],
      notes: [note], tags: [{ id: 'tag-current', spaceId: 'space-1', name: '合成标签', color: 'blue' }]
    });
    const store = createAppStore({ api, cacheKey: 'synthetic-command', mockSnapshot: createEmptyWorkspaceSnapshot() });
    const navigate = vi.fn();
    render(<RouterProvider location={{ pathname: '/', navigate }}><AppProviders store={store}><App /></AppProviders></RouterProvider>);
    await screen.findByRole('heading', { name: '笔记工作台' });
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    let dialog = await screen.findByRole('dialog', { name: '全局搜索' });
    fireEvent.change(within(dialog).getByRole('combobox'), { target: { value: '超过摘要的中文' } });
    expect(within(dialog).queryByRole('option')).not.toBeInTheDocument();
    expect(await within(dialog).findByRole('option', { name: /合成正文资料/ })).toBeInTheDocument();
    expect(api.searchCommandNotes).toHaveBeenCalledWith({ query: '超过摘要的中文', spaceId: 'space-1' });
    fireEvent.keyDown(within(dialog).getByRole('combobox'), { key: 'Enter' });
    await waitFor(() => expect(navigate).toHaveBeenLastCalledWith('/materials/notes/note%2F%E6%AD%A3%E6%96%87'));
    expect(store.getState().navigation.selectedNoteId).toBe(note.id);
    expect(store.getState().navigation.selectedFolderId).toBe(note.folderId);
    expect(store.getState().navigation.openNoteTabs).toContain(note.id);
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    vi.mocked(api.searchCommandNotes).mockResolvedValue([]);
    fireEvent.keyDown(window, { key: 'k', metaKey: true });
    dialog = await screen.findByRole('dialog', { name: '全局搜索' });
    fireEvent.change(within(dialog).getByRole('combobox'), { target: { value: '合成标签' } });
    fireEvent.click(await within(dialog).findByRole('option', { name: /#合成标签/ }));
    expect(store.getState().notesIndex.selectedTagId).toBe('tag-current');
    expect(navigate).toHaveBeenLastCalledWith('/materials');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    fireEvent.keyDown(window, { key: 'k', metaKey: true });
    dialog = await screen.findByRole('dialog', { name: '全局搜索' });
    fireEvent.change(within(dialog).getByRole('combobox'), { target: { value: '返回主页' } });
    fireEvent.click(await within(dialog).findByRole('option', { name: /返回主页/ }));
    expect(navigate).toHaveBeenLastCalledWith('/');
  });

  it('当前空间变化后，全局搜索不展示旧空间本地标题或标签', async () => {
    const api = createWorkspaceApiStub();
    const store = createAppStore({ api, cacheKey: 'synthetic-space', mockSnapshot: createEmptyWorkspaceSnapshot() });
    render(<AppProviders store={store}><App /></AppProviders>);
    await screen.findByRole('heading', { name: '笔记工作台' });
    fireEvent.keyDown(window, { key: 'k', metaKey: true });
    const dialog = await screen.findByRole('dialog', { name: '全局搜索' });
    expect(within(dialog).getByText('Note')).toBeInTheDocument();
    act(() => store.setState(state => ({ serverData: { ...state.serverData, currentSpaceId: 'space-2',
      tags: [{ id: 'old-tag', name: '旧空间标签', spaceId: 'space-1', color: 'blue' }] } })));
    expect(within(dialog).queryByText('Note')).not.toBeInTheDocument();
    expect(within(dialog).queryByText('#旧空间标签')).not.toBeInTheDocument();
    expect(within(dialog).getByRole('option')).toHaveTextContent('返回主页');
  });

  it('creates and opens a note from the global button and ⌘ N shortcut', async () => {
    const api = createWorkspaceApiStub({ notes: [] });
    const store = createAppStore({ api, cacheKey: 'test-cache', mockSnapshot: createEmptyWorkspaceSnapshot() });
    const navigateMock = vi.fn();
    render(<RouterProvider location={{ pathname: '/', navigate: navigateMock }}><AppProviders store={store}><App /></AppProviders></RouterProvider>);
    await screen.findByText('还没有资料');

    fireEvent.keyDown(window, { key: 'n', metaKey: true });
    const dialog = await screen.findByRole('dialog', { name: '新建笔记' });
    fireEvent.change(within(dialog).getByRole('textbox', { name: '笔记名称' }), { target: { value: '全局创建' } });
    fireEvent.click(within(dialog).getByRole('button', { name: '创建' }));

    await waitFor(() => expect(api.createNote).toHaveBeenCalledWith(expect.objectContaining({ title: '全局创建', folderId: null })));
    expect(navigateMock).toHaveBeenCalledWith('/materials/notes/created-note');
  });

  it('keeps available and unavailable work domains distinct', async () => {
    const api = createWorkspaceApiStub();
    const store = createAppStore({
      api,
      cacheKey: 'test-cache',
      mockSnapshot: createEmptyWorkspaceSnapshot()
    });

    render(<AppProviders store={store}><App /></AppProviders>);
    await screen.findByRole('heading', { name: '笔记工作台' });

    const rail = screen.getByRole('navigation', { name: '工作域导航' });
    const training = within(rail).getByRole('button', { name: /试题/ });
    expect(training).toBeEnabled();
    expect(within(rail).getByRole('button', { name: /知识/ })).toBeEnabled();
    expect(within(rail).getByRole('button', { name: '设置' })).toBeEnabled();
    expect(screen.getByRole('button', { name: '通知（尚未上线）' })).toBeDisabled();
    expect(within(rail).getByRole('button', { name: /执行/ })).toBeDisabled();
  });

  it('opens settings and applies local preferences', async () => {
    const storage = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => { storage.set(key, value); },
      removeItem: (key: string) => { storage.delete(key); }
    });
    const api = createWorkspaceApiStub();
    const store = createAppStore({ api, cacheKey: 'settings-test', mockSnapshot: createEmptyWorkspaceSnapshot() });
    const navigate = vi.fn();
    const view = render(
      <RouterProvider location={{ pathname: '/', navigate }}>
        <AppProviders store={store}><App /></AppProviders>
      </RouterProvider>
    );
    fireEvent.click(within(screen.getByRole('navigation', { name: '工作域导航' })).getByRole('button', { name: '设置' }));
    expect(navigate).toHaveBeenCalledWith('/settings');
    view.unmount();

    render(
      <RouterProvider location={{ pathname: '/settings', navigate }}>
        <AppProviders store={store}><App /></AppProviders>
      </RouterProvider>
    );
    expect(screen.getByRole('heading', { name: '设置' })).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: '设置分类' })).toBeInTheDocument();
    expect(screen.queryByText('个人偏好')).not.toBeInTheDocument();
    expect(screen.queryByText('分类 / CATEGORIES')).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '全部设置' })).not.toBeInTheDocument();
    expect(screen.getByText('显示 9 / 9 项设置')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '大（19 像素）' }));
    expect(document.documentElement.style.getPropertyValue('--note-font-size')).toBe('19px');
    fireEvent.click(screen.getByRole('checkbox', { name: '减少界面动效' }));
    expect(document.documentElement.dataset.reduceMotion).toBe('true');
    expect(JSON.parse(localStorage.getItem('knowra:preferences:v1') ?? '{}')).toEqual({ noteFontSize: 19, reduceMotion: true });
    fireEvent.click(screen.getByRole('checkbox', { name: '显示笔记目录栏' }));
    expect(localStorage.getItem('knowra:notes-sidebar-open')).toBe('false');
    fireEvent.click(within(screen.getByRole('navigation', { name: '设置分类' })).getByRole('button', { name: /辅助体验/ }));
    expect(screen.queryByRole('heading', { name: '笔记正文字号' })).not.toBeInTheDocument();
    expect(screen.getByText('显示 1 / 9 项设置')).toBeInTheDocument();
    vi.unstubAllGlobals();
  });

  it('renders the training workspace for its route', async () => {
    const api = createWorkspaceApiStub();
    const store = createAppStore({
      api,
      cacheKey: 'test-cache',
      mockSnapshot: createEmptyWorkspaceSnapshot()
    });

    render(
      <RouterProvider location={{ pathname: '/training', navigate: vi.fn() }}>
        <AppProviders store={store}><App /></AppProviders>
      </RouterProvider>
    );

    expect(await screen.findByText('当前筛选下没有题目。')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '试题库' })).toBeInTheDocument();
    expect(api.listKnowledgeSpaces).toHaveBeenCalled();
    expect(api.listTrainingAssets).toHaveBeenCalledTimes(4);
  });

  it('shows training asset trash, restore and blocked purge states', async () => {
    const api = createWorkspaceApiStub();
    let question = { id: 'question-1', stem: '导数是什么意思？', updatedAt: '2026-09-24T00:00:00.000Z', reviewStatus: 'draft', deletedAt: null as string | null, learningObjectiveIds: [] };
    api.listTrainingAssets = vi.fn(async kind => kind === 'question' ? [question] : []);
    api.mutateTrainingAsset = vi.fn(async (_kind, _id, action) => {
      question = { ...question, deletedAt: action === 'trash' ? '2026-09-24T00:00:01.000Z' : null };
      return question;
    });
    api.inspectTrainingAssetPurge = vi.fn().mockResolvedValue({ asset: { type: 'question', id: question.id }, decision: 'requires-dependency-action', expectedUpdatedAt: question.updatedAt, references: [{ collection: 'analysisScopeSnapshots', id: 'scope-1', action: 'retain-or-resolve-history' }], exclusiveRecords: {}, coverage: {} });
    const store = createAppStore({ api, cacheKey: 'training-test', mockSnapshot: createEmptyWorkspaceSnapshot() });
    render(<RouterProvider location={{ pathname: '/training', navigate: vi.fn() }}><AppProviders store={store}><App /></AppProviders></RouterProvider>);
    expect(await screen.findByRole('heading', { name: '导数是什么意思？' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '删除…' }));
    fireEvent.click(within(screen.getByRole('dialog', { name: '删除题目？' })).getByRole('button', { name: '移入回收站' }));
    await waitFor(() => expect(api.mutateTrainingAsset).toHaveBeenCalledWith('question', 'question-1', 'trash'));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '删除题目？' })).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: '回收站' }));
    expect(await screen.findByRole('button', { name: '恢复' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '永久清理…' }));
    const dialog = await screen.findByRole('dialog', { name: '永久清理题目？' });
    expect(await within(dialog).findByText(/scope-1/)).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: '确认永久清理' })).toBeDisabled();
  });

  it('does not highlight any rail module on the home page (/)', async () => {
    const api = createWorkspaceApiStub();
    const store = createAppStore({
      api,
      cacheKey: 'test-cache',
      mockSnapshot: createEmptyWorkspaceSnapshot()
    });

    render(<AppProviders store={store}><App /></AppProviders>);
    await screen.findByRole('heading', { name: '笔记工作台' });

    const rail = screen.getByRole('navigation', { name: '工作域导航' });
    // 主页不属于任何工作域的子页面：左轨所有模块入口都应为非激活态。
    expect(within(rail).getByRole('button', { name: '资料' })).not.toHaveAttribute('aria-current', 'page');
  });

  it('navigates to the notes index when clicking the materials rail button', async () => {
    const api = createWorkspaceApiStub();
    const store = createAppStore({
      api,
      cacheKey: 'test-cache',
      mockSnapshot: createEmptyWorkspaceSnapshot()
    });

    const navigateMock = vi.fn();
    render(
      <RouterProvider location={{ pathname: '/', navigate: navigateMock }}>
        <AppProviders store={store}><App /></AppProviders>
      </RouterProvider>
    );
    await screen.findByRole('heading', { name: '笔记工作台' });

    const rail = screen.getByRole('navigation', { name: '工作域导航' });
    fireEvent.click(within(rail).getByRole('button', { name: '资料' }));

    // "资料"按钮应导向独立路由 /materials（笔记索引页），而不是 / 主页。
    expect(navigateMock).toHaveBeenCalledWith('/materials');
  });

  it('highlights the materials rail button on the notes index page (/materials)', async () => {
    const api = createWorkspaceApiStub();
    const store = createAppStore({
      api,
      cacheKey: 'test-cache',
      mockSnapshot: createEmptyWorkspaceSnapshot()
    });

    render(
      <RouterProvider location={{ pathname: '/materials', navigate: vi.fn() }}>
        <AppProviders store={store}><App /></AppProviders>
      </RouterProvider>
    );

    // 笔记索引页包含独立的索引区域与侧栏。
    expect(await screen.findByRole('article', { name: '笔记索引' })).toBeInTheDocument();
    expect(screen.getByRole('complementary', { name: '笔记上下文导航' })).toBeInTheDocument();

    const rail = screen.getByRole('navigation', { name: '工作域导航' });
    // 笔记索引页才是"资料"工作域的着陆页：左轨"资料"按钮 aria-current='page'。
    expect(within(rail).getByRole('button', { name: '资料' })).toHaveAttribute('aria-current', 'page');
  });

  it('toggles the context sidebar from the notes index status bar', async () => {
    const store = createAppStore({
      api: createWorkspaceApiStub(),
      cacheKey: 'test-cache',
      mockSnapshot: createEmptyWorkspaceSnapshot()
    });

    render(
      <RouterProvider location={{ pathname: '/materials', navigate: vi.fn() }}>
        <AppProviders store={store}><App /></AppProviders>
      </RouterProvider>
    );

    expect(await screen.findByRole('article', { name: '笔记索引' })).toBeInTheDocument();
    const toggle = within(screen.getByRole('banner', { name: '全局顶栏' })).getByRole('button', { name: '切换侧栏' });
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('complementary', { name: '笔记上下文导航' })).toBeInTheDocument();

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    expect(screen.queryByRole('complementary', { name: '笔记上下文导航' })).not.toBeInTheDocument();
    expect(screen.getByRole('article', { name: '笔记索引' })).toBeInTheDocument();

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('complementary', { name: '笔记上下文导航' })).toBeInTheDocument();
  });

  it('remembers a collapsed notes sidebar after the app remounts', async () => {
    const values = new Map<string, string>();
    const storage: Storage = {
      get length() { return values.size; },
      clear: () => values.clear(),
      getItem: (key) => values.get(key) ?? null,
      key: (index) => [...values.keys()][index] ?? null,
      removeItem: (key) => { values.delete(key); },
      setItem: (key, value) => { values.set(key, value); }
    };
    vi.stubGlobal('localStorage', storage);
    const renderIndex = () => render(
      <RouterProvider location={{ pathname: '/materials', navigate: vi.fn() }}>
        <AppProviders store={createAppStore({
          api: createWorkspaceApiStub(),
          cacheKey: 'test-cache',
          mockSnapshot: createEmptyWorkspaceSnapshot()
        })}><App /></AppProviders>
      </RouterProvider>
    );

    try {
      const first = renderIndex();
      expect(await screen.findByRole('article', { name: '笔记索引' })).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: '切换侧栏' }));
      await waitFor(() => expect(values.get('knowra:notes-sidebar-open')).toBe('false'));
      first.unmount();

      renderIndex();
      expect(await screen.findByRole('article', { name: '笔记索引' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: '切换侧栏' })).toHaveAttribute('aria-pressed', 'false');
      expect(screen.queryByRole('complementary', { name: '笔记上下文导航' })).not.toBeInTheDocument();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('renders the note editor framework on a routed note URL', async () => {
    const api = createWorkspaceApiStub();
    const store = createAppStore({
      api,
      cacheKey: 'test-cache',
      mockSnapshot: createEmptyWorkspaceSnapshot()
    });

    render(
      <RouterProvider location={{ pathname: '/materials/notes/note-1', navigate: vi.fn() }}>
        <AppProviders store={store}><App /></AppProviders>
      </RouterProvider>
    );

    expect(await screen.findByRole('heading', { name: 'Note', level: 1 })).toBeInTheDocument();
    expect(screen.getByRole('tablist', { name: '打开的笔记' })).toBeInTheDocument();
    expect(screen.getByRole('toolbar', { name: '笔记格式工具栏' })).toBeInTheDocument();
    expect(screen.getByRole('complementary', { name: '笔记上下文导航' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '工作区状态' }));
    expect(within(await screen.findByLabelText('工作区位置')).getByText('Note')).toHaveAttribute('aria-current', 'location');
  });

  it('moves editor tabs into the Mac titlebar while keeping the browser layout intact', async () => {
    window.knowraDesktop = { onPrepareClose() {}, onCancelClose() {} };
    try {
      const store = createAppStore({
        api: createWorkspaceApiStub(),
        cacheKey: 'test-cache',
        mockSnapshot: createEmptyWorkspaceSnapshot()
      });
      render(
        <RouterProvider location={{ pathname: '/materials/notes/note-1', navigate: vi.fn() }}>
          <AppProviders store={store}><App /></AppProviders>
        </RouterProvider>
      );

      const tabs = await screen.findByRole('tablist', { name: '打开的笔记' });
      expect(tabs.closest('[aria-label="Mac 窗口标题栏"]')).toBeInTheDocument();
      expect(screen.getByLabelText('笔记编辑页面骨架')).toHaveAttribute('data-window-tabs', 'true');
      expect(within(tabs).getByRole('tab', { name: 'Note' })).toBeInTheDocument();
      expect(within(tabs).getByRole('button', { name: '新建笔记' })).toBeInTheDocument();
    } finally {
      delete window.knowraDesktop;
    }
  });

  it.each([false, true])('keeps cross-module note tabs and restores title (native=%s)', async native => {
    if (native) window.knowraDesktop = { onPrepareClose() {}, onCancelClose() {} };
    try {
      const store = createAppStore({
        api: createWorkspaceApiStub(),
        cacheKey: 'test-cache',
        mockSnapshot: createEmptyWorkspaceSnapshot()
      });
      const navigateMock = vi.fn();
      render(
        <RouterProvider location={{ pathname: '/', navigate: navigateMock }}>
          <AppProviders store={store}><App /></AppProviders>
        </RouterProvider>
      );
      await screen.findByRole('heading', { name: '笔记工作台' });
      act(() => store.getState().selectNote('note-1'));

      const titlebar = screen.getByLabelText(native ? 'Mac 窗口标题栏' : '全局顶栏');
      const tabs = within(titlebar).getByRole('tablist', { name: '打开的笔记' });
      const tab = within(tabs).getByRole('tab', { name: 'Note' });
      expect(tab).toHaveAttribute('aria-selected', 'false');
      expect(tab).toHaveAttribute('tabindex', '0');
      fireEvent.click(tab);
      expect(navigateMock).toHaveBeenCalledWith('/materials/notes/note-1');

      fireEvent.click(within(tabs).getByRole('button', { name: '关闭Note' }));
      expect(within(titlebar).queryByRole('tablist', { name: '打开的笔记' })).not.toBeInTheDocument();
      expect(titlebar).toHaveTextContent('知境');
    } finally {
      delete window.knowraDesktop;
    }
  });

  it('returns from an open note to the index when a quick entry is selected', async () => {
    const api = createWorkspaceApiStub();
    const store = createAppStore({
      api,
      cacheKey: 'test-cache',
      mockSnapshot: createEmptyWorkspaceSnapshot()
    });
    const navigateMock = vi.fn();

    render(
      <RouterProvider location={{ pathname: '/materials/notes/note-1', navigate: navigateMock }}>
        <AppProviders store={store}><App /></AppProviders>
      </RouterProvider>
    );

    await screen.findByRole('heading', { name: 'Note', level: 1 });
    fireEvent.click(screen.getByRole('button', { name: /收藏0/ }));

    expect(store.getState().notesIndex.scope).toBe('favorites');
    expect(navigateMock).toHaveBeenCalledWith('/materials?scope=favorites');
  });

  it('returns to the home page (/) when clicking the brand logo on the notes index', async () => {
    const api = createWorkspaceApiStub();
    const store = createAppStore({
      api,
      cacheKey: 'test-cache',
      mockSnapshot: createEmptyWorkspaceSnapshot()
    });

    const navigateMock = vi.fn();
    render(
      <RouterProvider location={{ pathname: '/materials', navigate: navigateMock }}>
        <AppProviders store={store}><App /></AppProviders>
      </RouterProvider>
    );
    expect(await screen.findByRole('article', { name: '笔记索引' })).toBeInTheDocument();

    const rail = screen.getByRole('navigation', { name: '工作域导航' });
    fireEvent.click(within(rail).getByRole('button', { name: '知境工作区' }));

    // 左上角 Logo 永远回到主页（/），与"资料"按钮职责彻底分离。
    expect(navigateMock).toHaveBeenCalledWith('/');
  });

  it('StatusBar breadcrumb is "主页" on the home page (no current module)', async () => {
    const api = createWorkspaceApiStub();
    const store = createAppStore({
      api,
      cacheKey: 'test-cache',
      mockSnapshot: createEmptyWorkspaceSnapshot()
    });

    render(<AppProviders store={store}><App /></AppProviders>);
    await screen.findByRole('heading', { name: '笔记工作台' });

    fireEvent.click(screen.getByRole('button', { name: '工作区状态' }));
    const breadcrumb = await screen.findByLabelText('工作区位置');
    const current = within(breadcrumb).getByText('主页');
    expect(current).toHaveAttribute('aria-current', 'location');
    // 末段不可点
    expect(within(breadcrumb).queryByRole('button', { name: '跳转到「主页」' })).not.toBeInTheDocument();
  });

  it('shares the module-local "笔记库 / 全部笔记" path with the notes header', async () => {
    const api = createWorkspaceApiStub({ notes: [] });
    const store = createAppStore({
      api,
      cacheKey: 'test-cache',
      mockSnapshot: createEmptyWorkspaceSnapshot()
    });

    render(
      <RouterProvider location={{ pathname: '/materials', navigate: vi.fn() }}>
        <AppProviders store={store}><App /></AppProviders>
      </RouterProvider>
    );
    // 等到 NotesIndexView 出现（即使 notes 为空）
    expect(await screen.findByRole('article', { name: '笔记索引' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '工作区状态' }));
    const breadcrumb = await screen.findByLabelText('工作区位置');
    // 笔记库模块内不重复显示全局主页层级。
    expect(within(breadcrumb).queryByText('主页')).not.toBeInTheDocument();
    expect(within(breadcrumb).getByRole('button', { name: '跳转到「笔记库」' })).toBeInTheDocument();
    expect(within(breadcrumb).getByText('全部笔记')).toHaveAttribute('aria-current', 'location');

    fireEvent.keyDown(screen.getByRole('dialog', { name: '工作区状态' }), { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '工作区状态' })).not.toBeInTheDocument());
    const topLocation = screen.getByRole('navigation', { name: '当前位置' });
    expect(topLocation).not.toHaveTextContent('主页');
    expect(within(topLocation).getByRole('button', { name: '跳转到「笔记库」' })).toBeInTheDocument();
    expect(within(topLocation).getByText('全部笔记')).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('article', { name: '笔记索引' })).toBeInTheDocument();
  });

  it('StatusBar breadcrumb stays on the index surface when a note is selected in store state', async () => {
    const api = createWorkspaceApiStub();
    const store = createAppStore({
      api,
      cacheKey: 'test-cache',
      mockSnapshot: createEmptyWorkspaceSnapshot()
    });

    render(
      <RouterProvider location={{ pathname: '/materials', navigate: vi.fn() }}>
        <AppProviders store={store}><App /></AppProviders>
      </RouterProvider>
    );
    expect(await screen.findByRole('article', { name: '笔记索引' })).toBeInTheDocument();

    // 选择态可能由 workspace hydration 或全局搜索产生，但不代表进入了笔记详情路由。
    act(() => {
      store.getState().selectFolder('folder-1');
      store.getState().selectNote('note-1');
    });

    fireEvent.click(screen.getByRole('button', { name: '工作区状态' }));
    const breadcrumb = await screen.findByLabelText('工作区位置');
    // /materials 只表达当前索引 surface，不被 latent selection 污染。
    const separators = within(breadcrumb).getAllByText('/', { exact: true });
    expect(separators).toHaveLength(1);
    expect(within(breadcrumb).queryByText('主页')).not.toBeInTheDocument();
    expect(within(breadcrumb).getByText('全部笔记')).toHaveAttribute('aria-current', 'location');
    expect(within(breadcrumb).queryByText('Note')).not.toBeInTheDocument();
    expect(within(breadcrumb).queryByText('M4-02')).not.toBeInTheDocument();

    fireEvent.keyDown(screen.getByRole('dialog', { name: '工作区状态' }), { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '工作区状态' })).not.toBeInTheDocument());
    const topLocation = screen.getByRole('navigation', { name: '当前位置' });
    expect(within(topLocation).getByText('全部笔记')).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('article', { name: '笔记索引' })).toBeInTheDocument();
    expect(within(topLocation).queryByText('Note')).not.toBeInTheDocument();
  });
});

describe('CmdK 打开尚未预载的服务端笔记', () => {
  beforeEach(() => Object.defineProperty(HTMLElement.prototype, 'scrollTo', { configurable: true, value: vi.fn() }));

  const detail = (id = 'remote-a') => normalizeNotes([{ id, spaceId: 'space-1', title: `正式详情 ${id}`, folderId: 'folder-1',
    rawMarkdown: `# 详情正文\n\n${'超过摘要的前文。'.repeat(50)}完整服务端正文 ${id}`, deleted: false }])[0];
  function setup() {
    const api = createWorkspaceApiStub({ notes: [] });
    api.searchCommandNotes = vi.fn(async input => input.query.startsWith('目标') ? [{ id: input.query === '目标 B' ? 'remote-b' : 'remote-a',
      title: '正文匹配资料', folderId: 'folder-1', snippet: `…${input.query}…` }] : []);
    vi.mocked(api.getNote).mockImplementation(async id => detail(id));
    const store = createAppStore({ api, cacheKey: 'synthetic-command-unseen', mockSnapshot: createEmptyWorkspaceSnapshot() });
    let setPath!: (path: string) => void;
    const navigate = vi.fn((path: string) => setPath(path));
    function Harness() {
      const [pathname, setPathname] = useState('/');
      setPath = setPathname;
      return <RouterProvider location={{ pathname, navigate }}><AppProviders store={store}><App /></AppProviders></RouterProvider>;
    }
    render(<Harness />);
    return { api, store, navigate };
  }
  async function searchAndSelect(query = '目标 A') {
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    const dialog = await screen.findByRole('dialog', { name: '全局搜索' });
    const input = within(dialog).getByRole('combobox');
    fireEvent.change(input, { target: { value: query } });
    await within(dialog).findByRole('option', { name: /正文匹配资料/ });
    fireEvent.keyDown(input, { key: 'Enter' });
    return { dialog, input };
  }
  function deferredDetail() {
    let resolve!: (note: Note) => void, reject!: (error: Error) => void;
    const promise = new Promise<Note>((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
  }

  it('读取未知 ID 的完整详情并打开实际编辑页面，无需重载摘要列表', async () => {
    const { api, store, navigate } = setup();
    await screen.findByRole('heading', { name: '笔记工作台' });
    expect(store.getState().serverData.notes).toEqual([]);
    await searchAndSelect();
    expect(await screen.findByRole('heading', { name: detail().title })).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await waitFor(() => expect(document.querySelector('.ProseMirror')).toHaveTextContent('完整服务端正文 remote-a'));
    expect(store.getState().serverData.notes).toEqual([detail()]);
    expect(store.getState().navigation).toEqual(expect.objectContaining({ selectedNoteId: 'remote-a', selectedFolderId: 'folder-1', openNoteTabs: ['remote-a'] }));
    expect(api.getNote).toHaveBeenCalledExactlyOnceWith('remote-a');
    expect(api.loadWorkspaceResources).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledExactlyOnceWith('/materials/notes/remote-a');
    expect(screen.queryByRole('heading', { name: '未找到这篇笔记' })).not.toBeInTheDocument();
  });

  it('详情载入期间保持 Dialog 并阻止重复 Enter；404 可见且可重试', async () => {
    const { api, store, navigate } = setup();
    const pending = deferredDetail();
    vi.mocked(api.getNote).mockReturnValueOnce(pending.promise);
    await screen.findByRole('heading', { name: '笔记工作台' });
    const { dialog, input } = await searchAndSelect();
    expect(await within(dialog).findByText('正在载入笔记…')).toBeInTheDocument();
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(api.getNote).toHaveBeenCalledTimes(1);
    expect(navigate).not.toHaveBeenCalled();
    await act(async () => pending.reject(new Error('笔记不存在（404）')));
    expect(within(dialog).getByRole('alert')).toHaveTextContent('笔记不存在（404）');
    expect(store.getState().serverData.notes).toEqual([]);
    expect(store.getState().navigation.selectedNoteId).toBeNull();
    fireEvent.keyDown(input, { key: 'Enter' });
    await screen.findByRole('heading', { name: detail().title });
    expect(api.getNote).toHaveBeenCalledTimes(2);
    expect(navigate).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['详情 ID 不一致', { id: 'wrong-id' }, '与搜索命中不一致'],
    ['其他空间', { spaceId: 'space-2' }, '不属于当前空间'],
    ['已删除', { deleted: true }, '已被删除'],
    ['仅摘要片段', { rawMarkdown: undefined }, '不完整']
  ])('%s显示错误，不导航、不伪造正文', async (_, override, message) => {
    const { api, store, navigate } = setup();
    vi.mocked(api.getNote).mockResolvedValue({ ...detail(), ...override } as Note);
    await screen.findByRole('heading', { name: '笔记工作台' });
    const { dialog } = await searchAndSelect();
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(String(message));
    expect(store.getState().serverData.notes).toEqual([]);
    expect(store.getState().navigation.selectedNoteId).toBeNull();
    expect(navigate).not.toHaveBeenCalled();
  });

  it.each(['关闭', '输入变化', '空间往返', '同空间新快照', '另行导航'])('%s后迟到详情不插入、不重开 Dialog 或抢导航', async change => {
    const { api, store, navigate } = setup();
    const pending = deferredDetail();
    vi.mocked(api.getNote).mockReturnValueOnce(pending.promise);
    await screen.findByRole('heading', { name: '笔记工作台' });
    const { dialog, input } = await searchAndSelect();
    await within(dialog).findByText('正在载入笔记…');
    if (change === '关闭') fireEvent.click(within(dialog).getByRole('button', { name: '关闭对话框' }));
    else if (change === '输入变化') fireEvent.change(input, { target: { value: '返回主页' } });
    else if (change === '空间往返') act(() => {
      store.setState(state => ({ serverData: { ...state.serverData, currentSpaceId: 'space-2' } }));
      store.setState(state => ({ serverData: { ...state.serverData, currentSpaceId: 'space-1' } }));
    });
    else if (change === '同空间新快照') act(() => store.setState(state => ({ serverData: { ...state.serverData, spaces: [...state.serverData.spaces] } })));
    else act(() => navigate('/settings'));
    const scopedData = store.getState().serverData;
    await act(async () => pending.resolve(detail()));
    expect(store.getState().serverData).toBe(scopedData);
    expect(store.getState().serverData.notes).toEqual([]);
    expect(navigate.mock.calls).toEqual(change === '另行导航' ? [['/settings']] : []);
    expect(screen.queryByRole('heading', { name: detail().title })).not.toBeInTheDocument();
    if (change === '关闭') expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it.each(['成功', '失败'])('后选 B 先完成，旧 A 迟到%s不会抢回选中项或路由', async outcome => {
    const { api, store, navigate } = setup();
    const first = deferredDetail(), second = deferredDetail();
    vi.mocked(api.getNote).mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    await screen.findByRole('heading', { name: '笔记工作台' });
    const { dialog, input } = await searchAndSelect();
    await within(dialog).findByText('正在载入笔记…');
    fireEvent.change(input, { target: { value: '目标 B' } });
    await within(dialog).findByRole('option', { name: /正文匹配资料/ });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(api.getNote).toHaveBeenLastCalledWith('remote-b');
    await act(async () => second.resolve(detail('remote-b')));
    await screen.findByRole('heading', { name: detail('remote-b').title });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await act(async () => outcome === '成功' ? first.resolve(detail()) : first.reject(new Error('旧 A 请求失败')));
    expect(store.getState().navigation.selectedNoteId).toBe('remote-b');
    expect(store.getState().serverData.notes.map(note => note.id)).toEqual(['remote-b']);
    expect(navigate).toHaveBeenCalledExactlyOnceWith('/materials/notes/remote-b');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('保留已有导航 Guard：被阻止时不改变选中项或读取未知详情', async () => {
    const { api, store, navigate } = setup();
    await screen.findByRole('heading', { name: '笔记工作台' });
    const removeGuard = registerNavigationGuard(() => false);
    try {
      const before = store.getState().navigation;
      const { dialog } = await searchAndSelect();
      expect(await within(dialog).findByRole('alert')).toHaveTextContent('请先保存或放弃当前更改');
      expect(store.getState().navigation).toBe(before);
      expect(api.getNote).not.toHaveBeenCalled();
      expect(navigate).not.toHaveBeenCalled();
    } finally { removeGuard(); }
  });

  it('详情完成与选择之间出现新资料快照时，不把已失效笔记打开为空页面', async () => {
    const { store, navigate } = setup();
    await screen.findByRole('heading', { name: '笔记工作台' });
    const load = store.getState().loadCommandNote;
    store.setState({ loadCommandNote: async input => {
      const result = await load(input);
      store.setState(state => ({ serverData: { ...state.serverData, notes: [] } }));
      return result;
    } });
    const { dialog } = await searchAndSelect();
    await waitFor(() => expect(within(dialog).queryByText('正在载入笔记…')).not.toBeInTheDocument());
    expect(navigate).not.toHaveBeenCalled();
    expect(store.getState().navigation.selectedNoteId).toBeNull();
    expect(store.getState().serverData.notes).toEqual([]);
  });
});

function createWorkspaceApiStub(overrides: { notes?: Array<Record<string, unknown>> } = {}): WorkspaceApi {
  const defaultNote = {
    id: 'note-1',
    spaceId: 'space-1',
    title: 'Note',
    folderId: 'folder-1',
    tagIds: [],
    internalLinks: [],
    rawMarkdown: '',
    contentLoaded: false,
    favorite: false,
    deleted: false
  };
  const notes = overrides.notes !== undefined ? overrides.notes : [defaultNote];
  return {
    listKnowledgeItems: vi.fn().mockResolvedValue([]),
    listTrainingAssets: vi.fn().mockResolvedValue([]),
    listKnowledgeSpaces: vi.fn().mockResolvedValue([{ id: 'space-1', name: 'Main' }]),
    createDefaultKnowledgeSpace: vi.fn().mockResolvedValue({ id: 'space-1', name: 'Main' }),
    loadWorkspaceResources: vi.fn().mockResolvedValue({
      folderTree: [{ id: 'folder-1', name: 'Folder', parentId: null, children: [] }],
      notes,
      tags: []
    }),
    searchNoteIds: vi.fn().mockResolvedValue([]),
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
    createTag: vi.fn(), updateTag: vi.fn(), deleteTag: vi.fn(), mergeTags: vi.fn(), reorderTags: vi.fn(),
    createTagGroup: vi.fn(), updateTagGroup: vi.fn(), deleteTagGroup: vi.fn(),
    deleteNotes: vi.fn().mockResolvedValue([]),
    assignTagToNotes: vi.fn().mockResolvedValue([]),
    updateTagsForNotes: vi.fn().mockResolvedValue([]),
    queryNotes: vi.fn().mockResolvedValue({ items: notes, hasNext: false }),
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
    inspectAttachmentDeletion: vi.fn().mockResolvedValue({ asset: { type: 'attachment', id: 'attachment-1' }, decision: 'can-purge-no-history', references: [], reasonCodes: [], coverage: { persistedCurrentAndHistory: true } }),
    verifyNoteAttachment: vi.fn(),
    restoreNoteAttachment: vi.fn(),
    listAttachmentCleanup: vi.fn().mockResolvedValue({ items: [], pending: 0 }),
    retryAttachmentCleanup: vi.fn().mockResolvedValue({ completed: 0, pending: 0 }),
    deleteNoteAttachment: vi.fn().mockResolvedValue({ id: 'attachment-1' }),
    updateFolder: vi.fn().mockResolvedValue({ id: 'folder-1' }),
    deleteFolder: vi.fn().mockResolvedValue([]),
    emptyRecycleBin: vi.fn().mockResolvedValue({ deletedCount: 0 })
  };
}
