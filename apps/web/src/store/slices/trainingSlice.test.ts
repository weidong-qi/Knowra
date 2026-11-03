import { describe, expect, it, vi } from 'vitest';
import { createEmptyWorkspaceSnapshot, type WorkspaceApi } from '@study-accelerator/web-core';
import { createAppStore } from '../createAppStore';
function fixture(mode: 'remote' | 'desktop-local' = 'remote') {
  const api = { createTrainingAsset: vi.fn(), updateTrainingAsset: vi.fn(), mutateTrainingAsset: vi.fn(), listTrainingAssets: vi.fn().mockResolvedValue([]), inspectTrainingAssetPurge: vi.fn(), purgeTrainingAsset: vi.fn() };
  const store = createAppStore({ api: api as unknown as WorkspaceApi, cacheKey: 'objective-review', mockSnapshot: createEmptyWorkspaceSnapshot(), persistenceMode: mode });
  store.setState(state => ({ dataMode: 'api', serverData: { ...state.serverData, currentSpaceId: 'space-demo' } }));
  return { api, store };
}
describe('训练目标写入门禁与审阅基线', () => {
  it('未提供审阅基线的既有题目操作和旧目标确认保持三参数调用', async () => {
    const { api, store } = fixture();
    await store.getState().mutateTrainingAsset('question', 'q1', 'trash');
    expect(api.mutateTrainingAsset).toHaveBeenNthCalledWith(1, 'question', 'q1', 'trash');
    expect(api.mutateTrainingAsset.mock.calls[0]).toHaveLength(3);
    await store.getState().mutateTrainingAsset('learningObjective', 'o1', 'confirm');
    expect(api.mutateTrainingAsset).toHaveBeenNthCalledWith(2, 'learningObjective', 'o1', 'confirm');
    expect(api.mutateTrainingAsset.mock.calls[1]).toHaveLength(3);
  });
  it.each(['cache', 'loading'] as const)('%s不能借知识写入能力确认目标', mode => {
    const { api, store } = fixture('desktop-local'); store.setState({ dataMode: mode });
    expect(() => store.getState().mutateTrainingAsset('learningObjective', 'o1', 'confirm', { reviewBaseline: { knowledgeUpdatedAt: '2026-10-03T00:00:00.000Z', objectiveUpdatedAt: '2026-10-03T01:00:00.000Z' } })).toThrow(); expect(api.mutateTrainingAsset).not.toHaveBeenCalled();
    expect(() => store.getState().createTrainingAsset('learningObjective', {})).toThrow(); expect(api.createTrainingAsset).not.toHaveBeenCalled();
  });
  it.each(['remote', 'desktop-local'] as const)('可写%s完整转交基线，读取含归档与回收站', async mode => {
    const { api, store } = fixture(mode); const input = { reviewBaseline: { knowledgeUpdatedAt: '2026-10-03T00:00:00.000Z', objectiveUpdatedAt: '2026-10-03T01:00:00.000Z' } };
    await store.getState().mutateTrainingAsset('learningObjective', 'o1', 'confirm', input); expect(api.mutateTrainingAsset).toHaveBeenCalledWith('learningObjective', 'o1', 'confirm', input);
    expect(api.mutateTrainingAsset.mock.calls[0]).toHaveLength(4);
    await store.getState().listTrainingAssets('learningObjective'); expect(api.listTrainingAssets).toHaveBeenCalledWith('learningObjective', { includeArchived: true, includeDeleted: true });
  });
});

describe('桌面训练资产人工操作能力', () => {
  it.each(['learningObjective', 'examProfile', 'examFocus', 'question'] as const)('%s可创建编辑归档删除恢复', async kind => {
    const { api, store } = fixture('desktop-local');
    const input = { name: '人工资产' };
    await store.getState().createTrainingAsset(kind, input);
    await store.getState().updateTrainingAsset(kind, 'asset1', input);
    expect(api.createTrainingAsset).toHaveBeenCalledWith(kind, input);
    expect(api.updateTrainingAsset).toHaveBeenCalledWith(kind, 'asset1', input);
    for (const action of ['archive', 'restore', 'trash', 'restore-deleted'] as const) {
      await store.getState().mutateTrainingAsset(kind, 'asset1', action);
      expect(api.mutateTrainingAsset).toHaveBeenLastCalledWith(kind, 'asset1', action);
    }
  });
  it('桌面允许专用联网预检，缺少原确认凭据不能永久清理训练资产', async () => {
    const { api, store } = fixture('desktop-local');
    await store.getState().inspectTrainingAssetPurge('question', 'q1');
    expect(() => store.getState().purgeTrainingAsset('question', 'q1', '2026-10-03T00:00:00.000Z')).toThrow(/永久清理/);
    expect(api.inspectTrainingAssetPurge).toHaveBeenCalledWith('question', 'q1');
    expect(api.purgeTrainingAsset).not.toHaveBeenCalled();
  });
});
