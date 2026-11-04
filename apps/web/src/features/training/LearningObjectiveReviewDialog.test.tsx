import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { KnowledgeItem, TrainingAssetRecord } from '@study-accelerator/web-core';
import type { AppStore } from '../../store/types';
import { LearningObjectiveReviewDialog } from './LearningObjectiveReviewDialog';
import { canNavigate } from '../../app/navigationGuard';

const mocked = vi.hoisted(() => ({ state: null as unknown as AppStore }));
vi.mock('../../store/AppStoreProvider', () => ({ useAppStore: (selector: (state: AppStore) => unknown) => selector(mocked.state) }));
const knowledge: KnowledgeItem = { id: 'k1', title: '导数', canonicalStatement: '导数表示瞬时变化率', userExplanation: '', knowledgeType: 'concept', importance: null, sourceMode: 'manual', reviewStatus: 'confirmed', createdAt: '2026-10-03T00:00:00.000Z', updatedAt: '2026-10-03T00:00:00.000Z', deletedAt: null };
const objective: TrainingAssetRecord = { id: 'o1', knowledgeItemId: 'k1', objective: '比较两函数的导数', actionVerb: 'compare', cognitiveLevel: 'analyze', reviewStatus: 'candidate', updatedAt: '2026-10-03T01:00:00.000Z' };
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(accept => { resolve = accept; }); return { promise, resolve }; }
function setup(overrides: Partial<AppStore> = {}) {
  const state = { dataMode: 'api', persistenceMode: 'remote', knowledgeGeneration: 0, canWriteWorkspace: vi.fn(() => true),
    getKnowledgeItem: vi.fn().mockResolvedValue(knowledge), listTrainingAssets: vi.fn().mockResolvedValue([objective]),
    createTrainingAsset: vi.fn().mockResolvedValue(objective), updateTrainingAsset: vi.fn().mockResolvedValue(objective), mutateTrainingAsset: vi.fn().mockResolvedValue(objective), ...overrides };
  mocked.state = state as unknown as AppStore;
  return state;
}
async function ready() { await waitFor(() => expect(screen.queryByText('正在读取审阅版本…')).not.toBeInTheDocument()); }
beforeEach(() => { setup(); });

describe('人工学习目标审阅', () => {
  it('真实字段和父知识版本可见，逐项确认带双基线并与保存分开', async () => {
    const state = setup(); const onSaved = vi.fn(); const onClose = vi.fn();
    render(<LearningObjectiveReviewDialog record={objective} knowledge={knowledge} onSaved={onSaved} onClose={onClose} />); await ready();
    expect(screen.getByRole('region', { name: '审阅的父知识' })).toHaveTextContent(knowledge.canonicalStatement);
    expect(screen.getByRole('textbox', { name: '可观察的学习目标' })).toHaveValue(objective.objective);
    expect(screen.getByRole('button', { name: /动作/ })).toHaveTextContent('比较');
    expect(screen.getByRole('button', { name: /认知层级/ })).toHaveTextContent('分析');
    await userEvent.click(screen.getByRole('button', { name: '确认已审阅目标' }));
    expect(state.mutateTrainingAsset).toHaveBeenCalledWith('learningObjective', 'o1', 'confirm', { reviewBaseline: { objectiveUpdatedAt: objective.updatedAt, knowledgeUpdatedAt: knowledge.updatedAt } });
    expect(state.updateTrainingAsset).not.toHaveBeenCalled(); expect(onSaved).toHaveBeenCalledOnce(); expect(onClose).toHaveBeenCalledOnce();
  });

  it('修改动作与层级后只能保存；完整结构与原版本发送，不自动确认', async () => {
    const state = setup(); const user = userEvent.setup();
    render(<LearningObjectiveReviewDialog record={objective} knowledge={knowledge} onSaved={vi.fn()} onClose={vi.fn()} />); await ready();
    await user.click(screen.getByRole('button', { name: /动作/ })); await user.click(screen.getByRole('option', { name: '计算' }));
    expect(screen.getByRole('button', { name: '保存候选' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: /认知层级/ })); await user.click(screen.getByRole('option', { name: '应用' }));
    expect(screen.getByRole('button', { name: '确认已审阅目标' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: '保存候选' }));
    expect(state.updateTrainingAsset).toHaveBeenCalledWith('learningObjective', 'o1', { objective: objective.objective, actionVerb: 'calculate', cognitiveLevel: 'apply', reviewBaseline: { objectiveUpdatedAt: objective.updatedAt, knowledgeUpdatedAt: knowledge.updatedAt } });
    expect(state.mutateTrainingAsset).not.toHaveBeenCalled();
  });

  it.each(['remote', 'desktop-local'] as const)('新建%s目标不硬编码解释理解，八动作四层级由用户明确选择', async mode => {
    const state = setup({ persistenceMode: mode }); const user = userEvent.setup();
    render(<LearningObjectiveReviewDialog knowledge={knowledge} onSaved={vi.fn()} onClose={vi.fn()} />); await ready();
    expect(screen.getByRole('button', { name: '保存候选' })).toBeDisabled();
    await user.type(screen.getByRole('textbox', { name: '可观察的学习目标' }), '设计变化率实验');
    await user.click(screen.getByRole('button', { name: /动作/ })); expect(screen.getAllByRole('option')).toHaveLength(8); await user.click(screen.getByRole('option', { name: '设计' }));
    await user.click(screen.getByRole('button', { name: /认知层级/ })); expect(screen.getAllByRole('option')).toHaveLength(4); await user.click(screen.getByRole('option', { name: '分析' }));
    await user.click(screen.getByRole('button', { name: '保存候选' }));
    expect(state.createTrainingAsset).toHaveBeenCalledWith('learningObjective', { knowledgeItemId: 'k1', objective: '设计变化率实验', actionVerb: 'design', cognitiveLevel: 'analyze', reviewBaseline: { knowledgeUpdatedAt: knowledge.updatedAt } });
    expect(state.mutateTrainingAsset).not.toHaveBeenCalled();
  });

  it('409保留输入和旧基线；重新读取只展示当前版本，明确采用后才能继续', async () => {
    const state = setup({ updateTrainingAsset: vi.fn().mockRejectedValue(Object.assign(new Error('版本冲突，请重新加载核对。'), { code: 'LEARNING_OBJECTIVE_UPDATE_CONFLICT' })) });
    const user = userEvent.setup(); render(<LearningObjectiveReviewDialog record={objective} knowledge={knowledge} onSaved={vi.fn()} onClose={vi.fn()} />); await ready();
    const input = screen.getByRole('textbox', { name: '可观察的学习目标' }); await user.clear(input); await user.type(input, '保留的目标草稿');
    await user.click(screen.getByRole('button', { name: '保存候选' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('原审阅版本已保留'); expect(input).toHaveValue('保留的目标草稿');
    const freshObjective = { ...objective, objective: '另一设备保存的目标', updatedAt: '2026-10-03T02:00:00.000Z' };
    vi.mocked(state.listTrainingAssets).mockResolvedValue([freshObjective]);
    await user.click(screen.getByRole('button', { name: '重新加载当前版本以核对' }));
    expect(await screen.findByRole('region', { name: '重新加载的当前版本' })).toHaveTextContent(freshObjective.objective!);
    expect(screen.getByRole('button', { name: '保存候选' })).toBeDisabled();
    expect(input).toHaveValue('保留的目标草稿'); expect(screen.getByText(/目标状态/)).toHaveTextContent(objective.updatedAt);
    await user.click(screen.getByRole('button', { name: '采用当前版本重新审阅' }));
    expect(screen.getByText(/目标状态/)).toHaveTextContent(freshObjective.updatedAt);
    expect(screen.getByRole('button', { name: '确认已审阅目标' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: '保存候选' }));
    expect(state.updateTrainingAsset).toHaveBeenLastCalledWith('learningObjective', 'o1', expect.objectContaining({ objective: '保留的目标草稿', reviewBaseline: { objectiveUpdatedAt: freshObjective.updatedAt, knowledgeUpdatedAt: knowledge.updatedAt } }));
  });

  it('知识详情已显示版本与fresh父不同，不能悄悄换父知识基线', async () => {
    setup({ getKnowledgeItem: vi.fn().mockResolvedValue({ ...knowledge, canonicalStatement: '另一设备的新陈述', updatedAt: '2026-10-03T03:00:00.000Z' }) });
    render(<LearningObjectiveReviewDialog record={objective} knowledge={knowledge} onSaved={vi.fn()} onClose={vi.fn()} />); await ready();
    expect(screen.getByRole('region', { name: '审阅的父知识' })).toHaveTextContent(knowledge.canonicalStatement);
    expect(screen.getByRole('region', { name: '重新加载的当前版本' })).toHaveTextContent('另一设备的新陈述');
    expect(screen.getByRole('button', { name: '确认已审阅目标' })).toBeDisabled();
  });
  it('含糊目标不可确认，服务端语义拒绝也转为中文并保留草稿', async () => {
    const state = setup({ listTrainingAssets: vi.fn().mockResolvedValue([{ ...objective, objective: '能够掌握导数' }]) });
    const view = render(<LearningObjectiveReviewDialog record={{ ...objective, objective: '能够掌握导数' }} knowledge={knowledge} onSaved={vi.fn()} onClose={vi.fn()} />); await ready();
    expect(screen.getByText(/不能直接确认/)).toBeInTheDocument(); expect(screen.getByRole('button', { name: '确认已审阅目标' })).toBeDisabled(); expect(state.mutateTrainingAsset).not.toHaveBeenCalled(); view.unmount();
    setup({ mutateTrainingAsset: vi.fn().mockRejectedValue(Object.assign(new Error('LearningObjective actionVerb and cognitiveLevel are incompatible'), { code: 'LEARNING_OBJECTIVE_COGNITIVE_LEVEL_MISMATCH' })) });
    render(<LearningObjectiveReviewDialog record={objective} knowledge={knowledge} onSaved={vi.fn()} onClose={vi.fn()} />); await ready(); await userEvent.click(screen.getByRole('button', { name: '确认已审阅目标' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('动作与认知层级不匹配'); expect(screen.getByRole('textbox', { name: '可观察的学习目标' })).toHaveValue(objective.objective);
  });

  it.each([{ dataMode: 'cache' as const }, { canWriteWorkspace: () => false }])('训练写门禁在只读状态%j关闭', async overrides => {
    const state = setup(overrides); render(<LearningObjectiveReviewDialog record={objective} knowledge={knowledge} onSaved={vi.fn()} onClose={vi.fn()} />); await ready();
    expect(screen.getByRole('button', { name: '保存候选' })).toBeDisabled(); expect(screen.getByRole('button', { name: '确认已审阅目标' })).toBeDisabled();
    expect(screen.getByRole('textbox', { name: '可观察的学习目标' })).toBeDisabled(); expect(state.mutateTrainingAsset).not.toHaveBeenCalled();
  });

  it('资料刷新与迟到父读取隔离，旧写入响应不能关闭新上下文', async () => {
    const firstRead = deferred<KnowledgeItem>(); const write = deferred<TrainingAssetRecord>();
    const state = setup({ getKnowledgeItem: vi.fn().mockReturnValueOnce(firstRead.promise).mockResolvedValue({ ...knowledge, title: '当前资料知识' }), mutateTrainingAsset: vi.fn().mockReturnValue(write.promise) });
    const onClose = vi.fn(); const onSaved = vi.fn(); const view = render(<LearningObjectiveReviewDialog record={objective} onClose={onClose} onSaved={onSaved} />);
    mocked.state = { ...mocked.state, knowledgeGeneration: 1 }; view.rerender(<LearningObjectiveReviewDialog record={objective} onClose={onClose} onSaved={onSaved} />); await ready();
    expect(screen.getByRole('region', { name: '审阅的父知识' })).toHaveTextContent('当前资料知识');
    await act(async () => firstRead.resolve(knowledge)); expect(screen.getByRole('region', { name: '审阅的父知识' })).toHaveTextContent('当前资料知识');
    await userEvent.click(screen.getByRole('button', { name: '重新加载当前版本以核对' })); await ready();
    await userEvent.click(screen.getByRole('button', { name: '采用当前版本重新审阅' }));
    await userEvent.click(screen.getByRole('button', { name: '确认已审阅目标' }));
    expect(state.mutateTrainingAsset).toHaveBeenCalledOnce();
    mocked.state = { ...mocked.state, canWriteWorkspace: () => false }; view.rerender(<LearningObjectiveReviewDialog record={objective} onClose={onClose} onSaved={onSaved} />);
    await act(async () => write.resolve(objective)); expect(onClose).not.toHaveBeenCalled(); expect(onSaved).not.toHaveBeenCalled();
  });

  it('卸载后的写入响应不触发父回调；未保存输入关闭前需明确放弃', async () => {
    const write = deferred<TrainingAssetRecord>(); setup({ mutateTrainingAsset: vi.fn().mockReturnValue(write.promise) });
    const onClose = vi.fn(); const onSaved = vi.fn(); const view = render(<LearningObjectiveReviewDialog record={objective} knowledge={knowledge} onClose={onClose} onSaved={onSaved} />); await ready();
    await userEvent.click(screen.getByRole('button', { name: '确认已审阅目标' })); view.unmount(); await act(async () => write.resolve(objective)); expect(onClose).not.toHaveBeenCalled(); expect(onSaved).not.toHaveBeenCalled();
    setup(); render(<LearningObjectiveReviewDialog record={objective} knowledge={knowledge} onClose={onClose} onSaved={onSaved} />); await ready();
    await userEvent.type(screen.getByRole('textbox', { name: '可观察的学习目标' }), '草稿'); await userEvent.click(screen.getByRole('button', { name: '关闭' }));
    expect(canNavigate()).toBe(false);
    const beforeUnload = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(beforeUnload); expect(beforeUnload.defaultPrevented).toBe(true);
    const discard = screen.getByRole('dialog', { name: '放弃未保存的学习目标输入？' }); expect(onClose).not.toHaveBeenCalled();
    await userEvent.click(within(discard).getByRole('button', { name: '继续编辑' })); expect(screen.getByRole('textbox', { name: '可观察的学习目标' })).toHaveValue(`${objective.objective}草稿`);
    await userEvent.click(screen.getByRole('button', { name: '关闭' })); await userEvent.click(screen.getByRole('button', { name: '放弃输入并关闭' })); expect(canNavigate()).toBe(true);
  });
});
