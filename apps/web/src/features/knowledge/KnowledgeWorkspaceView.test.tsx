import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Annotation, KnowledgeEvidence, KnowledgeItem } from '@study-accelerator/web-core';
import { canNavigate } from '../../app/navigationGuard';
import { flushBeforeWorkspaceBackup, flushBeforeWorkspaceRestore } from '../../app/desktopLifecycle';
import { CreateKnowledgeCandidateDialog } from './CreateKnowledgeCandidateDialog';
import { KnowledgeWorkspaceView, type KnowledgeWorkspaceViewProps } from './KnowledgeWorkspaceView';
import { getKnowledgeDraftScope, knowledgeDraftRecovery } from './knowledgeDraftRecovery';
const trainingRead = vi.hoisted(() => ({ listTrainingAssets: vi.fn().mockResolvedValue([]) }));
vi.mock('../../store/AppStoreProvider', () => ({ useAppStore: (select: (state: unknown) => unknown) => select({ ...trainingRead, dataMode: 'api', persistenceMode: 'remote', knowledgeGeneration: 0, canWriteWorkspace: () => false }) }));

afterEach(async () => { await knowledgeDraftRecovery.flush(); sessionStorage.clear(); delete window.knowraDesktop; });

const candidate: KnowledgeItem = { id: 'k1', title: '数据增强', canonicalStatement: '通过变换样本扩充训练数据。', userExplanation: '用于训练阶段。', knowledgeType: 'concept', importance: null, reviewStatus: 'candidate', sourceMode: 'annotation', createdAt: '2026-09-21T10:00:00.000Z', updatedAt: '2026-09-21T10:00:00.000Z', deletedAt: null };
const archived: KnowledgeItem = { ...candidate, id: 'k2', title: '已归档的观点', reviewStatus: 'archived' };
const evidence: KnowledgeEvidence = { id: 'e1', knowledgeItemId: 'k1', sourceType: 'annotation', annotationId: 'a1', noteId: 'n1', noteVersionId: 'v1', sourceId: 'a1', quoteText: '样本变换', headingPath: ['样本操作'], relationType: 'supports', status: 'valid', createdAt: candidate.createdAt, updatedAt: candidate.updatedAt };
function props(overrides: Partial<KnowledgeWorkspaceViewProps> = {}): KnowledgeWorkspaceViewProps {
  return { selectedItemId: 'k1', canWrite: true, notes: [], onSelectItem: vi.fn(), onOpenNote: vi.fn(), onList: vi.fn().mockResolvedValue([candidate, archived]), onGet: vi.fn().mockResolvedValue(candidate), onListEvidence: vi.fn().mockResolvedValue([evidence]), onListAnnotations: vi.fn().mockResolvedValue([]), onCreateEvidence: vi.fn().mockResolvedValue(evidence), onRetireEvidence: vi.fn().mockResolvedValue({ item: candidate, evidence: { ...evidence, status: 'invalid' } }), onCreate: vi.fn().mockResolvedValue({ item: candidate, evidence: [evidence] }), onUpdate: vi.fn().mockResolvedValue(candidate), onConfirm: vi.fn().mockResolvedValue({ ...candidate, reviewStatus: 'confirmed', updatedAt: '2026-09-21T11:00:00.000Z' }), onArchive: vi.fn().mockResolvedValue({ ...candidate, reviewStatus: 'archived' }), onRestore: vi.fn().mockResolvedValue(candidate), onTrash: vi.fn().mockResolvedValue({ ...candidate, deletedAt: '2026-09-23T00:00:00.000Z' }), onRestoreDeleted: vi.fn().mockResolvedValue(candidate), ...overrides };
}

describe('KnowledgeWorkspaceView', () => {
  it('空库加载完成后，按工具栏范围唯一定位同名新建入口并打开候选对话框', async () => {
    const user = userEvent.setup();
    const input = props({ selectedItemId: null, onList: vi.fn().mockResolvedValue([]) });
    render(<KnowledgeWorkspaceView {...input} />);
    const list = screen.getByRole('region', { name: '知识列表内容' });
    await within(list).findByText('还没有知识');
    expect(screen.getAllByRole('button', { name: '新建知识候选' })).toHaveLength(2);
    expect(within(list).getByRole('button', { name: '新建知识候选' })).toBeEnabled();
    const toolbar = screen.getByRole('toolbar', { name: '知识库工具栏' });
    await user.click(within(toolbar).getByRole('button', { name: '新建知识候选' }));
    expect(screen.getByRole('dialog', { name: '新建知识候选' })).toBeVisible();
    expect(screen.getByRole('textbox', { name: '标题' })).toHaveValue('');
    expect(input.onCreate).not.toHaveBeenCalled();
  });

  async function chooseStatus(user: ReturnType<typeof userEvent.setup>, name: RegExp) {
    await user.click(screen.getByRole('button', { name: '筛选' }));
    await user.click(within(await screen.findByRole('menu', { name: '知识状态' })).getByRole('menuitemradio', { name }));
    await user.keyboard('{Escape}');
  }
  async function openRowMenu(title: string) {
    const row = await within(screen.getByRole('region', { name: '知识列表内容' })).findByRole('button', { name: new RegExp(title) });
    fireEvent.contextMenu(row, { clientX: 100, clientY: 100 });
    return screen.findByRole('menu', { name: '知识操作' });
  }
  it.each([null, 'k2'])('未选中或选择其他条目时归档失败保留对话框，重试成功有反馈：%s', async selectedItemId => {
    const user = userEvent.setup();
    const onArchive = vi.fn().mockRejectedValueOnce(new Error('归档连接失败')).mockResolvedValue({ ...candidate, reviewStatus: 'archived' });
    const input = props({ selectedItemId, onArchive, onGet: vi.fn().mockResolvedValue(archived) });
    render(<KnowledgeWorkspaceView {...input} />);
    await user.click(within(await openRowMenu(candidate.title)).getByRole('menuitem', { name: '归档' }));
    await user.click(screen.getByRole('button', { name: '确认归档' }));
    const dialog = screen.getByRole('dialog', { name: '归档这条知识？' });
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('归档连接失败');
    expect(input.onSelectItem).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole('button', { name: '确认归档' }));
    expect(await screen.findByText('知识已归档。')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(onArchive).toHaveBeenNthCalledWith(2, candidate.id, { expectedUpdatedAt: candidate.updatedAt });
    if (selectedItemId) expect(screen.getByRole('heading', { name: archived.title })).toBeInTheDocument();
  });
  it.each([null, 'k2'])('回收站失败保留原版本重试，选择：%s', async selectedItemId => {
    const user = userEvent.setup();
    const onTrash = vi.fn().mockRejectedValueOnce(new Error('回收失败')).mockResolvedValue({ ...candidate, deletedAt: candidate.updatedAt });
    render(<KnowledgeWorkspaceView {...props({ selectedItemId, onTrash, onGet: vi.fn().mockResolvedValue(archived) })} />);
    await user.click(within(await openRowMenu(candidate.title)).getByRole('menuitem', { name: '移入回收站' }));
    await user.click(screen.getByRole('button', { name: '确认移入回收站' }));
    const dialog = screen.getByRole('dialog', { name: '移入知识回收站？' });
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('回收失败');
    await user.click(within(dialog).getByRole('button', { name: '确认移入回收站' }));
    expect(await screen.findByText('知识已移入回收站。')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(onTrash).toHaveBeenNthCalledWith(2, candidate.id, { expectedUpdatedAt: candidate.updatedAt });
  });
  it('归档菜单关闭重开、查看和恢复保持稳定身份，失败和成功均可见', async () => {
    const user = userEvent.setup();
    const onRestore = vi.fn().mockRejectedValueOnce(new Error('恢复失败')).mockResolvedValue({ ...archived, reviewStatus: 'candidate' });
    const input = props({ selectedItemId: null, onRestore });
    render(<KnowledgeWorkspaceView {...input} />);
    await chooseStatus(user, /已归档/);
    await openRowMenu(archived.title);
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('menu', { name: '知识操作' })).not.toBeInTheDocument());
    await user.click(within(await openRowMenu(archived.title)).getByRole('menuitem', { name: '查看详情' }));
    expect(input.onSelectItem).toHaveBeenCalledWith(archived.id);
    await user.click(within(await openRowMenu(archived.title)).getByRole('menuitem', { name: '恢复为候选' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('恢复失败');
    await user.click(within(await openRowMenu(archived.title)).getByRole('menuitem', { name: '恢复为候选' }));
    expect(await screen.findByText('已恢复为候选，请重新核对后确认。')).toBeInTheDocument();
    await chooseStatus(user, /全部未归档/);
    expect(within(await openRowMenu(archived.title)).getByRole('menuitem', { name: '归档' })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(onRestore).toHaveBeenNthCalledWith(2, archived.id, { expectedUpdatedAt: archived.updatedAt });
  });
  it('只读菜单禁用所有写入，查看和 Escape 仍可用', async () => {
    const user = userEvent.setup();
    const input = props({ selectedItemId: null, canWrite: false });
    render(<KnowledgeWorkspaceView {...input} />);
    const menu = await openRowMenu(candidate.title);
    for (const name of ['编辑', '归档', '移入回收站']) expect(within(menu).getByRole('menuitem', { name })).toHaveAttribute('aria-disabled', 'true');
    await user.keyboard('{Escape}');
    await chooseStatus(user, /已归档/);
    expect(within(await openRowMenu(archived.title)).getByRole('menuitem', { name: '恢复为候选' })).toHaveAttribute('aria-disabled', 'true');
    await user.click(screen.getByRole('menuitem', { name: '查看详情' }));
    expect(input.onSelectItem).toHaveBeenCalledWith(archived.id);
    expect(input.onRestore).not.toHaveBeenCalled();
  });
  it('失败对话框取消后重开不残留旧错误', async () => {
    const user = userEvent.setup();
    render(<KnowledgeWorkspaceView {...props({ selectedItemId: null, onTrash: vi.fn().mockRejectedValue(new Error('回收失败')) })} />);
    await user.click(within(await openRowMenu(candidate.title)).getByRole('menuitem', { name: '移入回收站' }));
    await user.click(screen.getByRole('button', { name: '确认移入回收站' }));
    await screen.findByRole('alert');
    await user.click(screen.getByRole('button', { name: '取消' }));
    await user.click(within(await openRowMenu(candidate.title)).getByRole('menuitem', { name: '移入回收站' }));
    expect(screen.getByRole('dialog', { name: '移入知识回收站？' })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
  it('回收站和全部未归档通过筛选菜单选择，关闭后列表可继续操作', async () => {
    const user = userEvent.setup();
    const deleted = { ...candidate, id: 'deleted', title: '回收站知识', deletedAt: candidate.updatedAt };
    const input = props({ selectedItemId: null, onList: vi.fn().mockResolvedValue([candidate, deleted]) });
    render(<KnowledgeWorkspaceView {...input} />);
    const toolbar = screen.getByRole('toolbar', { name: '知识库工具栏' });
    const list = screen.getByRole('region', { name: '知识列表内容' });
    await within(list).findByRole('button', { name: /数据增强/ });
    for (const [filter, title] of [[/^回收站/, /回收站知识/], [/^全部未归档/, /数据增强/]]) {
      await user.click(within(toolbar).getByRole('button', { name: '筛选' }));
      const menu = await screen.findByRole('menu', { name: '知识状态' });
      const option = within(menu).getByRole('menuitemradio', { name: filter });
      await user.click(option);
      expect(option).toHaveAttribute('aria-checked', 'true');
      await user.keyboard('{Escape}');
      await waitFor(() => expect(screen.queryByRole('menu', { name: '知识状态' })).not.toBeInTheDocument());
      await user.click(within(list).getByRole('button', { name: title }));
    }
    expect(input.onSelectItem).toHaveBeenNthCalledWith(1, deleted.id);
    expect(input.onSelectItem).toHaveBeenNthCalledWith(2, candidate.id);
  });
  it('旧条目写入成功后更新列表及版本，但不覆盖新选择的详情', async () => {
    const user = userEvent.setup();
    let resolve!: (item: KnowledgeItem) => void;
    const input = props({ onConfirm: vi.fn().mockReturnValue(new Promise<KnowledgeItem>(done => { resolve = done; })) });
    const view = render(<KnowledgeWorkspaceView {...input} />);
    await user.click(await screen.findByRole('button', { name: '确认知识' }));
    vi.mocked(input.onGet).mockResolvedValue(archived);
    view.rerender(<KnowledgeWorkspaceView {...input} selectedItemId="k2" />);
    await screen.findByRole('heading', { name: archived.title });
    const updated = { ...candidate, title: '确认后的数据增强', reviewStatus: 'confirmed' as const, updatedAt: '2026-10-02T00:00:00Z' };
    await act(async () => resolve(updated));
    expect(screen.getByText('已确认这条知识。')).toBeInTheDocument();
    const detailPanel = within(screen.getByRole('region', { name: '知识详情面板' }));
    expect(detailPanel.getByRole('heading', { name: archived.title })).toBeInTheDocument();
    expect(detailPanel.queryByRole('heading', { name: updated.title })).not.toBeInTheDocument();
    expect(detailPanel.queryByText('已确认这条知识。')).not.toBeInTheDocument();
    expect(input.onSelectItem).not.toHaveBeenCalled();
    await user.click(within(await openRowMenu(updated.title)).getByRole('menuitem', { name: '归档' }));
    await user.click(screen.getByRole('button', { name: '确认归档' }));
    expect(input.onArchive).toHaveBeenCalledWith(candidate.id, { expectedUpdatedAt: updated.updatedAt });
    expect(detailPanel.getByRole('heading', { name: archived.title })).toBeInTheDocument();
  });
  it('旧条目的写入结果只更新目标和全局反馈，不覆盖新选择的详情', async () => {
    const user = userEvent.setup();
    let reject!: (cause: Error) => void;
    const input = props({ onConfirm: vi.fn().mockReturnValue(new Promise((_resolve, fail) => { reject = fail; })) });
    const view = render(<KnowledgeWorkspaceView {...input} />);
    await user.click(await screen.findByRole('button', { name: '确认知识' }));
    vi.mocked(input.onGet).mockResolvedValue(archived);
    view.rerender(<KnowledgeWorkspaceView {...input} selectedItemId="k2" />);
    await screen.findByRole('heading', { name: archived.title });
    await act(async () => reject(new Error('旧条目失败')));
    expect(screen.getByRole('alert')).toHaveTextContent('数据增强');
    expect(within(screen.getByRole('region', { name: '知识详情面板' })).queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: archived.title })).toBeInTheDocument();
  });

  it('列表与详情滚动区支持键盘聚焦，选中条目仍独立标识', async () => {
    const user = userEvent.setup();
    const input = props();
    render(<KnowledgeWorkspaceView {...input} />);
    const list = screen.getByRole('region', { name: '知识列表内容' });
    const detail = screen.getByRole('region', { name: '知识详情面板' });
    const selected = await within(list).findByRole('button', { name: /数据增强/ });
    await screen.findByRole('heading', { name: '数据增强' });
    expect(list).toHaveAttribute('tabindex', '0');
    expect(detail).toHaveAttribute('tabindex', '0');
    expect(selected).toHaveAttribute('aria-current', 'true');
    act(() => list.focus());
    expect(list).toHaveFocus();
    await user.tab();
    expect(within(list).getByRole('button', { expanded: true })).toHaveFocus();
    await user.tab();
    expect(selected).toHaveFocus();
    await user.tab();
    expect(detail).toHaveFocus();
    expect(input.onSelectItem).not.toHaveBeenCalled();
  });
  const trashed = { ...candidate, sourceMode: 'manual' as const, deletedAt: candidate.updatedAt };
  const purgePreview = { asset: { type: 'knowledgeItem' as const, id: 'k1' }, decision: 'can-purge-no-history' as const, expectedUpdatedAt: candidate.updatedAt, expectedDatasetEpoch: 'original-epoch', confirmationToken: 'original-token', exclusiveRecords: { knowledgeEvidenceIds: [], knowledgeArtifactProvenanceIds: [] }, references: [], coverage: { persistedCurrentAndHistory: true, runningTasks: 'verified', offlineDevices: 'pending', backups: 'retained' } };
  it('联网知识清理使用原预检凭据，云端已清理但本地恢复分支不会假称消失', async () => {
    const input = props({ authoritativePurge: true, onList: vi.fn().mockResolvedValue([trashed]), onGet: vi.fn().mockResolvedValue(trashed), onInspectPurge: vi.fn().mockResolvedValue(purgePreview), onPermanentDelete: vi.fn().mockResolvedValue({ status: 'subject-purged', asset: purgePreview.asset, localState: 'recovery-required' }) });
    render(<KnowledgeWorkspaceView {...input} />);
    await userEvent.click(await screen.findByRole('button', { name: '永久删除…' }));
    await userEvent.click(screen.getByRole('button', { name: '确认永久删除' }));
    expect(input.onPermanentDelete).toHaveBeenCalledWith('k1', { expectedUpdatedAt: candidate.updatedAt, expectedDatasetEpoch: 'original-epoch', confirmationToken: 'original-token' });
    expect(await screen.findByText(/云端清理已确认；本地新修改仍保存在/)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: candidate.title })).toBeInTheDocument();
  });
  it('未知清理结果保留对象并禁止重发，完成同步后只读核对删除事实', async () => {
    const input = props({ authoritativePurge: true, onList: vi.fn().mockResolvedValue([trashed]), onGet: vi.fn().mockResolvedValue(trashed), onInspectPurge: vi.fn().mockResolvedValue(purgePreview), onPermanentDelete: vi.fn().mockRejectedValue(Object.assign(new Error('响应丢失'), { code: 'SYNC_NETWORK_UNAVAILABLE' })), onPurgeStatus: vi.fn().mockResolvedValue({ pending: null, result: { status: 'subject-purged', asset: purgePreview.asset, localState: 'synchronized' } }) });
    render(<KnowledgeWorkspaceView {...input} />);
    await userEvent.click(await screen.findByRole('button', { name: '永久删除…' }));
    await userEvent.click(screen.getByRole('button', { name: '确认永久删除' }));
    expect(await screen.findByText(/清理结果待核对，原件已保留/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '确认永久删除' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: '核对清理结果' }));
    expect(input.onPermanentDelete).toHaveBeenCalledTimes(1);
    expect(input.onPurgeStatus).toHaveBeenCalledTimes(2);
    expect(await screen.findByText(/本机已收到删除事实/)).toBeInTheDocument();
  });
  it('筛选知识状态、搜索正文，展示来源并打开笔记', async () => {
    const user = userEvent.setup(); const input = props();
    render(<KnowledgeWorkspaceView {...input} />);
    const list = screen.getByRole('region', { name: '知识列表' });
    const chooseStatus = async (name: RegExp) => {
      await user.click(screen.getByRole('button', { name: '筛选' }));
      await user.click(within(await screen.findByRole('menu', { name: '知识状态' })).getByRole('menuitemradio', { name }));
      await user.keyboard('{Escape}');
    };
    await within(list).findByRole('button', { name: /数据增强/ });
    expect(within(list).queryByRole('button', { name: /已归档的观点/ })).not.toBeInTheDocument();
    expect(input.onList).toHaveBeenCalledWith({ includeArchived: true, includeDeleted: true });
    await chooseStatus(/已归档/);
    expect(within(list).getByRole('button', { name: /已归档的观点/ })).toBeInTheDocument();
    expect(within(list).queryByRole('button', { name: /数据增强/ })).not.toBeInTheDocument();
    await chooseStatus(/全部未归档/);
    await user.type(screen.getByRole('searchbox', { name: '搜索知识' }), '不存在的知识');
    expect(within(list).getByText('没有符合条件的知识。')).toBeInTheDocument();
    await user.clear(screen.getByRole('searchbox', { name: '搜索知识' }));
    await user.type(screen.getByRole('searchbox', { name: '搜索知识' }), '变换样本');
    expect(within(list).getByRole('button', { name: /数据增强/ })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: '知识来源' })).toHaveTextContent('样本变换');
    await user.click(screen.getByRole('button', { name: '打开来源笔记' }));
    expect(input.onOpenNote).toHaveBeenCalledWith('n1');
  });

  it('确认和编辑都携带读取时的版本，显式保存后显示待修订', async () => {
    const user = userEvent.setup();
    const input = props({ onUpdate: vi.fn().mockResolvedValue({ ...candidate, canonicalStatement: '更完整的陈述', reviewStatus: 'needsRevision' }) });
    render(<KnowledgeWorkspaceView {...input} />);
    await user.click(await screen.findByRole('button', { name: '确认知识' }));
    expect(input.onConfirm).toHaveBeenCalledWith('k1', { expectedUpdatedAt: candidate.updatedAt });
    await screen.findByText('已确认这条知识。');
    await user.click(screen.getByRole('button', { name: '编辑' }));
    await user.clear(screen.getByRole('textbox', { name: '核心陈述' }));
    await user.type(screen.getByRole('textbox', { name: '核心陈述' }), '更完整的陈述');
    expect(canNavigate()).toBe(false);
    await user.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '编辑知识' })).not.toBeInTheDocument());
    expect(input.onUpdate).toHaveBeenCalledWith('k1', expect.objectContaining({ canonicalStatement: '更完整的陈述', expectedUpdatedAt: '2026-09-21T11:00:00.000Z' }));
    expect(screen.getByText('正文或来源已变化，请重新核对后确认。')).toBeInTheDocument();
    expect(canNavigate()).toBe(true);
  });

  it('归档先确认，恢复回到候选', async () => {
    const user = userEvent.setup(); const input = props();
    render(<KnowledgeWorkspaceView {...input} />);
    await user.click(await screen.findByRole('button', { name: '归档' }));
    expect(input.onArchive).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: '确认归档' }));
    await user.click(await screen.findByRole('button', { name: '恢复为候选' }));
    expect(input.onArchive).toHaveBeenCalledWith('k1', { expectedUpdatedAt: candidate.updatedAt });
    expect(input.onRestore).toHaveBeenCalledWith('k1', { expectedUpdatedAt: candidate.updatedAt });
    expect(await screen.findByText('已恢复为候选，请重新核对后确认。')).toBeInTheDocument();
  });

  it('知识进入回收站后可按原身份恢复并继续查看历史来源', async () => {
    const user = userEvent.setup(); const input = props();
    render(<KnowledgeWorkspaceView {...input} />);
    await user.click(await screen.findByRole('button', { name: '移入回收站' }));
    expect(screen.getByRole('dialog', { name: '移入知识回收站？' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '确认移入回收站' }));
    await waitFor(() => expect(input.onTrash).toHaveBeenCalledWith('k1', { expectedUpdatedAt: candidate.updatedAt }));
    expect(await screen.findByRole('button', { name: '从回收站恢复' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: '知识来源' })).toHaveTextContent('样本变换');
    await user.click(screen.getByRole('button', { name: '从回收站恢复' }));
    await waitFor(() => expect(input.onRestoreDeleted).toHaveBeenCalledWith('k1', { expectedUpdatedAt: expect.any(String) }));
  });

  it('来源标注取消后明确标示历史摘录的原标注已移除', async () => {
    render(<KnowledgeWorkspaceView {...props({ onListEvidence: vi.fn().mockResolvedValue([{ ...evidence, sourceAnnotationRemoved: true }]) })} />);
    expect(await screen.findByText('原标注已移除')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: '知识来源' })).toHaveTextContent('样本变换');
  });

  it('桌面只读原因可见，所有知识写入都禁用', async () => {
    render(<KnowledgeWorkspaceView {...props({ canWrite: false, readOnlyReason: '桌面端知识写入与同步尚未开放。' })} />);
    expect(screen.getByText('桌面端知识写入与同步尚未开放。')).toBeInTheDocument();
    expect(within(screen.getByRole('toolbar', { name: '知识库工具栏' })).getByRole('button', { name: '新建知识候选' })).toBeDisabled();
    expect(await screen.findByRole('button', { name: '确认知识' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '编辑' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '归档' })).toBeDisabled();
  });

  it('来源失效的候选不能确认，编辑冲突保留表单输入', async () => {
    const user = userEvent.setup();
    const input = props({ onListEvidence: vi.fn().mockResolvedValue([{ ...evidence, status: 'stale' }]), onUpdate: vi.fn().mockRejectedValue(Object.assign(new Error('Conflict'), { code: 'KNOWLEDGE_ITEM_UPDATE_CONFLICT' })) });
    render(<KnowledgeWorkspaceView {...input} />);
    expect(await screen.findByRole('button', { name: '确认知识' })).toBeDisabled();
    expect(screen.getByText('当前没有可用来源，暂不能确认。请在来源笔记中核对标注，再从有效标注建立候选。')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '编辑' }));
    await user.type(screen.getByRole('textbox', { name: '我的解释' }), '新补充');
    await user.click(screen.getByRole('button', { name: '保存' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('本次输入已保留');
    expect(screen.getByRole('textbox', { name: '我的解释' })).toHaveValue('用于训练阶段。新补充');
    expect(canNavigate()).toBe(false);
  });

  it('可从笔记重点追加、替换和移除来源，并保留旧来源记录', async () => {
    const user = userEvent.setup();
    const sourceNote = { id: 'n1', title: '来源笔记', folderId: null, tagIds: [], internalLinks: [], rawMarkdown: '', contentLoaded: true, favorite: false, deleted: false };
    const replacement = { id: 'a2', noteId: 'n1', noteVersionId: 'v2', revision: 2, quoteText: '新的来源摘录', headingPath: ['新章节'], lifecycleStatus: 'active', anchorStatus: 'resolved' } as Annotation;
    const input = props({ notes: [sourceNote], onListAnnotations: vi.fn().mockResolvedValue([replacement]) });
    render(<KnowledgeWorkspaceView {...input} />);
    await screen.findByText('样本变换');

    await user.click(screen.getByRole('button', { name: '添加来源' }));
    await user.click(await screen.findByRole('radio', { name: /新章节/ }));
    await user.click(screen.getByRole('button', { name: '添加来源' }));
    await waitFor(() => expect(input.onCreateEvidence).toHaveBeenCalledWith('k1', expect.objectContaining({ annotationId: 'a2', expectedAnnotationRevision: 2 })));

    await user.click(screen.getByRole('button', { name: '更换来源' }));
    await user.click(await screen.findByRole('radio', { name: /新章节/ }));
    await user.click(screen.getByRole('button', { name: '确认更换' }));
    await waitFor(() => expect(input.onRetireEvidence).toHaveBeenCalledWith('k1', 'e1', { expectedUpdatedAt: evidence.updatedAt }));

    await user.click(screen.getByRole('button', { name: '撤回适用性' }));
    await user.click(screen.getByRole('button', { name: '确认移除' }));
    await waitFor(() => expect(input.onRetireEvidence).toHaveBeenCalledTimes(2));
  });

  it('后返回的旧详情不能覆盖新选择，加载错误可重试', async () => {
    let finishOld!: (item: KnowledgeItem) => void;
    const oldRequest = new Promise<KnowledgeItem>(resolve => { finishOld = resolve; });
    const input = props({ onGet: vi.fn().mockReturnValueOnce(oldRequest).mockRejectedValueOnce(new Error('加载暂时失败')).mockResolvedValue(archived) });
    const { rerender } = render(<KnowledgeWorkspaceView {...input} />);
    rerender(<KnowledgeWorkspaceView {...input} selectedItemId="k2" />);
    expect(await screen.findByRole('alert')).toHaveTextContent('加载暂时失败');
    await userEvent.click(screen.getByRole('button', { name: '重新加载知识' }));
    await screen.findByRole('heading', { name: '已归档的观点' });
    await act(async () => finishOld(candidate));
    expect(screen.queryByRole('heading', { name: '数据增强' })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '已归档的观点' })).toBeInTheDocument();
  });

  it('本机同步刷新知识详情时保留正在编辑的输入与原 CAS；重启仍使用旧基线', async () => {
    const user = userEvent.setup();
    const input = props();
    const view = render(<KnowledgeWorkspaceView {...input} refreshKey={0} />);
    await user.click(await screen.findByRole('button', { name: '编辑' }));
    await user.type(screen.getByRole('textbox', { name: '我的解释' }), '本机未提交');
    const updated = { ...candidate, title: '另一端更新', updatedAt: '2026-09-21T12:00:00.000Z' };
    vi.mocked(input.onGet).mockResolvedValue(updated);
    view.rerender(<KnowledgeWorkspaceView {...input} refreshKey={1} />);
    await waitFor(() => expect(input.onGet).toHaveBeenCalledTimes(2));
    expect(screen.getByRole('textbox', { name: '我的解释' })).toHaveValue('用于训练阶段。本机未提交');
    await expect(flushBeforeWorkspaceRestore()).rejects.toThrow('知识表单仍有未保存');
    await expect(flushBeforeWorkspaceBackup()).resolves.toEqual({ hasUnsavedDrafts: true });
    view.unmount();
    render(<KnowledgeWorkspaceView {...input} refreshKey={2} />);
    await user.click(await screen.findByRole('button', { name: '恢复草稿：数据增强' }));
    expect(screen.getByRole('textbox', { name: '我的解释' })).toHaveValue('用于训练阶段。本机未提交');
    await user.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() => expect(input.onUpdate).toHaveBeenCalledWith('k1', expect.objectContaining({ expectedUpdatedAt: candidate.updatedAt, userExplanation: '用于训练阶段。本机未提交' })));
    await waitFor(() => expect(knowledgeDraftRecovery.list(getKnowledgeDraftScope())).toEqual([]));
  });

  it('从标注创建后异常退出，恢复保留候选 id 和原来源，不会自动确认', async () => {
    const user = userEvent.setup();
    const source = { id: 'a-old', noteVersionId: 'v-old', revision: 3, headingPath: ['旧标注标题'], quoteText: '旧摘录' } as Annotation;
    const first = render(<CreateKnowledgeCandidateDialog source={source} canWrite onClose={vi.fn()} onCreate={vi.fn()} />);
    await user.type(screen.getByRole('textbox', { name: '标题' }), '草稿补充');
    await knowledgeDraftRecovery.flush();
    const original = knowledgeDraftRecovery.list(getKnowledgeDraftScope())[0]!;
    first.unmount();
    const input = props();
    render(<KnowledgeWorkspaceView {...input} />);
    await user.click(await screen.findByRole('button', { name: '恢复草稿：旧标注标题草稿补充' }));
    expect(screen.getByRole('region', { name: '来源标注' })).toHaveTextContent('旧摘录');
    expect(input.onCreate).not.toHaveBeenCalled();
    expect(input.onConfirm).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() => expect(input.onCreate).toHaveBeenCalledWith(expect.objectContaining({ id: original.candidateId, evidence: [{ sourceType: 'annotation', annotationId: 'a-old', noteVersionId: 'v-old', expectedAnnotationRevision: 3 }] })));
    await waitFor(() => expect(knowledgeDraftRecovery.list(getKnowledgeDraftScope())).toEqual([]));
  });
});

describe('CreateKnowledgeCandidateDialog', () => {
  const source = { id: 'a1', noteVersionId: 'v1', revision: 3, headingPath: ['样本操作'], quoteText: '原文摘录', comment: '我的标注说明' } as Annotation;
  it('从标注创建候选只提交来源标识；失败保留输入，成功后再解除导航保护', async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn().mockRejectedValueOnce(new Error('暂时无法保存')).mockResolvedValue({ item: candidate, evidence: [evidence] });
    const onClose = vi.fn(); const onCreated = vi.fn(() => expect(canNavigate()).toBe(true));
    render(<CreateKnowledgeCandidateDialog source={source} canWrite onClose={onClose} onCreate={onCreate} onCreated={onCreated} />);
    expect(screen.getByRole('textbox', { name: '核心陈述' })).toHaveValue('原文摘录');
    await user.clear(screen.getByRole('textbox', { name: '标题' }));
    await user.type(screen.getByRole('textbox', { name: '标题' }), '新知识');
    await user.click(screen.getByRole('button', { name: '保存' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('暂时无法保存');
    expect(screen.getByRole('textbox', { name: '标题' })).toHaveValue('新知识');
    expect(onClose).not.toHaveBeenCalled();
    expect(canNavigate()).toBe(false);
    await user.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(candidate));
    expect(onCreate).toHaveBeenLastCalledWith({ id: expect.stringMatching(/^knowledge-/), title: '新知识', canonicalStatement: '原文摘录', userExplanation: '我的标注说明', knowledgeType: 'concept', sourceMode: 'annotation', evidence: [{ sourceType: 'annotation', annotationId: 'a1', noteVersionId: 'v1', expectedAnnotationRevision: 3 }] });
    expect(onCreate.mock.calls[0][0].id).toBe(onCreate.mock.calls[1][0].id);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('取消有修改的候选时先确认，继续编辑保留文字', async () => {
    const user = userEvent.setup(); const onClose = vi.fn();
    render(<CreateKnowledgeCandidateDialog canWrite onClose={onClose} onCreate={vi.fn()} />);
    await user.type(screen.getByRole('textbox', { name: '标题' }), '未保存候选');
    const beforeUnload = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(beforeUnload);
    expect(beforeUnload.defaultPrevented).toBe(true);
    await expect(flushBeforeWorkspaceRestore()).rejects.toThrow('知识表单仍有未保存的修改');
    await user.click(screen.getByRole('button', { name: '取消' }));
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog', { name: '放弃未保存的知识修改？' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '继续编辑' }));
    expect(screen.getByRole('textbox', { name: '标题' })).toHaveValue('未保存候选');
    await user.click(screen.getByRole('button', { name: '取消' }));
    await user.click(screen.getByRole('button', { name: '放弃修改' }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('知识提交成功但草稿删除失败时，只重试清理，不再提交旧版本', async () => {
    const disk: Record<string, unknown> = {};
    let refuseDelete = true;
    window.knowraDesktop = { onPrepareClose() {}, onCancelClose() {}, readRecoveryDrafts: () => disk,
      async writeRecoveryDraft(key, value) {
        if (value === null) { if (refuseDelete) throw new Error('磁盘暂时不可写'); delete disk[key]; }
        else disk[key] = value;
      } };
    const user = userEvent.setup();
    const onCreate = vi.fn().mockResolvedValue({ item: candidate, evidence: [] });
    const onClose = vi.fn();
    render(<CreateKnowledgeCandidateDialog canWrite onClose={onClose} onCreate={onCreate} />);
    await user.type(screen.getByRole('textbox', { name: '标题' }), '提交后的草稿');
    await user.click(screen.getByRole('button', { name: '保存' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('知识已保存，但恢复草稿清理失败');
    expect(screen.getByRole('textbox', { name: '标题' })).toBeDisabled();
    expect(onCreate).toHaveBeenCalledOnce();
    expect(onClose).not.toHaveBeenCalled();
    refuseDelete = false;
    await user.click(screen.getByRole('button', { name: '重试清理' }));
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(onCreate).toHaveBeenCalledOnce();
    expect(disk).toEqual({});
  });
});

describe('KnowledgeWorkspaceView 索引交互', () => {
  it('J/K 在条目间移动焦点，Esc 关闭检查器，右键菜单提供条目操作', async () => {
    const user = userEvent.setup();
    const second = { ...candidate, id: 'k3', title: '正则化', updatedAt: '2026-09-20T11:00:00.000Z' };
    const input = props({ onCloseItem: vi.fn(), onList: vi.fn().mockResolvedValue([candidate, second]) });
    render(<KnowledgeWorkspaceView {...input} />);
    const list = screen.getByRole('region', { name: '知识列表内容' });
    const first = await within(list).findByRole('button', { name: /数据增强/ });
    first.focus();
    await user.keyboard('j');
    expect(within(list).getByRole('button', { name: /正则化/ })).toHaveFocus();
    await user.keyboard('k');
    expect(first).toHaveFocus();
    await user.pointer({ keys: '[MouseRight]', target: within(list).getByRole('button', { name: /正则化/ }) });
    const menu = await screen.findByRole('menu', { name: '知识操作' });
    expect(within(menu).getByRole('menuitem', { name: '编辑' })).toBeInTheDocument();
    await user.click(within(menu).getByRole('menuitem', { name: '查看详情' }));
    expect(input.onSelectItem).toHaveBeenCalledWith('k3');
    first.focus();
    await user.keyboard('{Escape}');
    expect(input.onCloseItem).toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: '关闭详情' }));
    expect(input.onCloseItem).toHaveBeenCalledTimes(2);
  });
  it('显示选项切换卡片布局，未选中知识时不显示检查器', async () => {
    const user = userEvent.setup();
    render(<KnowledgeWorkspaceView {...props({ selectedItemId: null })} />);
    await within(screen.getByRole('region', { name: '知识列表内容' })).findByRole('button', { name: /数据增强/ });
    expect(screen.queryByRole('region', { name: '知识详情面板' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /显示选项/ }));
    await user.click(await screen.findByRole('button', { name: '卡片' }));
    await user.keyboard('{Escape}');
    expect(await screen.findByRole('list', { name: '知识卡片视图' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /显示选项/ }));
    await user.click(await screen.findByRole('button', { name: '列表' }));
    await user.keyboard('{Escape}');
    expect(await screen.findByRole('list', { name: '知识列表视图' })).toBeInTheDocument();
  });
});
