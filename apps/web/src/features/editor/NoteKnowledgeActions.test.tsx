import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import type { Annotation, Note } from '@study-accelerator/web-core';
import { NoteEditorView, type NoteEditorViewProps } from './NoteEditorView';
import { getEffectiveEditorViewState, initialEditorViewState } from './editorViewState';

const inspector = vi.hoisted(() => ({
  createCandidate: undefined as ((annotation: Annotation) => Promise<void>) | undefined
}));
vi.mock('./MilkdownNoteEditor', () => ({ MilkdownNoteEditor: () => null }));
vi.mock('./EditorInspector', () => ({
  EditorInspector: (props: Pick<NoteEditorViewProps, 'onCreateKnowledgeCandidate'>) => {
    inspector.createCandidate = props.onCreateKnowledgeCandidate;
    return null;
  }
}));

function makeProps(id: string): NoteEditorViewProps {
  const note: Note = {
    id, title: '来源笔记', folderId: null, tagIds: [], internalLinks: [],
    rawMarkdown: '已保存的来源正文', contentLoaded: true, favorite: false,
    deleted: false, updatedAt: '2026-09-21T01:00:00.000Z'
  };
  return {
    note, folder: null, foldersById: {}, notes: [note], tags: [], openNotes: [note], inspectorOpen: true,
    view: getEffectiveEditorViewState({ ...initialEditorViewState, showSourceEditor: true, showRightSidebar: true }), canWrite: true,
    onOpenNote: vi.fn(), onCloseNote: vi.fn(), onCloseOtherNotes: vi.fn(), onReorderNotes: vi.fn(), onCopyTabPath: vi.fn(),
    onCreateNote: vi.fn(), onCreateFolder: vi.fn(), onImportMarkdown: vi.fn(), onRenameNote: vi.fn(), onSaveMarkdown: vi.fn(),
    onSaveAs: vi.fn(), onDeleteNote: vi.fn(), onSetTags: vi.fn(), onListVersions: vi.fn().mockResolvedValue([]), onGetVersion: vi.fn(),
    onOrganizeNote: vi.fn(), onListAttachments: vi.fn().mockResolvedValue([]), onUploadAttachment: vi.fn(), onRenameAttachment: vi.fn(), onDeleteAttachment: vi.fn(),
    onGetLinkedNotes: vi.fn().mockResolvedValue([]), onListAnnotations: vi.fn().mockResolvedValue([]), onCreateAnnotation: vi.fn(), onDeleteAnnotation: vi.fn(), onUpdateAnnotationAnchor: vi.fn(),
    onCreateKnowledgeCandidate: vi.fn().mockResolvedValue(undefined),
    onFileStatus: vi.fn(), onViewAction: vi.fn(), onToggleFavorite: vi.fn(), onToggleInspector: vi.fn()
  };
}

it('创建候选等待正文保存期间切换笔记，保存完成后不再创建旧来源候选', async () => {
  const props = makeProps('knowledge-switch-note');
  const note = props.note!;
  let completeSave!: (saved: Note) => void;
  props.onSaveMarkdown = vi.fn(() => new Promise<Note>(resolve => { completeSave = resolve; }));
  const { rerender } = render(<NoteEditorView {...props} />);
  fireEvent.change(screen.getByRole('textbox', { name: 'Markdown 源码编辑器' }), { target: { value: '即将保存的来源正文' } });

  let result!: Promise<unknown>;
  act(() => {
    result = inspector.createCandidate!({ id: 'source-annotation', noteId: note.id } as Annotation).catch(error => error);
  });
  await waitFor(() => expect(props.onSaveMarkdown).toHaveBeenCalledWith(note.id, '即将保存的来源正文', note.updatedAt, note.rawMarkdown, expect.objectContaining({ formatVersion: 1, edits: expect.any(Array) })));
  const nextNote = { ...note, id: 'knowledge-other-note', title: '另一篇笔记', rawMarkdown: '另一篇的正文' };
  rerender(<NoteEditorView {...props} note={nextNote} notes={[note, nextNote]} openNotes={[note, nextNote]} />);
  await act(async () => {
    completeSave({ ...note, rawMarkdown: '即将保存的来源正文', updatedAt: '2026-09-21T01:00:01.000Z' });
    expect(await result).toEqual(expect.objectContaining({ message: '已切换笔记或写入状态，请在当前笔记重新创建候选。' }));
  });
  expect(props.onCreateKnowledgeCandidate).not.toHaveBeenCalled();
  expect(screen.getByRole('textbox', { name: 'Markdown 源码编辑器' })).toHaveValue('另一篇的正文');
});

it('正文保存失败时不创建知识候选，并保留未保存正文', async () => {
  const props = makeProps('knowledge-save-failure-note');
  props.onSaveMarkdown = vi.fn().mockRejectedValue(new Error('正文暂时无法保存'));
  render(<NoteEditorView {...props} />);
  const source = screen.getByRole('textbox', { name: 'Markdown 源码编辑器' });
  fireEvent.change(source, { target: { value: '不能丢失的来源草稿' } });
  await act(async () => {
    await expect(inspector.createCandidate!({ id: 'failed-source', noteId: props.note!.id } as Annotation)).rejects.toThrow('正文暂时无法保存');
  });
  expect(props.onCreateKnowledgeCandidate).not.toHaveBeenCalled();
  expect(source).toHaveValue('不能丢失的来源草稿');
});

it('保存期间继续输入时不以旧正文创建候选，保留最新草稿供重试', async () => {
  const props = makeProps('knowledge-keeps-typing');
  let completeSave!: (saved: Note) => void;
  props.onSaveMarkdown = vi.fn(() => new Promise<Note>(resolve => { completeSave = resolve; }));
  render(<NoteEditorView {...props} />);
  const source = screen.getByRole('textbox', { name: 'Markdown 源码编辑器' });
  fireEvent.change(source, { target: { value: '草稿 A' } });
  let result!: Promise<unknown>;
  act(() => { result = inspector.createCandidate!({ id: 'typing-source', noteId: props.note!.id } as Annotation).catch(error => error); });
  await waitFor(() => expect(props.onSaveMarkdown).toHaveBeenCalledOnce());
  fireEvent.change(source, { target: { value: '草稿 A 后继续输入 B' } });
  await act(async () => {
    completeSave({ ...props.note!, rawMarkdown: '草稿 A', updatedAt: '2026-09-21T01:00:01.000Z' });
    expect(await result).toEqual(expect.objectContaining({ message: '保存期间正文又有修改，请确认内容后重新创建候选。' }));
  });
  expect(props.onCreateKnowledgeCandidate).not.toHaveBeenCalled();
  expect(source).toHaveValue('草稿 A 后继续输入 B');
});
