import { createEmptyWorkspaceSnapshot, type CommandNoteSearchHit, type WorkspaceApi } from '@study-accelerator/web-core';
import { createAppStore } from './createAppStore';

describe('store 的命令正文能力', () => {
  it('旧 API 宿主可省略命令能力，不改变索引页 ID 搜索', () => {
    const searchNoteIds = vi.fn();
    const store = createAppStore({ api: { searchNoteIds } as unknown as WorkspaceApi,
      cacheKey: 'synthetic', mockSnapshot: createEmptyWorkspaceSnapshot() });
    expect(store.getState().searchCommandNotes).toBeUndefined();
  });

  it('按最新当前空间绑定请求，并拒绝飞行中换空间的结果', async () => {
    let resolve!: (hits: CommandNoteSearchHit[]) => void;
    const searchCommandNotes = vi.fn().mockImplementation(() => new Promise(yes => { resolve = yes; }));
    const store = createAppStore({ api: { searchCommandNotes } as unknown as WorkspaceApi,
      cacheKey: 'synthetic', mockSnapshot: createEmptyWorkspaceSnapshot() });
    store.setState(state => ({ serverData: { ...state.serverData, currentSpaceId: 'space-a' } }));
    const search = store.getState().searchCommandNotes!;
    await expect(search({ query: '正文', spaceId: 'space-b' })).rejects.toThrow('空间已切换');
    expect(searchCommandNotes).not.toHaveBeenCalled();
    const result = search({ query: '中文', spaceId: 'space-a' });
    expect(searchCommandNotes).toHaveBeenCalledExactlyOnceWith({ query: '中文', spaceId: 'space-a' });
    store.setState(state => ({ serverData: { ...state.serverData, currentSpaceId: 'space-b' } }));
    resolve([{ id: 'old', title: '合成旧资料', folderId: null, snippet: '中文' }]);
    await expect(result).rejects.toThrow('空间已切换');
  });
});
