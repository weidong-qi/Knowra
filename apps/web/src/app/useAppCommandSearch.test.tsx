import type { PropsWithChildren } from 'react';
import { act, renderHook } from '@testing-library/react';
import { createEmptyWorkspaceSnapshot, normalizeNotes, type WorkspaceApi } from '@study-accelerator/web-core';
import { AppStoreProvider } from '../store/AppStoreProvider';
import { createAppStore } from '../store/createAppStore';
import { registerNavigationGuard } from './navigationGuard';
import { useAppCommandSearch } from './useAppCommandSearch';

const context = { isCurrent: () => true };
const note = normalizeNotes([{ id: 'note/1', spaceId: 'space-1', title: '当前笔记', folderId: null, rawMarkdown: '正文' }])[0];
const hit = { id: note.id, title: note.title, folderId: note.folderId, snippet: '正文' };

function setup() {
  const api = { searchCommandNotes: vi.fn().mockResolvedValue([]) } as unknown as WorkspaceApi;
  const dependencies = { api, cacheKey: 'synthetic-app-command-search', mockSnapshot: createEmptyWorkspaceSnapshot(),
    storage: { getItem: () => null, setItem: () => undefined } };
  const store = createAppStore(dependencies);
  store.setState(state => ({ dataMode: 'api', workspaceLoadState: 'ready', serverData: {
    ...state.serverData, currentSpaceId: 'space-1', spaces: [{ id: 'space-1' }], notes: [note],
    tags: [{ id: 'tag-1', spaceId: 'space-1', name: '当前标签', color: 'blue' }]
  } }));
  const onSelect = vi.fn();
  const wrapper = ({ children }: PropsWithChildren) => <AppStoreProvider store={store} dependencies={dependencies}>{children}</AppStoreProvider>;
  const hook = renderHook(({ pathname }) => useAppCommandSearch({ pathname, onSelect }), {
    wrapper, initialProps: { pathname: '/' }
  });
  return { ...hook, store, onSelect };
}

describe('应用命令搜索适配边界', () => {
  it('仅投影当前空间存活笔记与有名标签，提交选择后再请求导航/宣告', () => {
    const { result, store, onSelect } = setup();
    act(() => store.setState(state => ({ serverData: { ...state.serverData,
      notes: [note, { ...note, id: 'deleted', deleted: true }, { ...note, id: 'other', spaceId: 'space-2' }],
      tags: [...state.serverData.tags, { id: 'empty', spaceId: 'space-1', name: '', color: 'blue' },
        { id: 'other-tag', spaceId: 'space-2', name: '别的标签', color: 'blue' }]
    } })));
    expect(result.current.hits.map(item => item.id)).toEqual(['action:home', 'note:note/1', 'tag:tag-1']);
    onSelect.mockImplementation((announcement, path) => {
      if (path.includes('/notes/')) expect(store.getState().navigation).toMatchObject({ selectedNoteId: note.id, selectedFolderId: null });
      if (announcement.includes('标签')) expect(store.getState().notesIndex.selectedTagId).toBe('tag-1');
    });
    act(() => { result.current.hits[1].onSelect(context); });
    expect(onSelect).toHaveBeenLastCalledWith('已打开笔记“当前笔记”', '/materials/notes/note%2F1');
    act(() => { result.current.hits[2].onSelect(context); });
    expect(onSelect).toHaveBeenLastCalledWith('已按标签“当前标签”筛选笔记', '/materials');
    act(() => { result.current.hits[0].onSelect(context); });
    expect(onSelect).toHaveBeenLastCalledWith('已返回主页', '/');
  });

  it('搜索 scope 仅跟随既有空间/世代/模式/加载状态依赖，路径变化由选择守卫处理', () => {
    const { result, store, rerender } = setup();
    let key = result.current.commandSearch!.scopeKey;
    rerender({ pathname: '/materials' });
    expect(result.current.commandSearch!.scopeKey).toBe(key);
    act(() => store.setState({ saveError: '不影响搜索范围' }));
    expect(result.current.commandSearch!.scopeKey).toBe(key);
    const changes = [
      () => store.setState(state => ({ serverData: { ...state.serverData, currentSpaceId: 'space-2' } })),
      () => store.setState(state => ({ serverData: { ...state.serverData, spaces: [...state.serverData.spaces] } })),
      () => store.setState(state => ({ knowledgeGeneration: state.knowledgeGeneration + 1 })),
      () => store.setState({ dataMode: 'cache' }),
      () => store.setState({ workspaceLoadState: 'loading' })
    ];
    for (const change of changes) {
      act(change);
      expect(result.current.commandSearch!.scopeKey).not.toBe(key);
      key = result.current.commandSearch!.scopeKey;
    }
  });

  it('完整详情回执通过后先更新领域/目录/笔记选择，再请求导航与宣告', async () => {
    const { result, store, onSelect } = setup();
    const load = vi.fn(async () => ({ note, snapshot: store.getState().serverData }));
    store.setState({ loadCommandNote: load });
    onSelect.mockImplementation(() => expect(store.getState().navigation).toMatchObject({
      activeWorkDomain: 'materials', selectedFolderId: null, selectedNoteId: note.id, openNoteTabs: [note.id]
    }));
    await act(async () => {
      expect(await result.current.commandSearch!.onSelect(hit, context)).toBe(true);
    });
    expect(load).toHaveBeenCalledExactlyOnceWith({ noteId: note.id, spaceId: 'space-1', isCurrent: expect.any(Function) });
    expect(onSelect).toHaveBeenCalledExactlyOnceWith('已打开笔记“当前笔记”', '/materials/notes/note%2F1');
  });

  it.each(['pathname', 'navigation', 'snapshot', 'cancel'] as const)('详情等待中 %s 变化保留原有身份屏障', async change => {
    const { result, store, rerender, onSelect } = setup();
    const snapshot = store.getState().serverData;
    let resolve!: () => void;
    let current = true;
    const ready = new Promise<void>(done => { resolve = done; });
    store.setState({ loadCommandNote: async () => { await ready; return { note, snapshot }; } });
    const opening = result.current.commandSearch!.onSelect(hit, { isCurrent: () => current });
    if (change === 'pathname') rerender({ pathname: '/settings' });
    if (change === 'navigation') act(() => store.setState(state => ({ navigation: { ...state.navigation } })));
    if (change === 'snapshot') act(() => store.setState({ serverData: { ...snapshot } }));
    if (change === 'cancel') current = false;
    await act(async () => { resolve(); expect(await opening).toBe(false); });
    expect(onSelect).not.toHaveBeenCalled();
    expect(store.getState().navigation.selectedNoteId).toBeNull();
  });

  it('第二次导航守卫仍在详情完成后、选择写入前执行', async () => {
    const { result, store, onSelect } = setup();
    const guard = vi.fn().mockReturnValueOnce(true).mockReturnValue(false);
    const remove = registerNavigationGuard(guard);
    store.setState({ loadCommandNote: async () => ({ note, snapshot: store.getState().serverData }) });
    try {
      await expect(result.current.commandSearch!.onSelect(hit, context)).rejects.toThrow('请先保存或放弃当前更改');
      expect(guard).toHaveBeenCalledTimes(2);
      expect(store.getState().navigation.selectedNoteId).toBeNull();
      expect(onSelect).not.toHaveBeenCalled();
    } finally { remove(); }
  });
});
