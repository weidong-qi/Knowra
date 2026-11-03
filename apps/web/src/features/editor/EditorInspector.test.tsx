import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { Annotation } from '@study-accelerator/web-core';
import { EditorInspector } from './EditorInspector';

const root = { id: 'folder-root', name: '研究', parentId: null, children: [] };
const folder = { id: 'folder-ai', name: 'AI', parentId: 'folder-root', children: [] };
const note = {
  id: 'note-a',
  title: 'Transformer 注意力机制复盘',
  folderId: folder.id,
  tagIds: ['tag-study', 'tag-ai'],
  internalLinks: ['note-b'],
  rawMarkdown: '# 核心原理\n正文内容\n## 计算步骤',
  contentLoaded: true,
  favorite: false,
  deleted: false,
  status: 'draft',
  sourceType: 'manual',
  createdAt: '2026-08-12T13:14:00.000Z',
  updatedAt: '2026-08-31T02:32:00.000Z'
};
const related = { ...note, id: 'note-b', title: '向量相似度入门', internalLinks: [] };
const backlink = { ...note, id: 'note-c', title: '知识库召回策略', internalLinks: ['note-a'] };

describe('EditorInspector', () => {
  it('renders the information tab from live note data and opens related notes', async () => {
    const user = userEvent.setup();
    const onOpenNote = vi.fn();
    renderInspector({ onOpenNote });

    expect(screen.getByRole('tablist', { name: '检查器视图' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: '信息' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('Transformer 注意力机制复盘')).toBeInTheDocument();
    expect(screen.getByText('研究 / AI')).toBeInTheDocument();
    expect(screen.getByText('待整理')).toBeInTheDocument();
    expect(screen.getByText('学习')).toBeInTheDocument();
    expect(screen.getAllByText('AI')).toHaveLength(2);

    await user.click(screen.getByRole('link', { name: '向量相似度入门' }));
    expect(onOpenNote).toHaveBeenCalledWith('note-b');
  });

  it('switches status straight from the info panel and collapses empty sections to one row', async () => {
    const user = userEvent.setup();
    const onOrganizeNote = vi.fn().mockResolvedValue(undefined);
    renderInspector({ onOrganizeNote, notes: [note], tags: [] });

    await user.click(screen.getByRole('button', { name: /状态：.*点击切换/ }));
    await user.click(await screen.findByRole('menuitem', { name: '进行中' }));
    expect(onOrganizeNote).toHaveBeenCalledWith({ folderId: folder.id, status: 'active' });

    expect(screen.queryByText('Markdown 文档')).not.toBeInTheDocument();
    expect(screen.getByText(/字 · /)).toBeInTheDocument();
    expect(screen.getByText(/^更新 .* · 创建 /)).toBeInTheDocument();
  });

  it('supports keyboard-aware tabs and derived outline/link panels', async () => {
    const user = userEvent.setup();
    const onNavigateHeading = vi.fn();
    renderInspector({ onNavigateHeading });

    await user.click(screen.getByRole('tab', { name: '大纲' }));
    expect(screen.queryByText('DOCUMENT OUTLINE')).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '本页大纲' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '跳转到「计算步骤」，H2' }));
    expect(onNavigateHeading).toHaveBeenCalledWith(
      expect.objectContaining({ level: 2, text: '计算步骤' }),
      1
    );

    await user.click(screen.getByRole('tab', { name: '链接' }));
    expect(screen.getByRole('link', { name: '知识库召回策略' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '向量相似度入门' })).toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: 'AI' }));
    expect(screen.getByRole('button', { name: '分析整篇' })).toBeInTheDocument();
  });

  it('edits assigned tags through an explicit save dialog', async () => {
    const user = userEvent.setup();
    const onSetTags = vi.fn().mockResolvedValue(undefined);
    renderInspector({ onSetTags });

    await user.click(screen.getByRole('button', { name: '编辑' }));
    expect(screen.getByRole('dialog', { name: '编辑笔记标签' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '移除标签 AI' }));
    await user.click(screen.getByRole('button', { name: '保存到笔记' }));
    expect(onSetTags).toHaveBeenCalledWith(['tag-study']);
  });

  it('通过真实标签编辑器显示传入笔记范围的使用量，并随笔记和标签更新', async () => {
    const user = userEvent.setup();
    const tagGroups: NonNullable<Parameters<typeof EditorInspector>[0]['tagGroups']> = [
      { id: 'group-ordinary', spaceId: 'space-1', name: '普通标签', selectionMode: 'multiple', sortOrder: 0, isSystem: false }
    ];
    const tags = [
      { id: 'tag-study', name: '学习', groupId: 'group-ordinary' },
      { id: 'tag-ai', name: 'AI', groupId: 'group-ordinary' },
      { id: 'tag-unused', name: '未使用', groupId: 'group-ordinary' },
      { id: 'tag-deleted', name: '仅回收站', groupId: 'group-ordinary' }
    ];
    const view = renderInspector({ tags, tagGroups, notes: [
      { ...related, tagIds: ['tag-study', 'tag-study', 'tag-study', 'tag-ai'] },
      { ...backlink, tagIds: ['tag-study'] },
      { ...note, id: 'note-deleted', deleted: true, tagIds: ['tag-ai', 'tag-deleted'] }
    ] });

    await user.click(screen.getByRole('button', { name: '编辑' }));
    expect(screen.getByRole('dialog', { name: '编辑笔记标签' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '管理标签库' }));
    const expectUsage = (name: string, count: number) => {
      const dialog = screen.getByRole('dialog', { name: '管理标签库' });
      expect(within(dialog).getByText(name).closest('article')).toHaveTextContent(`${count} 篇笔记`);
    };
    // 当前编辑笔记不在传入 notes 中；统计只使用调用方给定的范围。
    expectUsage('学习', 2);
    expectUsage('AI', 1);
    expectUsage('未使用', 0);
    expectUsage('仅回收站', 0);

    const updatedNotes = [{ ...related, tagIds: ['tag-ai', 'tag-new', 'tag-new'] }];
    view.rerenderInspector({ notes: updatedNotes });
    expectUsage('学习', 0);
    expectUsage('AI', 1);
    expectUsage('仅回收站', 0);

    view.rerenderInspector({ notes: updatedNotes, tags: [...tags, { id: 'tag-new', name: '新标签', groupId: 'group-ordinary' }] });
    expectUsage('新标签', 1);
    expectUsage('未使用', 0);
    const dialog = screen.getByRole('dialog', { name: '管理标签库' });
    const newTagRow = within(dialog).getByText('新标签').closest('article')!;
    await user.click(within(newTagRow).getByRole('button', { name: '删除标签 新标签' }));
    expect(screen.getByRole('dialog', { name: '删除标签' })).toHaveTextContent('这个标签正在被 1 篇笔记使用。');
    expect(screen.getByRole('button', { name: '从 1 篇笔记移除并删除' })).toBeInTheDocument();
  });

  it('loads version history on demand and previews the selected snapshot', async () => {
    const user = userEvent.setup();
    const versions = [
      { id: 'version-2', noteId: note.id, content: '# 第二版', contentHash: 'b'.repeat(64), createdAt: '2026-08-31T02:32:00.000Z', createdBy: 'user' },
      { id: 'version-1', noteId: note.id, content: '# 第一版', contentHash: 'a'.repeat(64), createdAt: '2026-08-30T02:32:00.000Z', createdBy: 'user' }
    ];
    const onListVersions = vi.fn().mockResolvedValue(versions);
    const onGetVersion = vi.fn(async (_noteId: string, versionId: string) => (
      versions.find((version) => version.id === versionId) ?? versions[0]
    ));
    renderInspector({ onListVersions, onGetVersion });

    await user.click(screen.getByRole('tab', { name: '记录' }));
    expect(await screen.findByText('2 条历史记录')).toBeInTheDocument();
    expect(onListVersions).toHaveBeenCalledWith(note.id);
    expect(onGetVersion).not.toHaveBeenCalled();
    await user.click(screen.getAllByRole('button', { name: /历史正文/ })[0]);
    expect(await screen.findByText('# 第二版')).toBeInTheDocument();
    await user.click(screen.getAllByRole('button', { name: /历史正文/ })[1]);
    expect(await screen.findByText('# 第一版')).toBeInTheDocument();
    expect(onGetVersion).toHaveBeenLastCalledWith(note.id, 'version-1');
  });

  it('取消重点后显示短期撤销，并以删除后的修订恢复', async () => {
    const user = userEvent.setup();
    const annotation = { id: 'annotation-undo', noteId: note.id, quoteText: '正文内容', headingPath: [], scopeType: 'selection', lifecycleStatus: 'active', revision: 2, noteContentHash: 'hash', idempotencyKey: 'undo' } as unknown as Annotation;
    const onDeleteAnnotation = vi.fn().mockResolvedValue({ ...annotation, lifecycleStatus: 'deleted', revision: 3 });
    const onRestoreAnnotation = vi.fn().mockResolvedValue(undefined);
    renderInspector({ annotations: [annotation], onDeleteAnnotation, onRestoreAnnotation });
    await user.click(screen.getByRole('tab', { name: '标注' }));
    await user.click(screen.getByRole('button', { name: '重点 1 更多操作' }));
    await user.click(screen.getByRole('menuitem', { name: '取消重点' }));
    await user.click(await screen.findByRole('button', { name: '撤销' }));
    await waitFor(() => expect(onRestoreAnnotation).toHaveBeenCalledWith('annotation-undo', 3));
  });

  it('已保存分析范围展示回收站与恢复入口', async () => {
    const user = userEvent.setup();
    const active = { id: 'scope-active', spaceId: 'space-1', createdAt: '2026-09-23T00:00:00.000Z', updatedAt: '2026-09-23T00:00:00.000Z', deletedAt: null, noteVersions: [{ noteId: note.id, title: note.title }], summary: { segmentCount: 1 } };
    const trashed = { ...active, id: 'scope-trash', deletedAt: '2026-09-23T01:00:00.000Z' };
    const onListAnalysisScopes = vi.fn().mockResolvedValue([active, trashed]);
    const onTrashAnalysisScope = vi.fn().mockResolvedValue({ ...active, deletedAt: '2026-09-23T02:00:00.000Z' });
    const onRestoreAnalysisScope = vi.fn().mockResolvedValue({ ...trashed, deletedAt: null });
    renderInspector({ note: { ...note, spaceId: 'space-1' }, onListAnalysisScopes, onTrashAnalysisScope, onRestoreAnalysisScope });
    await user.click(screen.getByRole('tab', { name: 'AI' }));
    expect(await screen.findByRole('button', { name: '恢复范围' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '移入回收站' }));
    await waitFor(() => expect(onTrashAnalysisScope).toHaveBeenCalledWith('scope-active', { spaceId: 'space-1', expectedUpdatedAt: active.updatedAt }));
    await user.click(screen.getByRole('button', { name: '恢复范围' }));
    await waitFor(() => expect(onRestoreAnalysisScope).toHaveBeenCalledWith('scope-trash', { spaceId: 'space-1', expectedUpdatedAt: trashed.updatedAt }));
  });

  it('organizes the note location and status through one explicit save', async () => {
    const user = userEvent.setup();
    const onOrganizeNote = vi.fn().mockResolvedValue(undefined);
    renderInspector({ onOrganizeNote });

    await user.click(screen.getByRole('button', { name: '整理' }));
    expect(screen.getByRole('dialog', { name: '整理笔记' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /笔记状态/ }));
    await user.click(screen.getByRole('option', { name: '进行中' }));
    await user.click(screen.getByRole('button', { name: '保存整理结果' }));
    expect(onOrganizeNote).toHaveBeenCalledWith({ folderId: folder.id, status: 'active' });
  });

  it('lists, locates and archives backend content annotations', async () => {
    const user = userEvent.setup();
    const annotation = {
      id: 'annotation-1', spaceId: 'space-1', noteId: note.id, noteVersionId: null,
      kind: 'important', sourceMode: 'manual', quoteText: '正文内的重要结论', headingPath: ['核心原理'],
      fromPosition: 1, toPosition: 8, prefixText: '', suffixText: '', anchorFingerprint: 'fingerprint',
      noteContentHash: 'hash', idempotencyKey: 'request-1', status: 'active'
    };
    const onSelectAnnotation = vi.fn();
    const onDeleteAnnotation = vi.fn().mockResolvedValue(undefined);
    renderInspector({ annotations: [annotation], onSelectAnnotation, onDeleteAnnotation });

    await user.click(screen.getByRole('tab', { name: '标注' }));
    expect(screen.getByText('正文内的重要结论')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /定位重点 1/ }));
    expect(onSelectAnnotation).toHaveBeenCalledWith('annotation-1');
    expect(screen.queryByRole('button', { name: '提炼知识' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '分析整篇' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('checkbox', { name: '选择重点 1' }));
    expect(screen.getByRole('button', { name: '提炼知识' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '重点 1 更多操作' }));
    await user.click(screen.getByRole('menuitem', { name: '取消重点' }));
    expect(onDeleteAnnotation).toHaveBeenCalledWith('annotation-1', undefined);
  });

  it('groups contained marks, sorts by document or importance, and filters by kind', async () => {
    const user = userEvent.setup();
    const makeAnnotation = (id: string, start: number, end: number, kind: string, importance: Annotation['importance']): Annotation => ({
      id, spaceId: 'space-1', noteId: note.id, noteVersionId: null,
      kind, importance, sourceMode: 'manual', quoteText: id, headingPath: ['核心原理'],
      fromPosition: start, toPosition: end, prefixText: '', suffixText: '', anchorFingerprint: id,
      noteContentHash: 'same-version', idempotencyKey: id, status: 'active', anchorStatus: 'resolved'
    });
    renderInspector({ annotations: [
      makeAnnotation('内层核心', 10, 20, 'question', 'core'),
      makeAnnotation('外层普通', 0, 30, 'important', 'normal'),
      makeAnnotation('后段重要', 40, 50, 'pitfall', 'important')
    ] });

    await user.click(screen.getByRole('tab', { name: '标注' }));
    expect(screen.getAllByRole('button', { name: /定位重点/ }).map((button) => button.textContent)).toEqual([
      expect.stringContaining('外层普通'), expect.stringContaining('内层核心'), expect.stringContaining('后段重要')
    ]);
    expect(screen.getByText('包含 1 条重点')).toBeInTheDocument();
    expect(screen.getByText('位于另一条重点内')).toBeInTheDocument();
    expect(screen.getByText('内层核心').closest('article')).toHaveAttribute('data-importance', 'core');
    expect(screen.getByText('后段重要').closest('article')).toHaveAttribute('data-importance', 'important');
    expect(screen.getByText('外层普通').closest('article')).toHaveAttribute('data-importance', 'normal');

    await user.click(screen.getByRole('button', { name: '排序重点' }));
    await user.click(screen.getByRole('button', { name: '重要级：高到低' }));
    expect(screen.getAllByRole('button', { name: /定位重点/ }).map((button) => button.textContent)).toEqual([
      expect.stringContaining('内层核心'), expect.stringContaining('后段重要'), expect.stringContaining('外层普通')
    ]);

    await user.click(screen.getByRole('button', { name: '筛选重点' }));
    await user.click(screen.getByRole('button', { name: /全部类型/ }));
    await user.click(screen.getByRole('option', { name: '疑问' }));
    await user.click(screen.getByRole('button', { name: '完成' }));
    expect(screen.getAllByRole('button', { name: /定位重点/ })).toHaveLength(1);
    expect(screen.getByText('内层核心')).toBeInTheDocument();
  });

  it('shows the original overlap of marks waiting for relocation in the inspector', async () => {
    const user = userEvent.setup();
    const makeSection = (id: string, start: number, end: number): Annotation => ({
      id, spaceId: 'space-1', noteId: note.id, noteVersionId: null,
      kind: 'important', sourceMode: 'manual', scopeType: 'section', quoteText: id,
      headingPath: ['核心原理'], fromPosition: start, toPosition: end,
      prefixText: '', suffixText: '', anchorFingerprint: id,
      noteContentHash: 'current-version', idempotencyKey: id, status: 'stale', anchorStatus: 'needsReview',
      originSnapshot: { contentHash: 'old-version', scopeType: 'section', quoteText: id,
        headingPath: ['核心原理'], segments: [{ start, end, path: id }] }
    });
    renderInspector({ annotations: [makeSection('二级标题', 20, 50), makeSection('一级标题', 0, 80)] });
    await user.click(screen.getByRole('tab', { name: '标注' }));
    expect(screen.getByText('原标记范围：包含 1 条重点')).toBeInTheDocument();
    expect(screen.getByText('原标记范围：位于另一条重点内')).toBeInTheDocument();
    expect(screen.queryByText('待评级')).not.toBeInTheDocument();
    expect(screen.getAllByText('范围待确认')).toHaveLength(2);
    const header = screen.getByText('重点标记').closest('header');
    expect(header?.querySelectorAll('button')[0]).toHaveAttribute('aria-label', '排序重点');
    expect(header?.querySelectorAll('button')[1]).toHaveAttribute('aria-label', '筛选重点');
    expect(screen.queryByText('排序方式')).not.toBeInTheDocument();
  });

  it('shows an earlier mark needing review before a later resolved mark in document order', async () => {
    const user = userEvent.setup();
    const makeAnnotation = (id: string, start: number, end: number): Annotation => ({
      id, spaceId: 'space-1', noteId: note.id, noteVersionId: null,
      kind: 'important', sourceMode: 'manual', scopeType: 'section', quoteText: id,
      headingPath: [id], fromPosition: start, toPosition: end,
      prefixText: '', suffixText: '', anchorFingerprint: id,
      noteContentHash: 'current-version', idempotencyKey: id,
      status: 'active', anchorStatus: 'resolved'
    });
    const intro = {
      ...makeAnnotation('1.0 引言', 0, 80), status: 'stale' as const,
      anchorStatus: 'needsReview' as const
    };
    renderInspector({ annotations: [makeAnnotation('1.2.1 数据', 120, 180), intro] });

    await user.click(screen.getByRole('tab', { name: '标注' }));
    expect(screen.getAllByRole('button', { name: /定位重点/ }).map((button) => button.textContent)).toEqual([
      expect.stringContaining('1.0 引言'), expect.stringContaining('1.2.1 数据')
    ]);
  });
});

describe('EditorInspector AI 助手提炼入口', () => {
  async function openAiTab() { await userEvent.setup().click(screen.getByRole('tab', { name: 'AI' })); }
  it('提供入口时显示说明与按钮，点击打开助手；没有提供时不显示', async () => {
    const onExtract = vi.fn();
    const view = renderInspector({ onExtractWithAssistant: onExtract });
    await openAiTab();
    expect(screen.getByRole('heading', { name: '让 AI 助手提炼知识点' })).toBeInTheDocument();
    expect(screen.getByText(/候选只是提议，须在知识库逐条审核后才会入库/)).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole('button', { name: '让 AI 提炼知识点' }));
    expect(onExtract).toHaveBeenCalledTimes(1);
    view.unmount();
    renderInspector();
    await openAiTab();
    expect(screen.queryByRole('button', { name: '让 AI 提炼知识点' })).not.toBeInTheDocument();
  });
  it('笔记不可写或知识写入被禁用时按钮不可用并说明原因', async () => {
    const onExtract = vi.fn();
    const view = renderInspector({ onExtractWithAssistant: onExtract, canWrite: false });
    await openAiTab();
    expect(screen.getByRole('button', { name: '让 AI 提炼知识点' })).toBeDisabled();
    expect(screen.getByText('当前笔记不可写，无法提炼知识点。')).toBeInTheDocument();
    view.unmount();
    renderInspector({ onExtractWithAssistant: onExtract, knowledgeWriteDisabledReason: '知识写入暂不可用。' });
    await openAiTab();
    expect(screen.getByRole('button', { name: '让 AI 提炼知识点' })).toBeDisabled();
    expect(screen.getByText('知识写入暂不可用。')).toBeInTheDocument();
    expect(onExtract).not.toHaveBeenCalled();
  });
});

function renderInspector(overrides: Partial<Parameters<typeof EditorInspector>[0]> = {}) {
  const view = render(createInspector(overrides));
  return {
    ...view,
    rerenderInspector: (nextOverrides: Partial<Parameters<typeof EditorInspector>[0]>) => view.rerender(createInspector({ ...overrides, ...nextOverrides }))
  };
}

function createInspector(overrides: Partial<Parameters<typeof EditorInspector>[0]>) {
  return <EditorInspector
    note={note}
    folder={folder}
    foldersById={{ [root.id]: root, [folder.id]: folder }}
    notes={[note, related, backlink]}
    tags={[{ id: 'tag-study', name: '学习' }, { id: 'tag-ai', name: 'AI' }]}
    markdown={note.rawMarkdown}
    open
    canWrite
    canInsertAttachment
    onClose={vi.fn()}
    onOpenNote={vi.fn()}
    onNavigateHeading={vi.fn()}
    onSetTags={vi.fn().mockResolvedValue(undefined)}
    onListVersions={vi.fn().mockResolvedValue([])}
    onGetVersion={vi.fn()}
    {...overrides}
    attachments={overrides.attachments ?? []}
    attachmentsLoading={overrides.attachmentsLoading ?? false}
    linkedNotes={overrides.linkedNotes ?? [related]}
    linkedNotesLoading={overrides.linkedNotesLoading ?? false}
    annotations={overrides.annotations ?? []}
    annotationsLoading={overrides.annotationsLoading ?? false}
    focusedAnnotationId={overrides.focusedAnnotationId ?? null}
    onOrganizeNote={overrides.onOrganizeNote ?? vi.fn().mockResolvedValue(undefined)}
    onUploadAttachment={overrides.onUploadAttachment ?? vi.fn()}
    onInsertAttachment={overrides.onInsertAttachment ?? vi.fn().mockResolvedValue(undefined)}
    onRenameAttachment={overrides.onRenameAttachment ?? vi.fn()}
    onDeleteAttachment={overrides.onDeleteAttachment ?? vi.fn()}
    onCreateAnnotation={overrides.onCreateAnnotation ?? vi.fn().mockResolvedValue(undefined)}
    onSelectAnnotation={overrides.onSelectAnnotation ?? vi.fn()}
    onDeleteAnnotation={overrides.onDeleteAnnotation ?? vi.fn().mockResolvedValue(undefined)}
    onReanchorAnnotation={overrides.onReanchorAnnotation ?? vi.fn().mockResolvedValue(undefined)}
  />;
}


it('快速状态切换在请求完成前禁用，完成后可继续操作', async () => {
  const user = userEvent.setup();
  let complete!: () => void;
  const onOrganizeNote = vi.fn(() => new Promise<void>(resolve => { complete = resolve; }));
  renderInspector({ onOrganizeNote });
  const trigger = screen.getByRole('button', { name: /状态：.*点击切换/ });
  await user.click(trigger);
  await user.click(screen.getByRole('menuitem', { name: '进行中' }));
  expect(trigger).toBeDisabled();
  await user.click(trigger);
  expect(onOrganizeNote).toHaveBeenCalledTimes(1);
  await act(async () => complete());
  expect(trigger).toBeEnabled();
});

it('快速状态切换失败显示错误并允许重试', async () => {
  const user = userEvent.setup();
  const onOrganizeNote = vi.fn().mockRejectedValueOnce(new Error('网络中断')).mockResolvedValue(undefined);
  renderInspector({ onOrganizeNote });
  const trigger = screen.getByRole('button', { name: /状态：.*点击切换/ });
  await user.click(trigger);
  await user.click(screen.getByRole('menuitem', { name: '进行中' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('网络中断，请重新选择状态重试');
  expect(trigger).toBeEnabled();
  await user.click(trigger);
  await user.click(screen.getByRole('menuitem', { name: '进行中' }));
  await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
  expect(onOrganizeNote).toHaveBeenCalledTimes(2);
});

it.each([
  ['resolve', 'open'], ['reject', 'open'],
  ['resolve', 'pending'], ['reject', 'pending']
] as const)('切换笔记后 A %s 不污染 B 的 %s 状态', async (outcome, state) => {
  const user = userEvent.setup();
  let resolveA!: () => void;
  let rejectA!: (error: Error) => void;
  let resolveB!: () => void;
  const saveA = vi.fn(() => new Promise<void>((resolve, reject) => { resolveA = resolve; rejectA = reject; }));
  const saveB = vi.fn(() => new Promise<void>(resolve => { resolveB = resolve; }));
  const view = renderInspector({ onOrganizeNote: saveA });
  await user.click(screen.getByRole('button', { name: /状态：.*点击切换/ }));
  await user.click(screen.getByRole('menuitem', { name: '进行中' }));
  expect(screen.getByRole('button', { name: /状态：.*点击切换/ })).toBeDisabled();

  view.rerenderInspector({ note: { ...related, status: 'published' }, onOrganizeNote: saveB });
  const triggerB = screen.getByRole('button', { name: '状态：已发布，点击切换' });
  expect(triggerB).toBeEnabled();
  await user.click(triggerB);
  if (state === 'pending') await user.click(screen.getByRole('menuitem', { name: '已归档' }));
  else expect(screen.getByRole('menu')).toBeVisible();

  await act(async () => { if (outcome === 'reject') rejectA(new Error('A 的迟到失败')); else resolveA(); });
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(triggerB).toHaveAccessibleName('状态：已发布，点击切换');
  expect(saveA).toHaveBeenCalledTimes(1);
  expect(saveA).toHaveBeenCalledWith({ folderId: folder.id, status: 'active' });
  if (state === 'open') {
    expect(screen.getByRole('menu')).toBeVisible();
    expect(triggerB).toBeEnabled();
    expect(saveB).not.toHaveBeenCalled();
    await user.click(screen.getByRole('menuitem', { name: '已归档' }));
  }
  expect(triggerB).toBeDisabled();
  expect(saveB).toHaveBeenCalledTimes(1);
  expect(saveB).toHaveBeenCalledWith({ folderId: related.folderId, status: 'archived' });
  await act(async () => resolveB());
  expect(triggerB).toBeEnabled();
});

it.each([['resolve', 'open'], ['reject', 'open'], ['resolve', 'pending'], ['reject', 'pending']] as const)('标签面板切笔记后 A %s 不污染 B 的 %s 会话', async (outcome, state) => {
  const user = userEvent.setup();
  let resolveA!: () => void;
  let rejectA!: (error: Error) => void;
  const saveA = vi.fn(() => new Promise<void>((resolve, reject) => { resolveA = resolve; rejectA = reject; }));
  let resolveB!: () => void;
  const saveB = vi.fn(() => new Promise<void>(resolve => { resolveB = resolve; }));
  const view = renderInspector({ onSetTags: saveA });
  await user.click(screen.getByRole('button', { name: '编辑' }));
  await user.click(screen.getByRole('button', { name: '移除标签 AI' }));
  await user.click(screen.getByRole('button', { name: '保存到笔记' }));
  expect(saveA).toHaveBeenCalledWith(['tag-study']);

  view.rerenderInspector({ note: { ...related, tagIds: ['tag-ai'] }, onSetTags: saveB });
  const panelB = screen.getByRole('dialog', { name: '编辑笔记标签' });
  expect(within(panelB).getByRole('button', { name: '保存到笔记' })).toBeEnabled();
  expect(within(panelB).queryByRole('button', { name: '移除标签 学习' })).not.toBeInTheDocument();
  expect(within(panelB).getByRole('button', { name: '移除标签 AI' })).toBeInTheDocument();
  if (state === 'pending') await user.click(within(panelB).getByRole('button', { name: '保存到笔记' }));
  await act(async () => { outcome === 'resolve' ? resolveA() : rejectA(new Error('A 的迟到失败')); });
  expect(screen.getByRole('dialog', { name: '编辑笔记标签' })).toBeInTheDocument();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  if (state === 'open') expect(saveB).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button', { name: '保存到笔记' }));
  expect(saveB).toHaveBeenCalledExactlyOnceWith(['tag-ai']);
  expect(saveA).toHaveBeenCalledTimes(1);
  await act(async () => resolveB());
  expect(screen.queryByRole('dialog', { name: '编辑笔记标签' })).not.toBeInTheDocument();
});
