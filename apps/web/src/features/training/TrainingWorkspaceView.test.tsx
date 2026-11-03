import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppStore } from '../../store/types';
import type { TrainingAssetRecord } from '@study-accelerator/web-core';
import { TrainingWorkspaceView } from './TrainingWorkspaceView';
import { createAppStore } from '../../store/createAppStore';
import { createEmptyWorkspaceSnapshot, type AuthoritativePurgeStatus, type WorkspaceApi } from '@study-accelerator/web-core';

const mocked = vi.hoisted(() => ({ state: null as unknown as AppStore, navigate: vi.fn() }));
vi.mock('../../store/AppStoreProvider', () => ({ useAppStore: (selector: (state: AppStore) => unknown) => selector(mocked.state) }));
vi.mock('../../app/router', () => ({ useNavigate: () => mocked.navigate }));

const question: TrainingAssetRecord = { id: 'q1', stem: '解释导数', questionType: 'shortAnswer', reviewStatus: 'draft', referenceAnswer: '切线斜率', learningObjectiveIds: ['o1'],
  updatedAt: '2026-10-02T00:00:00Z', sources: [{ id: 's1', sourceType: 'learningObjective', sourceId: 'o1', quote: '旧目标摘录', status: 'stale' }] };
const objective = { id: 'o1', objective: '解释导数的含义', reviewStatus: 'confirmed', updatedAt: question.updatedAt };

function setup(overrides: Partial<AppStore> = {}) {
  let questions = [question];
  const state = { dataMode: 'api', persistenceMode: 'remote', knowledgeGeneration: 0, canWriteWorkspace: vi.fn(() => true),
    listTrainingAssets: vi.fn(async (kind: string) => kind === 'question' ? questions : kind === 'learningObjective' ? [objective] : []),
    listKnowledgeItems: vi.fn().mockResolvedValue([]), getKnowledgeItem: vi.fn(), listKnowledgeEvidence: vi.fn(), getNoteVersion: vi.fn(),
    createTrainingAsset: vi.fn(), updateTrainingAsset: vi.fn(async (_kind, id, input) => { questions = questions.map(item => item.id === id ? { ...item, ...input } : item); }),
    mutateTrainingAsset: vi.fn(async (_kind, id) => { questions = questions.map(item => item.id === id ? { ...item, reviewStatus: 'archived' } : item); }),
    inspectTrainingAssetPurge: vi.fn(), purgeTrainingAsset: vi.fn(), ...overrides };
  mocked.state = state as unknown as AppStore;
  return state;
}
beforeEach(() => { mocked.navigate.mockReset(); });

describe('训练工作台详情流程', () => {
  it('搜索使用共享清除按钮，清空后恢复题目列表且不留下重复入口', async () => {
    setup();
    const user = userEvent.setup();
    render(<TrainingWorkspaceView />);
    await screen.findByRole('heading', { name: question.stem });
    const search = screen.getByRole('searchbox', { name: '搜索题目' });
    expect(screen.queryByRole('button', { name: '清除搜索' })).not.toBeInTheDocument();
    await user.type(search, '不匹配的搜索');
    expect(screen.queryByRole('heading', { name: question.stem })).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: '清除搜索' })).toHaveLength(1);
    await user.click(screen.getByRole('button', { name: '清除搜索' }));
    expect(search).toHaveValue('');
    expect(search).toHaveFocus();
    await user.type(search, '再搜索');
    await user.tab();
    expect(screen.getByRole('button', { name: '清除搜索' })).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(search).toHaveValue('');
    expect(search).toHaveFocus();
    expect(await screen.findByRole('heading', { name: question.stem })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '清除搜索' })).not.toBeInTheDocument();
  });

  const purgePreview = { asset: { type: 'question' as const, id: 'q1' }, decision: 'can-purge-no-history' as const, expectedUpdatedAt: question.updatedAt, expectedDatasetEpoch: 'original-epoch', confirmationToken: 'original-token', references: [], exclusiveRecords: {}, coverage: { runningTasks: 'verified' } };
  function localStatusStore(readStatus = vi.fn().mockResolvedValue({ pending: { type: 'question', id: 'q1' }, result: null })) {
    const store = createAppStore({ api: { getAuthoritativePurgeStatus: readStatus } as unknown as WorkspaceApi, cacheKey: 'training-purge-status-test', mockSnapshot: createEmptyWorkspaceSnapshot(), persistenceMode: 'desktop-local' });
    store.setState({ dataMode: 'loading' });
    return { store, readStatus, connect() { store.setState(state => ({ dataMode: 'api', serverData: { ...state.serverData, currentSpaceId: 'local-space' } })); } };
  }
  it('首次桌面加载不读取未连接状态，连接API后恢复待核对保护', async () => {
    const local = localStatusStore();
    const state = setup({ dataMode: 'loading', persistenceMode: 'desktop-local', getAuthoritativePurgeStatus: local.store.getState().getAuthoritativePurgeStatus });
    const view = render(<TrainingWorkspaceView />);
    expect(screen.getByRole('alert')).toHaveTextContent('资料库尚未连接');
    expect(local.readStatus).not.toHaveBeenCalled();
    local.connect(); mocked.state = { ...mocked.state, dataMode: 'api' };
    view.rerender(<TrainingWorkspaceView />);
    expect(await screen.findByRole('button', { name: '核对清理结果' })).toBeEnabled();
    expect(screen.getByText(/清理结果待核对，原件已保留/)).toBeInTheDocument();
    expect(local.readStatus).toHaveBeenCalledTimes(1);
    expect(state.purgeTrainingAsset).not.toHaveBeenCalled();
  });
  it('同步连接getter失败不会崩溃，重新连接后仍恢复待核对状态', async () => {
    const local = localStatusStore();
    local.store.setState({ dataMode: 'api' }); // 无currentSpaceId，真实slice getter同步拒绝。
    setup({ persistenceMode: 'desktop-local', getAuthoritativePurgeStatus: local.store.getState().getAuthoritativePurgeStatus });
    const view = render(<TrainingWorkspaceView />);
    expect(await screen.findByRole('heading', { name: question.stem })).toBeInTheDocument();
    expect(local.readStatus).not.toHaveBeenCalled();
    mocked.state = { ...mocked.state, dataMode: 'loading' }; view.rerender(<TrainingWorkspaceView />);
    local.connect(); mocked.state = { ...mocked.state, dataMode: 'api' }; view.rerender(<TrainingWorkspaceView />);
    expect(await screen.findByRole('button', { name: '核对清理结果' })).toBeEnabled();
    expect(local.readStatus).toHaveBeenCalledTimes(1);
  });
  it('离开API模式后旧状态响应不能覆盖重新连接的清理状态', async () => {
    let finish!: (status: AuthoritativePurgeStatus) => void;
    const readStatus = vi.fn().mockImplementationOnce(() => new Promise<AuthoritativePurgeStatus>(resolve => { finish = resolve; })).mockResolvedValue({ pending: null, result: null });
    const local = localStatusStore(readStatus); local.connect();
    setup({ persistenceMode: 'desktop-local', getAuthoritativePurgeStatus: local.store.getState().getAuthoritativePurgeStatus });
    const view = render(<TrainingWorkspaceView />);
    await waitFor(() => expect(readStatus).toHaveBeenCalledTimes(1));
    local.store.setState({ dataMode: 'cache' }); mocked.state = { ...mocked.state, dataMode: 'cache' }; view.rerender(<TrainingWorkspaceView />);
    await act(async () => finish({ pending: { type: 'question', id: 'q1' }, result: null }));
    local.connect(); mocked.state = { ...mocked.state, dataMode: 'api' }; view.rerender(<TrainingWorkspaceView />);
    await waitFor(() => expect(readStatus).toHaveBeenCalledTimes(2));
    await screen.findByRole('heading', { name: question.stem });
    expect(screen.queryByRole('button', { name: '核对清理结果' })).not.toBeInTheDocument();
    expect(screen.queryByText(/清理结果待核对，原件已保留/)).not.toBeInTheDocument();
  });
  it('桌面回收站题目可联网预检清理，原凭据确认且恢复分支仍显示', async () => {
    const state = setup({ persistenceMode: 'desktop-local', listTrainingAssets: vi.fn(async kind => kind === 'question' ? [{ ...question, deletedAt: question.updatedAt }] : []), inspectTrainingAssetPurge: vi.fn().mockResolvedValue(purgePreview), purgeTrainingAsset: vi.fn().mockResolvedValue({ status: 'subject-purged', asset: purgePreview.asset, localState: 'recovery-required' }) });
    render(<TrainingWorkspaceView />); await userEvent.click(screen.getByRole('button', { name: '回收站' }));
    await userEvent.click(await screen.findByRole('button', { name: '永久清理…' }));
    await userEvent.click(screen.getByRole('button', { name: '确认永久清理' }));
    expect(state.purgeTrainingAsset).toHaveBeenCalledWith('question', 'q1', { expectedUpdatedAt: question.updatedAt, expectedDatasetEpoch: 'original-epoch', confirmationToken: 'original-token' });
    expect(await screen.findByText(/云端清理已确认；本地新修改仍保存在/)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: question.stem })).toBeInTheDocument();
  });
  it('离线预检失败保留回收站题目，确认禁用且允许显式重新预检', async () => {
    const state = setup({ persistenceMode: 'desktop-local', listTrainingAssets: vi.fn(async kind => kind === 'question' ? [{ ...question, deletedAt: question.updatedAt }] : []), inspectTrainingAssetPurge: vi.fn().mockRejectedValue(new Error('请先连接兼容的云端并完成同步')), purgeTrainingAsset: vi.fn() });
    render(<TrainingWorkspaceView />); await userEvent.click(screen.getByRole('button', { name: '回收站' }));
    await userEvent.click(await screen.findByRole('button', { name: '永久清理…' }));
    const dialog = screen.getByRole('dialog', { name: '永久清理题目？' });
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('请先连接兼容的云端');
    expect(within(dialog).getByRole('button', { name: '确认永久清理' })).toBeDisabled();
    await userEvent.click(within(dialog).getByRole('button', { name: '重新预检' }));
    expect(state.inspectTrainingAssetPurge).toHaveBeenCalledTimes(2); expect(state.purgeTrainingAsset).not.toHaveBeenCalled();
  });
  it('学习目标确认入口打开真实审阅而不直接id确认，编辑复用结构字段', async () => {
    const parent = { id: 'k1', title: '导数知识', canonicalStatement: '瞬时变化率', reviewStatus: 'confirmed', updatedAt: '2026-10-03T00:00:00.000Z' };
    const target = { ...objective, knowledgeItemId: 'k1', actionVerb: 'calculate', cognitiveLevel: 'apply', reviewStatus: 'candidate' };
    const state = setup({ listTrainingAssets: vi.fn(async kind => kind === 'learningObjective' ? [target] : []), listKnowledgeItems: vi.fn().mockResolvedValue([parent]), getKnowledgeItem: vi.fn().mockResolvedValue(parent) });
    const user = userEvent.setup(); render(<TrainingWorkspaceView />);
    await user.click(screen.getByRole('button', { name: '学习目标' }));
    await user.click(await screen.findByRole('button', { name: '确认' }));
    const dialog = screen.getByRole('dialog', { name: '审阅学习目标' });
    expect(state.mutateTrainingAsset).not.toHaveBeenCalled();
    await within(dialog).findByText('导数知识');
    expect(within(dialog).getByRole('button', { name: /动作/ })).toHaveTextContent('计算');
    expect(within(dialog).getByRole('button', { name: /认知层级/ })).toHaveTextContent('应用');
    await user.click(within(dialog).getByRole('button', { name: '确认已审阅目标' }));
    expect(state.mutateTrainingAsset).toHaveBeenCalledWith('learningObjective', 'o1', 'confirm', { reviewBaseline: { knowledgeUpdatedAt: parent.updatedAt, objectiveUpdatedAt: target.updatedAt } });
  });
  it('选择题目、对照目标、关闭归还焦点，过滤后不显示隐藏题目的详情', async () => {
    setup(); const user = userEvent.setup(); render(<TrainingWorkspaceView />);
    const open = await screen.findByRole('button', { name: '查看详情' });
    await user.click(open);
    const detail = within(screen.getByRole('article', { name: '题目详情' }));
    expect(detail.getByRole('region', { name: '参考答案' })).toHaveTextContent('切线斜率');
    await user.click(detail.getByRole('button', { name: '对照来源' }));
    const dialog = await screen.findByRole('dialog', { name: '题目来源对照' });
    expect(within(dialog).getByRole('region', { name: '编题时保存的摘录' })).toHaveTextContent('旧目标摘录');
    expect(await within(dialog).findByText('解释导数的含义')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: '关闭' }));
    await user.click(detail.getByRole('button', { name: '关闭详情' }));
    expect(open).toHaveFocus();
    await user.click(open);
    await user.type(screen.getByRole('searchbox', { name: '搜索题目' }), '不存在');
    expect(screen.queryByRole('article', { name: '题目详情' })).not.toBeInTheDocument();
  });

  it('保存后从重新加载的题目更新详情，归档后隐藏当前使用中详情', async () => {
    const state = setup(); const user = userEvent.setup(); render(<TrainingWorkspaceView />);
    await user.click(await screen.findByRole('button', { name: '查看详情' }));
    await user.click(within(screen.getByRole('region', { name: '题目列表' })).getByRole('button', { name: '编辑' }));
    const dialog = screen.getByRole('dialog', { name: '编辑题目' });
    const answer = within(dialog).getByRole('textbox', { name: '参考答案' });
    await user.clear(answer); await user.type(answer, '更新的参考答案');
    await user.click(within(dialog).getByRole('button', { name: '保存' }));
    await waitFor(() => expect(screen.getByRole('region', { name: '参考答案' })).toHaveTextContent('更新的参考答案'));
    expect(state.updateTrainingAsset).toHaveBeenCalledWith('question', 'q1', { stem: '解释导数', referenceAnswer: '更新的参考答案' });
    await user.click(within(screen.getByRole('region', { name: '题目列表' })).getByRole('button', { name: '归档' }));
    await waitFor(() => expect(screen.queryByRole('article', { name: '题目详情' })).not.toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: '已归档' }));
    await user.click(await screen.findByRole('button', { name: '查看详情' }));
    expect(screen.getByRole('article', { name: '题目详情' })).toHaveTextContent('已归档');
  });

  it('只读训练资产仍能查看详情和来源，写操作不出现', async () => {
    const state = setup({ persistenceMode: 'desktop-local', canWriteWorkspace: () => false }); render(<TrainingWorkspaceView />);
    await userEvent.click(await screen.findByRole('button', { name: '查看详情' }));
    expect(screen.getByRole('article', { name: '题目详情' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '编辑' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '新建题目' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '对照来源' }));
    expect(await screen.findByRole('dialog', { name: '题目来源对照' })).toBeInTheDocument();
    expect(state.updateTrainingAsset).not.toHaveBeenCalled();
  });

  it('桌面人工写入和回收站恢复可用，专用联网预检入口独立开放', async () => {
    const state = setup({ persistenceMode: 'desktop-local', listTrainingAssets: vi.fn(async kind => kind === 'question' ? [{ ...question, deletedAt: question.updatedAt }] : []) });
    render(<TrainingWorkspaceView />);
    expect(screen.getByRole('button', { name: '新建题目' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '回收站' }));
    await userEvent.click(await screen.findByRole('button', { name: '恢复' }));
    expect(state.mutateTrainingAsset).toHaveBeenCalledWith('question', 'q1', 'restore-deleted');
    expect(screen.getByRole('button', { name: '永久清理…' })).toBeEnabled();
    expect(state.inspectTrainingAssetPurge).not.toHaveBeenCalled();
  });

  it('结构化答案编辑不会展示可输入却被静默忽略的空白答案框', async () => {
    const state = setup({ listTrainingAssets: vi.fn(async kind => kind === 'question' ? [{ ...question, referenceAnswer: false, questionType: 'trueFalse' }] : []) });
    render(<TrainingWorkspaceView />);
    await userEvent.click(await screen.findByRole('button', { name: '编辑' }));
    const dialog = screen.getByRole('dialog', { name: '编辑题目' });
    expect(within(dialog).queryByRole('textbox', { name: '参考答案' })).not.toBeInTheDocument();
    expect(within(dialog).getByRole('region', { name: '已有参考答案' })).toHaveTextContent('否');
    await userEvent.click(within(dialog).getByRole('button', { name: '保存' }));
    await waitFor(() => expect(state.updateTrainingAsset).toHaveBeenCalledWith('question', 'q1', { stem: '解释导数' }));
  });

  it('工作区刷新后迟到的旧列表不能覆盖较新的题目', async () => {
    let finish!: (value: TrainingAssetRecord[]) => void;
    let questionReads = 0;
    setup({ listTrainingAssets: vi.fn(async kind => {
      if (kind !== 'question') return [];
      if (++questionReads === 1) return new Promise<TrainingAssetRecord[]>(resolve => { finish = resolve; });
      return [{ ...question, stem: '新版本题干' }];
    }) });
    const view = render(<TrainingWorkspaceView />);
    mocked.state = { ...mocked.state, knowledgeGeneration: 1 };
    view.rerender(<TrainingWorkspaceView />);
    await screen.findByRole('heading', { name: '新版本题干' });
    await act(async () => finish([question]));
    expect(screen.queryByRole('heading', { name: question.stem })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '新版本题干' })).toBeInTheDocument();
  });
});
