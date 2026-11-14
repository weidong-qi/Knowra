import { describe, expect, it, vi } from 'vitest';
import { createEmptyWorkspaceSnapshot, type WorkspaceApi } from '@study-accelerator/web-core';
import { createAppStore } from '../createAppStore';

function fixture(persistenceMode: 'remote' | 'desktop-local' = 'remote') {
  const api = {
    createKnowledgeCandidate: vi.fn().mockResolvedValue({ item: { id: 'k' }, evidence: [] }),
    listKnowledgeItems: vi.fn().mockResolvedValue([])
  };
  const store = createAppStore({
    api: api as unknown as WorkspaceApi,
    cacheKey: 'knowledge-test',
    mockSnapshot: createEmptyWorkspaceSnapshot(),
    persistenceMode
  });
  store.setState(state => ({ dataMode: 'api', serverData: { ...state.serverData, currentSpaceId: 'space-demo' } }));
  return { api, store };
}
const input = { title: '注意力', canonicalStatement: '根据相关程度加权。', sourceMode: 'manual' as const };

describe('knowledge write boundary', () => {
  it('persists desktop knowledge through the local API', async () => {
    const { api, store } = fixture('desktop-local');
    await store.getState().createKnowledgeCandidate(input);
    expect(api.createKnowledgeCandidate).toHaveBeenCalledWith(input);
  });
  it('prevents writes from recovery cache and keeps the note save state intact', () => {
    const { api, store } = fixture();
    store.setState({ dataMode: 'cache', saveState: 'error', editorSaveError: '正文保存失败' });
    expect(() => store.getState().createKnowledgeCandidate(input)).toThrow('尚未连接');
    expect(api.createKnowledgeCandidate).not.toHaveBeenCalled();
    expect(store.getState().editorSaveError).toBe('正文保存失败');
  });
  it('includes archived items for filtering and persists through the shared API', async () => {
    const { api, store } = fixture();
    await store.getState().listKnowledgeItems();
    expect(api.listKnowledgeItems).toHaveBeenCalledWith({ includeArchived: true });
    await store.getState().createKnowledgeCandidate(input);
    expect(api.createKnowledgeCandidate).toHaveBeenCalledWith(input);
  });
});

it('从笔记创建候选后使共享列表失效，迟到的旧列表不能覆盖新记录', async () => {
  const { store, api } = fixture();
  const { createKnowledgeLibraryCache } = await import('../../features/knowledge/library/knowledgeLibraryCache');
  const oldItem = { id: 'old', title: '旧知识' } as import('@study-accelerator/web-core').KnowledgeItem;
  const candidate = { id: 'k', title: '笔记新候选' } as import('@study-accelerator/web-core').KnowledgeItem;
  let finish!: (items: import('@study-accelerator/web-core').KnowledgeItem[]) => void;
  api.listKnowledgeItems.mockImplementationOnce(
    () =>
      new Promise(resolve => {
        finish = resolve;
      })
  );
  api.listKnowledgeItems.mockResolvedValue([oldItem, candidate]);
  const cache = createKnowledgeLibraryCache(
    () => store.getState().listKnowledgeItems(),
    () => store.getState().knowledgeGeneration
  );
  const loading = cache.list();
  await store.getState().createKnowledgeCandidate({
    ...input,
    sourceMode: 'selection',
    evidence: [{ sourceType: 'noteVersion', noteId: 'n', noteVersionId: 'v', quoteText: '引用内容' }]
  });
  expect(store.getState().knowledgeGeneration).toBe(1);
  finish([oldItem]);
  await loading;
  expect(cache.getState().items).toEqual([oldItem, candidate]);
  expect(api.listKnowledgeItems).toHaveBeenCalledTimes(2);
  // 返回知识库/再次打开挂靠列表时，已完成的旧缓存也必须重新读取。
  await store.getState().createKnowledgeCandidate(input);
  await cache.list();
  expect(api.listKnowledgeItems).toHaveBeenCalledTimes(3);
});

it('失败创建或跨空间的迟到成功不推进当前空间 generation', async () => {
  const { api, store } = fixture();
  api.createKnowledgeCandidate.mockRejectedValueOnce(new Error('创建失败'));
  await expect(store.getState().createKnowledgeCandidate(input)).rejects.toThrow('创建失败');
  expect(store.getState().knowledgeGeneration).toBe(0);
  let finish!: (value: { item: { id: string }; evidence: never[] }) => void;
  api.createKnowledgeCandidate.mockImplementationOnce(
    () =>
      new Promise(resolve => {
        finish = resolve;
      })
  );
  const pending = store.getState().createKnowledgeCandidate(input);
  store.setState(state => ({ serverData: { ...state.serverData, currentSpaceId: 'other' } }));
  finish({ item: { id: 'k' }, evidence: [] });
  await pending;
  expect(store.getState().knowledgeGeneration).toBe(0);
});

it('知识与证据的所有变更入口统一推进 generation', async () => {
  const mutate = vi.fn().mockResolvedValue({});
  const api = {
    createKnowledgeEvidence: mutate,
    retireKnowledgeEvidence: mutate,
    readoptKnowledgeEvidence: mutate,
    updateKnowledgeItem: mutate,
    confirmKnowledgeItem: mutate,
    archiveKnowledgeItem: mutate,
    restoreKnowledgeItem: mutate,
    trashKnowledgeItem: mutate,
    restoreDeletedKnowledgeItem: mutate
  };
  const store = createAppStore({
    api: api as unknown as WorkspaceApi,
    cacheKey: 'mutations',
    mockSnapshot: createEmptyWorkspaceSnapshot()
  });
  store.setState(state => ({ dataMode: 'api', serverData: { ...state.serverData, currentSpaceId: 'space-demo' } }));
  const state = store.getState();
  const revision = { expectedUpdatedAt: '2026-11-13' };
  const actions = [
    () => state.createKnowledgeEvidence('k', { sourceType: 'manual' }),
    () => state.retireKnowledgeEvidence('k', 'e', revision),
    () => state.readoptKnowledgeEvidence('k', 'e', revision),
    () => state.updateKnowledgeItem('k', { ...revision, title: '新标题' }),
    () => state.confirmKnowledgeItem('k', revision),
    () => state.archiveKnowledgeItem('k', revision),
    () => state.restoreKnowledgeItem('k', revision),
    () => state.trashKnowledgeItem('k', revision),
    () => state.restoreDeletedKnowledgeItem('k', revision)
  ];
  for (const [index, action] of actions.entries()) {
    await action();
    expect(store.getState().knowledgeGeneration).toBe(index + 1);
  }
});
