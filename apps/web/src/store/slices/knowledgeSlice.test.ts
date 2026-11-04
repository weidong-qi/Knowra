import { describe, expect, it, vi } from 'vitest';
import { createEmptyWorkspaceSnapshot, type WorkspaceApi } from '@study-accelerator/web-core';
import { createAppStore } from '../createAppStore';

function fixture(persistenceMode: 'remote' | 'desktop-local' = 'remote') {
  const api = { createKnowledgeCandidate: vi.fn().mockResolvedValue({ item: { id: 'k' }, evidence: [] }), listKnowledgeItems: vi.fn().mockResolvedValue([]) };
  const store = createAppStore({ api: api as unknown as WorkspaceApi, cacheKey: 'knowledge-test', mockSnapshot: createEmptyWorkspaceSnapshot(), persistenceMode });
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
