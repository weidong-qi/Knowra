import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConflictCard, EntityConflictCard } from './SyncConflictCards';
import { entityPresence, fieldValue, sameField, type Conflict, type EntityConflict } from './syncConflictModel';

const note = (rawMarkdown: string, title = '同步笔记') => ({ title, rawMarkdown, deleted: false });
const conflict: Conflict = { noteId: 'note', kind: 'edit', base: note('基线正文'), local: note('本机正文'), remote: note('云端正文', '云端改名'), remoteRevision: 3, datasetEpoch: 'epoch' };

describe('同步冲突对比', () => {
  const knowledge = { title: '删除冲突知识', canonicalStatement: '共同基线', deletedAt: null };
  const deletedKnowledge = { ...knowledge, deletedAt: '2026-10-03T01:00:00.000Z' };
  const knowledgeConflict = (base = knowledge, remote: typeof knowledge | typeof deletedKnowledge | null = deletedKnowledge): EntityConflict => ({
    id: 'knowledge-delete', changedEpoch: false, reasons: [], items: [{ collection: 'knowledgeItems', id: 'knowledge', base, local: { ...knowledge, canonicalStatement: '离线编辑' }, remote }]
  });

  it('知识 deletedAt 在对象状态中显示回收站，旧编辑采用本地禁用并说明恢复路径', async () => {
    const onResolve = vi.fn().mockResolvedValue(undefined);
    render(<EntityConflictCard conflict={knowledgeConflict()} disabled={false} onResolve={onResolve} />);
    const states = within(screen.getByRole('row', { name: /对象状态/ })).getAllByRole('cell');
    expect(states[2]).toHaveTextContent('已移入回收站');
    expect(screen.getByRole('button', { name: '采用本地' })).toBeDisabled();
    expect(screen.getByText(/先采用云端.*恢复记录.*从回收站.*恢复/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '采用本地' }));
    expect(onResolve).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: '采用云端' }));
    expect(onResolve).toHaveBeenCalledWith('remote');
  });

  it('无共同基线的云端回收站知识也不能由本地活跃内容隐式恢复', () => {
    const group = knowledgeConflict(); group.items[0].base = null;
    render(<EntityConflictCard conflict={group} disabled={false} onResolve={vi.fn()} />);
    expect(screen.getByRole('button', { name: '采用本地' })).toBeDisabled();
  });

  it('知识已永久删除时禁用采用本地，云端选择保留可恢复内容的说明', () => {
    render(<EntityConflictCard conflict={knowledgeConflict(knowledge, null)} disabled={false} onResolve={vi.fn()} />);
    expect(screen.getByRole('button', { name: '采用本地' })).toBeDisabled();
    expect(screen.getByText(/云端资产已永久删除.*恢复记录/)).toBeInTheDocument();
  });

  it('世代变化后不存在的知识无法采用本地，但同世代无基线新知识仍可采用', () => {
    const group = knowledgeConflict(knowledge, null); group.items[0].base = null;
    const { rerender } = render(<EntityConflictCard conflict={group} disabled={false} onResolve={vi.fn()} />);
    expect(screen.getByRole('button', { name: '采用本地' })).toBeEnabled();
    rerender(<EntityConflictCard conflict={{ ...group, changedEpoch: true }} disabled={false} onResolve={vi.fn()} />);
    expect(screen.getByRole('button', { name: '采用本地' })).toBeDisabled();
  });

  it('共同基线已在回收站的显式恢复冲突可采用本地，保留已删除状态也可采用', () => {
    const group = knowledgeConflict(); group.items[0].base = deletedKnowledge;
    const { rerender } = render(<EntityConflictCard conflict={group} disabled={false} onResolve={vi.fn()} />);
    expect(screen.getByRole('button', { name: '采用本地' })).toBeEnabled();
    group.items[0].base = knowledge; group.items[0].local = { ...deletedKnowledge, canonicalStatement: '回收站内容' };
    rerender(<EntityConflictCard conflict={group} disabled={false} onResolve={vi.fn()} />);
    expect(screen.getByRole('button', { name: '采用本地' })).toBeEnabled();
  });

  it('关联组中任一旧知识编辑会禁用整组采用本地，不改变其他领域 deletedAt 的原语义', () => {
    const group = knowledgeConflict();
    group.items.unshift({ collection: 'notes', id: 'note', base: note('原文'), local: note('编辑'), remote: { ...note('云端'), deletedAt: '2026-10-03T01:00:00.000Z' } });
    const { rerender } = render(<EntityConflictCard conflict={group} disabled={false} onResolve={vi.fn()} />);
    expect(screen.getByRole('button', { name: '采用本地' })).toBeDisabled();
    rerender(<EntityConflictCard conflict={{ ...group, items: [group.items[0]] }} disabled={false} onResolve={vi.fn()} />);
    expect(screen.getByRole('button', { name: '采用本地' })).toBeEnabled();
    expect(entityPresence({ deletedAt: '2026-10-03T01:00:00.000Z' }, null)).toBe('存在');
  });
  it('知识关联冲突展示中文审核字段且不提供仅合并正文的操作', () => {
    const knowledge = { title: '注意力', canonicalStatement: '根据相关程度加权', reviewStatus: 'candidate', knowledgeType: 'principle' };
    const group: EntityConflict = { id: 'knowledge-conflict', changedEpoch: false, reasons: [], items: [
      { collection: 'knowledgeItems', id: 'knowledge', base: knowledge, local: { ...knowledge, reviewStatus: 'confirmed' }, remote: { ...knowledge, canonicalStatement: '另一份说明' } },
      { collection: 'notes', id: 'note', base: note('原文'), local: note('本机'), remote: note('云端') }
    ] };
    render(<EntityConflictCard conflict={group} disabled={false} onResolve={vi.fn()} />);
    expect(screen.getByRole('heading', { name: '注意力 · 关联资料需要核对' })).toBeInTheDocument();
    expect(screen.getByRole('row', { name: /审核状态/ })).toHaveTextContent('已确认');
    expect(screen.getByRole('row', { name: /核心陈述/ })).toHaveTextContent('另一份说明');
    expect(screen.queryByRole('button', { name: '手动合并' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '保留为两篇' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '采用本地' })).toBeEnabled();
  });
  it('正文派生文本不重复占用字段表，笔记和标注元数据使用中文名称与取值', () => {
    const local = { ...note('本机正文'), plainText: '重复的纯文本', sourceType: 'markdown-import', status: 'active', favorite: true, internalLinks: ['目标笔记'], charCount: 4 };
    render(<ConflictCard conflict={{ ...conflict, local }} disabled={false} onResolve={vi.fn()} />);
    expect(screen.queryByText(/plainText|重复的纯文本/)).not.toBeInTheDocument();
    expect(screen.getByRole('row', { name: /来源类型/ })).toHaveTextContent('Markdown 导入');
    expect(screen.getByRole('row', { name: /^状态 / })).toHaveTextContent('进行中');
    expect(screen.getByRole('row', { name: /收藏状态/ })).toHaveTextContent('已收藏');
    expect(screen.getByRole('row', { name: /内部链接/ })).toHaveTextContent('目标笔记');
    expect(screen.getByRole('row', { name: /字符数/ })).toHaveTextContent('4');
    expect(fieldValue({ scopeType: 'section', lifecycleStatus: 'archived', sourceMode: 'manual', anchorStatus: 'needsReview', quoteText: 'active', originSnapshot: { scopeType: 'selection' } }, 'anchor', [])).toBe('标注范围：标题范围；标记状态：已取消；创建方式：手动；定位状态：需要复核；引用原文：active；原始内容快照：标注范围：选中文字');
    expect(fieldValue('future-state', 'status', [])).toBe('future-state');
  });

  it('切换双方和基线对比，同时显示中文标题字段变化', async () => {
    const { container } = render(<ConflictCard conflict={conflict} disabled={false} onResolve={vi.fn()} />);
    const row = screen.getByRole('row', { name: /标题/ });
    expect(row).toHaveTextContent('同步笔记');
    expect(row).toHaveTextContent('已变化云端改名');
    expect(container.querySelector('[data-diff="removed"]')).toHaveTextContent('本机正文');
    expect(container.querySelector('[data-diff="added"]')).toHaveTextContent('云端正文');
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /正文比较/ }));
    await user.click(screen.getByRole('option', { name: '共同基线 → 本机' }));
    expect(container.querySelector('[data-diff="removed"]')).toHaveTextContent('基线正文');
    expect(container.querySelector('[data-diff="added"]')).toHaveTextContent('本机正文');
    await user.click(screen.getByRole('button', { name: /正文比较/ }));
    await user.click(screen.getByRole('option', { name: '共同基线 → 云端' }));
    expect(container.querySelector('[data-diff="added"]')).toHaveTextContent('云端正文');
  });

  it('区分无基线的不存在、永久删除、回收站与空正文', async () => {
    expect(entityPresence(null, null)).toContain('无法判定');
    expect(entityPresence(null, note(''))).toBe('已永久删除');
    expect(entityPresence({ deleted: true }, null)).toBe('已移入回收站');
    expect(entityPresence(note(''), null)).toBe('存在');
    render(<ConflictCard conflict={{ ...conflict, base: null, local: note(''), remote: null }} disabled={false} onResolve={vi.fn()} />);
    expect(screen.getByRole('row', { name: /对象状态/ })).toHaveTextContent('不存在（无共同基线，无法判定是否曾删除）');
    await userEvent.click(screen.getByRole('button', { name: /正文比较/ }));
    expect(screen.getByRole('option', { name: '共同基线 → 本机' })).toHaveAttribute('aria-disabled', 'true');
  });

  it('保留四种解决方式的请求语义，忙碌时禁用操作', async () => {
    const onResolve = vi.fn().mockResolvedValue(undefined);
    const { rerender } = render(<ConflictCard conflict={conflict} disabled={false} onResolve={onResolve} />);
    await userEvent.click(screen.getByRole('button', { name: '采用云端' }));
    await userEvent.click(screen.getByRole('button', { name: '采用本地' }));
    await userEvent.click(screen.getByRole('button', { name: '保留为两篇' }));
    await userEvent.click(screen.getByRole('button', { name: '手动合并' }));
    await userEvent.clear(screen.getByLabelText('合并后的正文'));
    await userEvent.type(screen.getByLabelText('合并后的正文'), '合并的段落');
    await userEvent.click(screen.getByRole('button', { name: '保存合并结果' }));
    expect(onResolve.mock.calls).toEqual([['remote'], ['local'], ['copy'], ['manual', '合并的段落']]);
    rerender(<ConflictCard conflict={conflict} disabled onResolve={onResolve} />);
    expect(screen.getByRole('button', { name: '采用本地' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '保存合并结果' })).toBeDisabled();
  });

  it('关联字段解析对象名称，区分空值与未设置，并展示历史版本实体', async () => {
    const item = { collection: 'notes', id: 'note', base: { ...note('原文'), folderId: 'folder', tagIds: [], description: null }, local: { ...note('本机'), folderId: null, tagIds: ['tag'] }, remote: { ...note('云端'), folderId: 'folder', tagIds: [], description: null } };
    const group: EntityConflict = { id: 'group', changedEpoch: true, reasons: [{ collection: 'notes', id: 'note' }], items: [item,
      { collection: 'folders', id: 'folder', base: null, local: { name: '研究目录' }, remote: null },
      { collection: 'tags', id: 'tag', base: null, local: { name: '重点' }, remote: null },
      { collection: 'noteVersions', id: 'version', base: null, local: { rawMarkdown: '旧正文' }, remote: null }
    ] };
    render(<EntityConflictCard conflict={group} disabled={false} onResolve={vi.fn()} />);
    expect(screen.getByRole('row', { name: /所属目录/ })).toHaveTextContent('研究目录（folder）');
    expect(screen.getByRole('row', { name: /^标签 / })).toHaveTextContent('重点（tag）');
    const description = screen.getByRole('row', { name: /说明/ });
    expect(description).toHaveTextContent('空值');
    expect(description).toHaveTextContent('未设置');
    expect(screen.getByText(/云端资料库已恢复或重建/)).toBeInTheDocument();
    const versionSummary = screen.getByText(/历史版本：version/);
    await userEvent.click(versionSummary);
    expect(within(versionSummary.closest('details')!).getByText('旧正文')).toBeInTheDocument();
  });

  it('对象字段顺序不同不会误报差异，多笔记关联冲突不允许合并正文', () => {
    expect(sameField({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(true);
    const group: EntityConflict = { id: 'group', changedEpoch: false, reasons: [], items: ['a', 'b'].map(id => ({ collection: 'notes', id, base: null, local: note(id), remote: null })) };
    render(<EntityConflictCard conflict={group} disabled={false} onResolve={vi.fn()} />);
    expect(screen.queryByRole('button', { name: '手动合并' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '保留为两篇' })).not.toBeInTheDocument();
  });
});

describe('训练资产关联冲突', () => {
  const collections = ['learningObjectives', 'examProfiles', 'examFocuses', 'questions', 'questionObjectives', 'questionSources'];
  it.each(collections)('%s关联组不提供笔记复制或正文合并', collection => {
    const asset = { objective: '计算一步更新', stem: '计算导数', description: '考核应用', reviewStatus: 'candidate' };
    const group: EntityConflict = { id: 'training-conflict', changedEpoch: false, reasons: [], items: [
      { collection, id: 'asset', base: asset, local: asset, remote: asset },
      { collection: 'notes', id: 'note', base: note('原文'), local: note('本机'), remote: note('云端') }
    ] };
    render(<EntityConflictCard conflict={group} disabled={false} onResolve={vi.fn()} />);
    expect(screen.queryByRole('button', { name: '保留为两篇' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '手动合并' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '采用本地' })).toBeEnabled();
  });
  it.each(['learningObjectives', 'examProfiles', 'examFocuses', 'questions'])('%s回收站不能由旧活跃基线编辑隐式恢复，显式恢复仍可采用本地', collection => {
    const active = { name: '人工资产', deletedAt: null };
    const trashed = { ...active, deletedAt: '2026-10-03T00:00:00.000Z' };
    const group: EntityConflict = { id: 'training-delete', changedEpoch: false, reasons: [], items: [{ collection, id: 'asset', base: active, local: active, remote: trashed }] };
    const view = render(<EntityConflictCard conflict={group} disabled={false} onResolve={vi.fn()} />);
    expect(screen.getByRole('row', { name: /对象状态/ })).toHaveTextContent('已移入回收站');
    expect(screen.getByRole('button', { name: '采用本地' })).toBeDisabled();
    expect(screen.getByText(/不能用本地旧编辑直接恢复/)).toBeInTheDocument();
    view.rerender(<EntityConflictCard conflict={{ ...group, items: [{ ...group.items[0], base: trashed }] }} disabled={false} onResolve={vi.fn()} />);
    expect(screen.getByRole('button', { name: '采用本地' })).toBeEnabled();
  });
  it.each(collections)('%s永久删除或世代变化的旧编号不能采用本地复活', collection => {
    const local = { name: '待保留的修改' };
    const group: EntityConflict = { id: 'training-purge', changedEpoch: false, reasons: [], items: [{ collection, id: 'asset', base: local, local, remote: null }] };
    const view = render(<EntityConflictCard conflict={group} disabled={false} onResolve={vi.fn()} />);
    expect(screen.getByRole('button', { name: '采用本地' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '采用云端' })).toBeEnabled();
    view.rerender(<EntityConflictCard conflict={{ ...group, changedEpoch: true, items: [{ ...group.items[0], base: null }] }} disabled={false} onResolve={vi.fn()} />);
    expect(screen.getByRole('button', { name: '采用本地' })).toBeDisabled();
  });
  it('字段、动作层级、题型和训练引用使用中文与对应对象名称', () => {
    const items = [
      { collection: 'learningObjectives', id: 'o1', base: null, remote: null, local: { objective: '计算一步更新' } },
      { collection: 'examProfiles', id: 'p1', base: null, remote: null, local: { name: '期末考试' } },
      { collection: 'questions', id: 'q1', base: null, remote: null, local: { stem: '求导数' } }
    ];
    expect(fieldValue('o1', 'learningObjectiveId', items)).toBe('计算一步更新（o1）');
    expect(fieldValue('p1', 'examProfileId', items)).toBe('期末考试（p1）');
    expect(fieldValue('q1', 'questionId', items)).toBe('求导数（q1）');
    expect(fieldValue('o1', 'sourceId', items, 0, 'questionSources', 'learningObjective')).toBe('计算一步更新（o1）');
    expect(fieldValue({ actionVerb: 'calculate', cognitiveLevel: 'apply', questionType: 'shortAnswer', referenceAnswer: '2x' }, 'content', items)).toBe('动作：计算；认知层级：应用；题型：简答题；参考答案：2x');
  });
});
