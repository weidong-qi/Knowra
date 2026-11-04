import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { createEmptyWorkspaceSnapshot, type KnowledgeItem, type TrainingAssetRecord, type WorkspaceApi } from '@study-accelerator/web-core';
import { createAppStore } from '../../store/createAppStore';
import type { AppStore } from '../../store/types';
import { KnowledgeLearningObjectives } from './KnowledgeLearningObjectives';
const mocked = vi.hoisted(() => ({ state: null as unknown as AppStore }));
vi.mock('../../store/AppStoreProvider', () => ({ useAppStore: (select: (state: AppStore) => unknown) => select(mocked.state) }));
const knowledge: KnowledgeItem = { id: 'k1', title: '导数', canonicalStatement: '变化率', userExplanation: '', knowledgeType: 'concept', sourceMode: 'manual', importance: null, reviewStatus: 'confirmed', createdAt: '2026-10-03T00:00:00.000Z', updatedAt: '2026-10-03T00:00:00.000Z', deletedAt: null };
const objective: TrainingAssetRecord = { id: 'o1', knowledgeItemId: 'k1', objective: '计算变化率', actionVerb: 'calculate', cognitiveLevel: 'apply', reviewStatus: 'candidate', updatedAt: knowledge.updatedAt };
function setup(list: AppStore['listTrainingAssets'], overrides: Partial<AppStore> = {}) {
  mocked.state = { dataMode: 'api', persistenceMode: 'remote', canWriteWorkspace: () => true, knowledgeGeneration: 0, listTrainingAssets: list, getKnowledgeItem: vi.fn().mockResolvedValue(knowledge), ...overrides } as unknown as AppStore;
}
describe('知识详情关联学习目标', () => {
  it.each(['missing-method', 'disconnected'] as const)('真实 slice 同步拒绝 %s 时保留错误和重试入口', async failure => {
    const read = vi.fn().mockResolvedValue([objective]);
    const api = (failure === 'missing-method' ? {} : { listTrainingAssets: read }) as WorkspaceApi;
    const store = createAppStore({ api, cacheKey: `objective-read-${failure}`, mockSnapshot: createEmptyWorkspaceSnapshot(), persistenceMode: 'remote' });
    store.setState({ dataMode: failure === 'disconnected' ? 'cache' : 'api' });
    // 组件已渲染的连接状态可能滞后于真实 slice 的即时检查。
    setup(store.getState().listTrainingAssets);
    render(<KnowledgeLearningObjectives item={knowledge} />);
    expect(await screen.findByRole('alert')).toHaveTextContent(failure === 'missing-method' ? '当前服务尚未接通训练工作域' : '资料库尚未连接');
    expect(screen.queryByText('尚无关联学习目标。')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '新建学习目标候选' })).toBeDisabled();
    expect(read).not.toHaveBeenCalled();
    api.listTrainingAssets = read;
    store.setState({ dataMode: 'api' });
    await userEvent.click(screen.getByRole('button', { name: '重试读取学习目标' }));
    expect(await screen.findByText('计算变化率')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(read).toHaveBeenCalledExactlyOnceWith('learningObjective', { includeArchived: true, includeDeleted: true });
  });
  it('切换知识后旧读取失败不覆盖当前目标或错误状态', async () => {
    let reject!: (cause: Error) => void;
    const list = vi.fn().mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail; }))
      .mockResolvedValue([{ ...objective, knowledgeItemId: 'k2', objective: '新知识目标' }]);
    setup(list);
    const view = render(<KnowledgeLearningObjectives item={knowledge} />);
    await waitFor(() => expect(list).toHaveBeenCalledTimes(1));
    view.rerender(<KnowledgeLearningObjectives item={{ ...knowledge, id: 'k2' }} />);
    await screen.findByText('新知识目标');
    await act(async () => reject(new Error('旧读取失败')));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByText('新知识目标')).toBeInTheDocument();
  });
  it.each(['resolve', 'reject'] as const)('卸载后旧请求 %s 不影响新挂载的目标状态', async outcome => {
    let resolve!: (rows: TrainingAssetRecord[]) => void;
    let reject!: (cause: Error) => void;
    const list = vi.fn().mockImplementationOnce(() => new Promise((done, fail) => { resolve = done; reject = fail; }))
      .mockResolvedValue([{ ...objective, knowledgeItemId: 'k2', objective: '重新打开的目标' }]);
    setup(list);
    const oldView = render(<KnowledgeLearningObjectives item={knowledge} />);
    await waitFor(() => expect(list).toHaveBeenCalledTimes(1));
    oldView.unmount();
    render(<KnowledgeLearningObjectives item={{ ...knowledge, id: 'k2' }} />);
    await screen.findByText('重新打开的目标');
    await act(async () => { if (outcome === 'resolve') resolve([objective]); else reject(new Error('已卸载的读取失败')); });
    expect(screen.getByText('重新打开的目标')).toBeInTheDocument();
    expect(screen.queryByText('计算变化率')).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
  it('读失败不冒充空列表；重试后显示真实关联四状态和动作层级', async () => {
    const list = vi.fn().mockRejectedValueOnce(new Error('目标读取失败')).mockResolvedValue([
      objective, { ...objective, id: 'o2', objective: '已确认目标', reviewStatus: 'confirmed' },
      { ...objective, id: 'o3', objective: '已归档目标', reviewStatus: 'archived' }, { ...objective, id: 'o4', objective: '已删除目标', deletedAt: knowledge.updatedAt },
      { ...objective, id: 'other', knowledgeItemId: 'other', objective: '其他知识目标' }
    ]); setup(list); render(<KnowledgeLearningObjectives item={knowledge} />);
    expect(screen.getByRole('status')).toHaveTextContent('正在读取关联学习目标');
    expect(await screen.findByRole('alert')).toHaveTextContent('目标读取失败'); expect(screen.queryByText('尚无关联学习目标。')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '重试读取学习目标' }));
    await screen.findByText('计算变化率'); expect(screen.getByText('待确认')).toBeInTheDocument(); expect(screen.getByText('已确认')).toBeInTheDocument(); expect(screen.getByText('已归档')).toBeInTheDocument(); expect(screen.getByText('已删除')).toBeInTheDocument();
    expect(screen.getAllByText('动作：计算 · 认知层级：应用')).toHaveLength(4); expect(screen.queryByText('其他知识目标')).not.toBeInTheDocument();
  });
  it('切换知识和资料刷新后迟到旧列表无法覆盖当前目标', async () => {
    let finish!: (rows: TrainingAssetRecord[]) => void;
    const list = vi.fn().mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })).mockResolvedValue([{ ...objective, knowledgeItemId: 'k2', objective: '新知识目标' }]); setup(list);
    const view = render(<KnowledgeLearningObjectives item={knowledge} />); view.rerender(<KnowledgeLearningObjectives item={{ ...knowledge, id: 'k2' }} />);
    await screen.findByText('新知识目标'); await act(async () => finish([objective])); expect(screen.queryByText('计算变化率')).not.toBeInTheDocument();
    list.mockResolvedValue([]); mocked.state = { ...mocked.state, knowledgeGeneration: 1 }; view.rerender(<KnowledgeLearningObjectives item={{ ...knowledge, id: 'k2' }} />);
    expect(await screen.findByText('尚无关联学习目标。')).toBeInTheDocument(); expect(screen.queryByText('新知识目标')).not.toBeInTheDocument();
  });
  it('只读工作区关联列表可检查而不能创建', async () => {
    setup(vi.fn().mockResolvedValue([objective]), { dataMode: 'api', persistenceMode: 'desktop-local', canWriteWorkspace: () => false }); render(<KnowledgeLearningObjectives item={knowledge} />);
    await screen.findByText('计算变化率'); expect(screen.getByRole('button', { name: '新建学习目标候选' })).toBeDisabled();
    const trigger = screen.getByRole('button', { name: '查看并审阅目标' }); await userEvent.click(trigger);
    await screen.findByText(/目标状态/); expect(screen.getByRole('button', { name: '确认已审阅目标' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: '关闭' })); await waitFor(() => expect(trigger).toHaveFocus());
  });
  it('桌面本地关联列表可创建并带双基线确认目标', async () => {
    const mutate = vi.fn().mockResolvedValue(objective);
    setup(vi.fn().mockResolvedValue([objective]), { persistenceMode: 'desktop-local', mutateTrainingAsset: mutate });
    render(<KnowledgeLearningObjectives item={knowledge} />); await screen.findByText('计算变化率');
    expect(screen.getByRole('button', { name: '新建学习目标候选' })).toBeEnabled();
    await userEvent.click(screen.getByRole('button', { name: '查看并审阅目标' }));
    await waitFor(() => expect(screen.getByRole('button', { name: '确认已审阅目标' })).toBeEnabled());
    await userEvent.click(screen.getByRole('button', { name: '确认已审阅目标' }));
    expect(mutate).toHaveBeenCalledWith('learningObjective', 'o1', 'confirm', { reviewBaseline: { knowledgeUpdatedAt: knowledge.updatedAt, objectiveUpdatedAt: objective.updatedAt } });
  });
  it('已打开目标时切换知识立即卸载旧审阅，不能混用新父知识与旧目标', async () => {
    const list = vi.fn().mockResolvedValue([objective]); setup(list);
    const view = render(<KnowledgeLearningObjectives item={knowledge} />); await screen.findByText('计算变化率');
    await userEvent.click(screen.getByRole('button', { name: '查看并审阅目标' })); await screen.findByText(/目标状态/);
    view.rerender(<KnowledgeLearningObjectives item={{ ...knowledge, id: 'k2', title: '第二知识' }} />);
    expect(screen.queryByRole('dialog', { name: '审阅学习目标' })).not.toBeInTheDocument();
    expect(await screen.findByText('尚无关联学习目标。')).toBeInTheDocument();
  });
});
