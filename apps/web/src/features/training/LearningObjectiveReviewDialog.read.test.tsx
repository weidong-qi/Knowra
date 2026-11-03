import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { createEmptyWorkspaceSnapshot, type KnowledgeItem, type TrainingAssetRecord, type WorkspaceApi } from '@study-accelerator/web-core';
import { AppStoreProvider } from '../../store/AppStoreProvider';
import { createAppStore } from '../../store/createAppStore';
import { canNavigate } from '../../app/navigationGuard';
import { LearningObjectiveReviewDialog } from './LearningObjectiveReviewDialog';

const knowledge: KnowledgeItem = { id: 'k1', title: '导数', canonicalStatement: '导数表示瞬时变化率', userExplanation: '', knowledgeType: 'concept', importance: null, sourceMode: 'manual', reviewStatus: 'confirmed', createdAt: '2026-10-03T00:00:00.000Z', updatedAt: '2026-10-03T00:00:00.000Z', deletedAt: null };
const objective: TrainingAssetRecord = { id: 'o1', knowledgeItemId: 'k1', objective: '比较两函数的导数', actionVerb: 'compare', cognitiveLevel: 'analyze', reviewStatus: 'candidate', updatedAt: '2026-10-03T01:00:00.000Z' };
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (cause: Error) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}
function setup(overrides: Partial<WorkspaceApi> = {}) {
  const api = { getKnowledgeItem: vi.fn().mockResolvedValue(knowledge), listTrainingAssets: vi.fn().mockResolvedValue([objective]),
    updateTrainingAsset: vi.fn().mockResolvedValue(objective), mutateTrainingAsset: vi.fn().mockResolvedValue(objective), ...overrides } as WorkspaceApi;
  const dependencies = { api, cacheKey: 'objective-review-read', mockSnapshot: createEmptyWorkspaceSnapshot(), persistenceMode: 'remote' as const };
  const store = createAppStore(dependencies);
  store.setState({ dataMode: 'api', serverData: { ...store.getState().serverData, currentSpaceId: 'space-1' } });
  const onSaved = vi.fn(); const onClose = vi.fn();
  const view = () => <AppStoreProvider dependencies={dependencies} store={store}><LearningObjectiveReviewDialog record={objective} knowledge={knowledge} onSaved={onSaved} onClose={onClose} /></AppStoreProvider>;
  return { api, store, onSaved, onClose, view };
}
async function ready() { await waitFor(() => expect(screen.queryByText('正在读取审阅版本…')).not.toBeInTheDocument()); }
function expectBlocked() {
  expect(screen.getByRole('button', { name: '保存候选' })).toBeDisabled();
  expect(screen.getByRole('button', { name: '确认已审阅目标' })).toBeDisabled();
}

describe('学习目标审阅真实 store 读取边界', () => {
  it.each(['knowledge-method', 'training-method', 'disconnected', 'missing-space'] as const)('首次同步拒绝 %s 留在弹窗并允许显式重读', async failure => {
    const state = setup(failure === 'knowledge-method' ? { getKnowledgeItem: undefined } : failure === 'training-method' ? { listTrainingAssets: undefined } : {});
    if (failure === 'disconnected') state.store.setState({ dataMode: 'cache' });
    if (failure === 'missing-space') state.store.setState({ serverData: { ...state.store.getState().serverData, currentSpaceId: null } });
    render(state.view());
    expect(await screen.findByRole('alert')).toHaveTextContent(failure === 'knowledge-method' ? '当前服务尚未接通知识管理' : failure === 'training-method' ? '当前服务尚未接通训练工作域' : '资料库尚未连接');
    await ready(); expectBlocked();
    expect(screen.getByRole('textbox', { name: '可观察的学习目标' })).toHaveValue(objective.objective);
    state.api.getKnowledgeItem = vi.fn().mockResolvedValue(knowledge);
    state.api.listTrainingAssets = vi.fn().mockResolvedValue([objective]);
    await act(async () => state.store.setState({ dataMode: 'api', serverData: { ...state.store.getState().serverData, currentSpaceId: 'space-1' } }));
    await ready();
    await userEvent.click(screen.getByRole('button', { name: '重新加载当前版本以核对' }));
    await screen.findByRole('region', { name: '重新加载的当前版本' });
    expectBlocked();
    await userEvent.click(screen.getByRole('button', { name: '采用当前版本重新审阅' }));
    expect(screen.getByRole('button', { name: '确认已审阅目标' })).toBeEnabled();
    expect(state.api.mutateTrainingAsset).not.toHaveBeenCalled();
  });

  it('输入中断连和显式重载保留草稿及旧基线，采用后才按新基线保存', async () => {
    const state = setup(); render(state.view()); await ready();
    const input = screen.getByRole('textbox', { name: '可观察的学习目标' });
    await userEvent.clear(input); await userEvent.type(input, '比较导数的草稿');
    await act(async () => state.store.setState({ dataMode: 'cache' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('资料库尚未连接');
    await ready(); expectBlocked(); expect(input).toHaveValue('比较导数的草稿');
    expect(screen.getByText(/目标状态/)).toHaveTextContent(objective.updatedAt); expect(canNavigate()).toBe(false);
    const fresh = { ...objective, objective: '另一设备的目标', updatedAt: '2026-10-03T02:00:00.000Z' };
    state.api.listTrainingAssets = vi.fn().mockResolvedValue([fresh]);
    await act(async () => state.store.setState({ dataMode: 'api' })); await ready();
    await userEvent.click(screen.getByRole('button', { name: '重新加载当前版本以核对' })); await ready();
    expect(input).toHaveValue('比较导数的草稿'); expectBlocked();
    expect(screen.getByRole('region', { name: '重新加载的当前版本' })).toHaveTextContent(fresh.objective);
    expect(screen.getByText(/目标状态/)).toHaveTextContent(objective.updatedAt);
    await userEvent.click(screen.getByRole('button', { name: '采用当前版本重新审阅' }));
    expect(input).toHaveValue('比较导数的草稿');
    expect(screen.getByRole('button', { name: '确认已审阅目标' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: '保存候选' }));
    expect(state.api.updateTrainingAsset).toHaveBeenCalledWith('learningObjective', objective.id, expect.objectContaining({ objective: '比较导数的草稿', reviewBaseline: { knowledgeUpdatedAt: knowledge.updatedAt, objectiveUpdatedAt: fresh.updatedAt } }));
    expect(state.onSaved).toHaveBeenCalledOnce(); expect(state.onClose).toHaveBeenCalledOnce();
  });

  it.each(['knowledge', 'training'] as const)('%s 分支异步失败且另一分支同步拒绝时，两支错误均受控', async asynchronous => {
    const late = deferred<KnowledgeItem | TrainingAssetRecord[]>();
    const state = setup(asynchronous === 'knowledge'
      ? { getKnowledgeItem: vi.fn().mockReturnValue(late.promise), listTrainingAssets: undefined }
      : { getKnowledgeItem: undefined, listTrainingAssets: vi.fn().mockReturnValue(late.promise) });
    render(state.view());
    expect(await screen.findByRole('alert')).toHaveTextContent(asynchronous === 'knowledge' ? '当前服务尚未接通训练工作域' : '当前服务尚未接通知识管理');
    await ready(); expectBlocked();
    expect(asynchronous === 'knowledge' ? state.api.getKnowledgeItem : state.api.listTrainingAssets).toHaveBeenCalledOnce();
    await act(async () => late.reject(new Error('另一读取的迟到失败')));
    expect(screen.getByRole('alert')).not.toHaveTextContent('另一读取的迟到失败');
  });

  it.each(['resolve', 'reject'] as const)('同步失败后重试成功，旧读取 %s 不改变当前审阅', async outcome => {
    const late = deferred<KnowledgeItem>();
    const read = vi.fn().mockReturnValueOnce(late.promise).mockResolvedValue(knowledge);
    const state = setup({ getKnowledgeItem: read, listTrainingAssets: undefined });
    render(state.view()); await screen.findByRole('alert'); await ready();
    state.api.listTrainingAssets = vi.fn().mockResolvedValue([objective]);
    await userEvent.click(screen.getByRole('button', { name: '重新加载当前版本以核对' }));
    await screen.findByRole('region', { name: '重新加载的当前版本' });
    await userEvent.click(screen.getByRole('button', { name: '采用当前版本重新审阅' }));
    await act(async () => { if (outcome === 'resolve') late.resolve({ ...knowledge, title: '迟到的父知识' }); else late.reject(new Error('迟到的读取失败')); });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('region', { name: '审阅的父知识' })).toHaveTextContent(knowledge.title);
    expect(screen.queryByText('迟到的父知识')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '确认已审阅目标' })).toBeEnabled();
  });

  it.each(['resolve', 'reject'] as const)('刷新后旧读取 %s 不提前结束新读取或发布旧版本', async outcome => {
    const oldRead = deferred<KnowledgeItem>(); const currentRead = deferred<KnowledgeItem>();
    const state = setup({ getKnowledgeItem: vi.fn().mockReturnValueOnce(oldRead.promise).mockReturnValueOnce(currentRead.promise) });
    render(state.view()); await waitFor(() => expect(state.api.getKnowledgeItem).toHaveBeenCalledOnce());
    await act(async () => state.store.setState({ knowledgeGeneration: 1 }));
    await waitFor(() => expect(state.api.getKnowledgeItem).toHaveBeenCalledTimes(2));
    await act(async () => { if (outcome === 'resolve') oldRead.resolve({ ...knowledge, title: '旧上下文父知识' }); else oldRead.reject(new Error('旧上下文失败')); });
    expect(screen.getByText('正在读取审阅版本…')).toBeInTheDocument(); expectBlocked();
    expect(screen.queryByText('旧上下文父知识')).not.toBeInTheDocument();
    expect(screen.queryByText('旧上下文失败')).not.toBeInTheDocument();
    await act(async () => currentRead.resolve({ ...knowledge, title: '当前父知识', updatedAt: '2026-10-03T03:00:00.000Z' }));
    await ready(); expectBlocked();
    expect(screen.getByRole('region', { name: '重新加载的当前版本' })).toHaveTextContent('当前父知识');
    expect(state.onSaved).not.toHaveBeenCalled(); expect(state.onClose).not.toHaveBeenCalled();
  });

  it.each(['resolve', 'reject'] as const)('卸载时仍等待的双读取 %s 不影响新审阅', async outcome => {
    const late = deferred<KnowledgeItem>();
    const state = setup({ getKnowledgeItem: vi.fn().mockReturnValueOnce(late.promise).mockResolvedValue(knowledge) });
    const old = render(state.view()); await waitFor(() => expect(state.api.getKnowledgeItem).toHaveBeenCalledOnce()); old.unmount();
    render(state.view()); await ready();
    await act(async () => { if (outcome === 'resolve') late.resolve({ ...knowledge, title: '卸载的父知识' }); else late.reject(new Error('卸载的读取失败')); });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument(); expect(screen.queryByText('卸载的父知识')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '确认已审阅目标' })).toBeEnabled();
    expect(state.onSaved).not.toHaveBeenCalled(); expect(state.onClose).not.toHaveBeenCalled();
  });
});
