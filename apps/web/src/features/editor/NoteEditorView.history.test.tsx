import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { useState } from 'react';
import type { Note, NoteVersion } from '@study-accelerator/web-core';
import { NoteEditorView, type NoteEditorViewProps } from './NoteEditorView';
import type { EditorInspectorProps } from './EditorInspector';
import { getEffectiveEditorViewState, initialEditorViewState } from './editorViewState';
const inspector = vi.hoisted(() => ({ actions: {} as Pick<EditorInspectorProps, 'onRestoreVersion' | 'onSaveVersionAs'> }));
vi.mock('./MilkdownNoteEditor', () => ({ MilkdownNoteEditor: () => null }));
vi.mock('./EditorInspector', () => ({ EditorInspector: (props: EditorInspectorProps) => { inspector.actions = props; return null; } }));
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

it('页面历史恢复保存源码草稿后才写历史正文，并连接另存动作', async () => {
  const props = makeProps('view-history');
  let publish!: (note: Note) => void;
  let revision = 0;
  props.onSaveMarkdown = vi.fn(async (_id, markdown) => {
    const saved = { ...props.note!, rawMarkdown: markdown, updatedAt: `2026-09-21T01:00:0${++revision}.000Z` };
    publish(saved);
    return saved;
  });
  props.onSaveVersionAs = vi.fn().mockResolvedValue(undefined);
  function Harness() {
    const [saved, setSaved] = useState(props.note!);
    publish = setSaved;
    return <NoteEditorView {...props} note={saved} />;
  }
  render(<Harness />);
  fireEvent.change(screen.getByRole('textbox', { name: 'Markdown 源码编辑器' }), { target: { value: '恢复前源码草稿' } });
  const version = { id: 'view-version', noteId: props.note!.id, content: '要恢复的历史正文' } as NoteVersion;
  await act(async () => { await inspector.actions.onRestoreVersion!(version); });
  expect(vi.mocked(props.onSaveMarkdown).mock.calls.map(call => call[1])).toEqual(['恢复前源码草稿', '要恢复的历史正文']);
  expect(screen.getByRole('textbox', { name: 'Markdown 源码编辑器' })).toHaveValue('要恢复的历史正文');
  expect(props.onFileStatus).toHaveBeenCalledWith('已恢复历史正文；恢复前的正文已保留在历史记录中');
  await act(async () => { await inspector.actions.onSaveVersionAs!(version); });
  expect(props.onSaveVersionAs).toHaveBeenCalledExactlyOnceWith(version);
});

it('页面卸载后的保存回执不继续写历史正文', async () => {
  const props = makeProps('view-history-unmount');
  let completeSave!: (note: Note) => void;
  props.onSaveMarkdown = vi.fn(() => new Promise<Note>(resolve => { completeSave = resolve; }));
  const { unmount } = render(<NoteEditorView {...props} />);
  fireEvent.change(screen.getByRole('textbox', { name: 'Markdown 源码编辑器' }), { target: { value: '卸载前的草稿' } });
  let operation!: Promise<unknown>;
  act(() => { operation = inspector.actions.onRestoreVersion!({ id: 'view-version', noteId: props.note!.id, content: '不可写入的历史正文' } as NoteVersion).catch(error => error); });
  await waitFor(() => expect(props.onSaveMarkdown).toHaveBeenCalledOnce());
  unmount();
  await act(async () => {
    completeSave({ ...props.note!, rawMarkdown: '卸载前的草稿' });
    expect(await operation).toEqual(expect.objectContaining({ message: '笔记或写入状态已改变，请重新打开历史记录' }));
  });
  expect(vi.mocked(props.onSaveMarkdown).mock.calls.every(call => call[1] === '卸载前的草稿')).toBe(true);
  expect(props.onFileStatus).not.toHaveBeenCalled();
});
