import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import { NoteEditorView, type NoteEditorViewProps } from './NoteEditorView';
import { getEffectiveEditorViewState, initialEditorViewState } from './editorViewState';
vi.mock('./MilkdownNoteEditor', () => ({ MilkdownNoteEditor: () => null }));
function deferred<T>() { let resolve!: (v: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }
function propsFor(id: string): NoteEditorViewProps {
  const note = { id, spaceId: 'space', title: '合成分析笔记', folderId: null, tagIds: [], internalLinks: [], rawMarkdown: '已保存正文', contentLoaded: true, favorite: false, deleted: false, updatedAt: '2026-10-02T01:00:00Z' };
  return { note, folder: null, foldersById: {}, notes: [note], tags: [], openNotes: [note], inspectorOpen: true,
    view: getEffectiveEditorViewState({ ...initialEditorViewState, showSourceEditor: true, showRightSidebar: true }), canWrite: true,
    onOpenNote: vi.fn(), onCloseNote: vi.fn(), onCloseOtherNotes: vi.fn(), onReorderNotes: vi.fn(), onCopyTabPath: vi.fn(), onCreateNote: vi.fn(), onCreateFolder: vi.fn(), onImportMarkdown: vi.fn(), onRenameNote: vi.fn(), onSaveMarkdown: vi.fn().mockResolvedValue(undefined), onSaveAs: vi.fn(), onDeleteNote: vi.fn(), onSetTags: vi.fn(), onListVersions: vi.fn().mockResolvedValue([]), onGetVersion: vi.fn(), onOrganizeNote: vi.fn(), onListAttachments: vi.fn().mockResolvedValue([]), onUploadAttachment: vi.fn(), onRenameAttachment: vi.fn(), onDeleteAttachment: vi.fn(), onGetLinkedNotes: vi.fn().mockResolvedValue([]), onListAnnotations: vi.fn().mockResolvedValue([]), onCreateAnnotation: vi.fn(), onDeleteAnnotation: vi.fn(), onUpdateAnnotationAnchor: vi.fn(), onFileStatus: vi.fn(), onViewAction: vi.fn(), onToggleFavorite: vi.fn(), onToggleInspector: vi.fn(),
    onPreviewAnalysisScope: vi.fn().mockResolvedValue({ spaceId: 'space', mode: 'all', previewHash: 'hash', summary: { noteCount: 1, segmentCount: 1, annotationCount: 0 }, segments: [{ noteId: id, noteVersionId: 'v1', start: 0, end: 4, markdown: '合成预览', annotationIds: [] }], omittedItems: [], ai: { available: false, message: '未开放' } }) };
}
async function openAI() { const user = userEvent.setup(); await user.click(screen.getByRole('tab', { name: 'AI' })); return user; }
it('先保存完整当前草稿并等待成功，再请求服务端固定范围预览', async () => {
  const pending = deferred<void>(), props = propsFor('save-before-preview'); props.onSaveMarkdown = vi.fn().mockReturnValue(pending.promise);
  render(<NoteEditorView {...props} />); const user = await openAI();
  fireEvent.change(screen.getByRole('textbox', { name: 'Markdown 源码编辑器' }), { target: { value: '当前未保存的合成草稿' } });
  await user.click(screen.getByRole('button', { name: '分析整篇' }));
  expect(props.onSaveMarkdown).toHaveBeenCalledWith(props.note!.id, '当前未保存的合成草稿', props.note!.updatedAt, props.note!.rawMarkdown, expect.any(Object)); expect(props.onPreviewAnalysisScope).not.toHaveBeenCalled();
  await act(async () => { pending.resolve(); await pending.promise; });
  expect(await screen.findByRole('dialog', { name: '确认分析范围' })).toHaveTextContent('合成预览');
  expect(props.onPreviewAnalysisScope).toHaveBeenCalledExactlyOnceWith({ spaceId: 'space', mode: 'all', noteIds: [props.note!.id] });
});
it('保存冲突保留用户草稿，不预览或开始', async () => {
  const props = propsFor('save-fails'); props.onSaveMarkdown = vi.fn().mockRejectedValue(Object.assign(new Error('合成正文保存冲突'), { code: 'NOTE_UPDATE_CONFLICT' }));
  render(<NoteEditorView {...props} />); const user = await openAI(), source = screen.getByRole('textbox', { name: 'Markdown 源码编辑器' });
  fireEvent.change(source, { target: { value: '必须保留的草稿' } }); await user.click(screen.getByRole('button', { name: '分析整篇' }));
  await waitFor(() => expect(screen.getAllByText('合成正文保存冲突').length).toBeGreaterThan(0));
  expect(source).toHaveValue('必须保留的草稿'); expect(props.onPreviewAnalysisScope).not.toHaveBeenCalled();
});
it('预览等待期间继续编辑，晚响应不能打开旧范围对话框', async () => {
  const props = propsFor('draft-changes'), pending = deferred<any>(); props.onPreviewAnalysisScope = vi.fn().mockReturnValue(pending.promise);
  render(<NoteEditorView {...props} />); const user = await openAI(); await user.click(screen.getByRole('button', { name: '分析整篇' }));
  fireEvent.change(screen.getByRole('textbox', { name: 'Markdown 源码编辑器' }), { target: { value: '请求中继续编辑的新草稿' } });
  await act(async () => { pending.resolve({}); await pending.promise; });
  expect(await screen.findByText('预览期间笔记或草稿已变化，请重新预览。')).toBeVisible(); expect(screen.queryByRole('dialog', { name: '确认分析范围' })).toBeNull();
});
it('保存等待期间切换笔记，旧保存完成不能对新笔记发预览', async () => {
  const props = propsFor('old-note'), pending = deferred<void>(); props.onSaveMarkdown = vi.fn().mockReturnValue(pending.promise);
  const { rerender } = render(<NoteEditorView {...props} />); const user = await openAI();
  fireEvent.change(screen.getByRole('textbox', { name: 'Markdown 源码编辑器' }), { target: { value: '旧草稿' } }); await user.click(screen.getByRole('button', { name: '分析整篇' }));
  const next = propsFor('new-note'); rerender(<NoteEditorView {...next} />);
  await act(async () => { pending.resolve(); await pending.promise; });
  expect(props.onPreviewAnalysisScope).not.toHaveBeenCalled(); expect(next.onPreviewAnalysisScope).not.toHaveBeenCalled(); expect(screen.queryByRole('dialog', { name: '确认分析范围' })).toBeNull();
});
it('让 AI 提炼知识点：先保存当前草稿并等待成功，再带着笔记 ID 打开助手', async () => {
  const pending = deferred<void>(), props = propsFor('extract-save'); props.onSaveMarkdown = vi.fn().mockReturnValue(pending.promise); props.onExtractWithAssistant = vi.fn();
  render(<NoteEditorView {...props} />); const user = await openAI();
  fireEvent.change(screen.getByRole('textbox', { name: 'Markdown 源码编辑器' }), { target: { value: '提炼前尚未保存的草稿' } });
  await user.click(screen.getByRole('button', { name: '让 AI 提炼知识点' }));
  expect(props.onSaveMarkdown).toHaveBeenCalledWith(props.note!.id, '提炼前尚未保存的草稿', props.note!.updatedAt, props.note!.rawMarkdown, expect.any(Object));
  expect(props.onExtractWithAssistant).not.toHaveBeenCalled();
  await act(async () => { pending.resolve(); await pending.promise; });
  await waitFor(() => expect(props.onExtractWithAssistant).toHaveBeenCalledExactlyOnceWith('extract-save'));
});
it('让 AI 提炼知识点：保存失败时留在编辑器并保留草稿，不打开助手', async () => {
  const props = propsFor('extract-save-fails'); props.onSaveMarkdown = vi.fn().mockRejectedValue(Object.assign(new Error('合成正文保存冲突'), { code: 'NOTE_UPDATE_CONFLICT' }));
  props.onExtractWithAssistant = vi.fn();
  render(<NoteEditorView {...props} />); const user = await openAI(), source = screen.getByRole('textbox', { name: 'Markdown 源码编辑器' });
  fireEvent.change(source, { target: { value: '必须保留的草稿' } }); await user.click(screen.getByRole('button', { name: '让 AI 提炼知识点' }));
  await waitFor(() => expect(props.onSaveMarkdown).toHaveBeenCalled());
  await waitFor(() => expect(screen.getAllByText('合成正文保存冲突').length).toBeGreaterThan(0));
  expect(source).toHaveValue('必须保留的草稿'); expect(props.onExtractWithAssistant).not.toHaveBeenCalled();
});
it('让 AI 提炼知识点：保存等待期间切换笔记，旧笔记不会打开助手', async () => {
  const props = propsFor('extract-old'), pending = deferred<void>(); props.onSaveMarkdown = vi.fn().mockReturnValue(pending.promise); props.onExtractWithAssistant = vi.fn();
  const { rerender } = render(<NoteEditorView {...props} />); const user = await openAI();
  fireEvent.change(screen.getByRole('textbox', { name: 'Markdown 源码编辑器' }), { target: { value: '旧草稿' } }); await user.click(screen.getByRole('button', { name: '让 AI 提炼知识点' }));
  const next = propsFor('extract-new'); next.onExtractWithAssistant = vi.fn(); rerender(<NoteEditorView {...next} />);
  await act(async () => { pending.resolve(); await pending.promise; });
  expect(props.onExtractWithAssistant).not.toHaveBeenCalled(); expect(next.onExtractWithAssistant).not.toHaveBeenCalled();
});
it('让 AI 提炼知识点：保存期间继续输入则不跳转并提示重试，重试时保存最新草稿后才打开助手', async () => {
  const pending = deferred<void>(), props = propsFor('extract-keeps-typing');
  props.onSaveMarkdown = vi.fn().mockReturnValueOnce(pending.promise).mockResolvedValue(undefined); props.onExtractWithAssistant = vi.fn();
  render(<NoteEditorView {...props} />); const user = await openAI(), source = screen.getByRole('textbox', { name: 'Markdown 源码编辑器' });
  fireEvent.change(source, { target: { value: '草稿 A' } });
  await user.click(screen.getByRole('button', { name: '让 AI 提炼知识点' }));
  expect(props.onSaveMarkdown).toHaveBeenCalledTimes(1);
  fireEvent.change(source, { target: { value: '草稿 A，保存期间又输入了 B' } });
  await act(async () => { pending.resolve(); await pending.promise; });
  expect(await screen.findByRole('alert')).toHaveTextContent('保存期间笔记或草稿已变化，请确认内容后重试。');
  expect(props.onExtractWithAssistant).not.toHaveBeenCalled();
  expect(source).toHaveValue('草稿 A，保存期间又输入了 B');
  await user.click(screen.getByRole('button', { name: '让 AI 提炼知识点' }));
  await waitFor(() => expect(props.onExtractWithAssistant).toHaveBeenCalledExactlyOnceWith('extract-keeps-typing'));
  expect(vi.mocked(props.onSaveMarkdown!).mock.calls.at(-1)?.[1]).toBe('草稿 A，保存期间又输入了 B');
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});
it('让 AI 提炼知识点：保存进行中再次点击不会重复保存或重复跳转', async () => {
  const pending = deferred<void>(), props = propsFor('extract-double-click');
  props.onSaveMarkdown = vi.fn().mockReturnValue(pending.promise); props.onExtractWithAssistant = vi.fn();
  render(<NoteEditorView {...props} />); const user = await openAI();
  fireEvent.change(screen.getByRole('textbox', { name: 'Markdown 源码编辑器' }), { target: { value: '待提炼草稿' } });
  const button = screen.getByRole('button', { name: '让 AI 提炼知识点' });
  await user.click(button); await user.click(button);
  expect(props.onSaveMarkdown).toHaveBeenCalledTimes(1);
  await act(async () => { pending.resolve(); await pending.promise; });
  await waitFor(() => expect(props.onExtractWithAssistant).toHaveBeenCalledTimes(1));
});
