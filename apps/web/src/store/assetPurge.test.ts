import { describe, expect, it, vi } from 'vitest';
import { createEmptyWorkspaceSnapshot, type WorkspaceApi } from '@study-accelerator/web-core';
import { createAppStore } from './createAppStore';
import { workspaceCapabilities } from './workspaceCapabilities';
import { purgeConfirmation } from './assetPurge';

const confirmation = { expectedUpdatedAt: '2026-10-03T00:00:00Z', expectedDatasetEpoch: 'original-epoch', confirmationToken: 'original-token' };
function fixture(mode: 'remote' | 'desktop-local' = 'desktop-local') {
  const api = { permanentlyDeleteKnowledgeItem: vi.fn(), purgeTrainingAsset: vi.fn() };
  const store = createAppStore({ api: api as unknown as WorkspaceApi, cacheKey: 'purge-guard', mockSnapshot: createEmptyWorkspaceSnapshot(), persistenceMode: mode });
  store.setState(state => ({ dataMode: 'api', serverData: { ...state.serverData, currentSpaceId: 'space-demo' } }));
  return { store, api };
}
describe('联网资产清理专用能力', () => {
  it('专用能力不会同时开放笔记等通用永久删除', () => {
    const local = workspaceCapabilities('desktop-local');
    expect(local.permanentDelete).toBe(false); expect(local.purgeKnowledge).toBe(true); expect(local.purgeTraining).toBe(true);
  });
  it('桌面知识和训练确认完整转交同一份预检凭据', async () => {
    const { api, store } = fixture();
    await store.getState().permanentlyDeleteKnowledgeItem('k1', confirmation);
    await store.getState().purgeTrainingAsset('question', 'q1', confirmation);
    expect(api.permanentlyDeleteKnowledgeItem).toHaveBeenCalledWith('k1', confirmation);
    expect(api.purgeTrainingAsset).toHaveBeenCalledWith('question', 'q1', confirmation);
    expect(purgeConfirmation({ ...confirmation, ...{ decision: 'can-purge-no-history' } })).toEqual(confirmation);
  });
  it('桌面仅有时间戳或缺少预检token/epoch时拦截，Web旧时间戳调用仍兼容', async () => {
    const { store, api } = fixture();
    expect(() => store.getState().permanentlyDeleteKnowledgeItem('k1', { expectedUpdatedAt: confirmation.expectedUpdatedAt })).toThrow('重新联网预检');
    expect(() => store.getState().purgeTrainingAsset('question', 'q1', confirmation.expectedUpdatedAt)).toThrow('重新联网预检');
    expect(api.purgeTrainingAsset).not.toHaveBeenCalled();
    const web = fixture('remote'); await web.store.getState().purgeTrainingAsset('question', 'q1', confirmation.expectedUpdatedAt);
    expect(web.api.purgeTrainingAsset).toHaveBeenCalledWith('question', 'q1', confirmation.expectedUpdatedAt);
  });
  it.each(['cache', 'readonly'] as const)('%s模式不能借专用能力越过写入门禁', mode => {
    const { store, api } = fixture();
    store.setState(mode === 'cache' ? { dataMode: 'cache' } : { canWriteWorkspace: () => false });
    expect(() => store.getState().permanentlyDeleteKnowledgeItem('k1', confirmation)).toThrow();
    expect(() => store.getState().purgeTrainingAsset('question', 'q1', confirmation)).toThrow();
    expect(api.permanentlyDeleteKnowledgeItem).not.toHaveBeenCalled(); expect(api.purgeTrainingAsset).not.toHaveBeenCalled();
  });
});
