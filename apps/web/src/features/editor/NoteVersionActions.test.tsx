import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import { NoteEditorView, type NoteEditorViewProps } from './NoteEditorView';
import { getEffectiveEditorViewState, initialEditorViewState } from './editorViewState';

vi.mock('./MilkdownNoteEditor', () => ({ MilkdownNoteEditor: () => null }));

it('keeps the draft and its original concurrency baseline when saving before restore or save-as fails', async () => {
  const user = userEvent.setup();
  const note = { id: 'version-actions-note', title: '笔记', folderId: null, tagIds: [], internalLinks: [], rawMarkdown: '已保存正文', contentLoaded: true, favorite: false, deleted: false, updatedAt: '2026-09-20T01:00:00Z' };
  const version = { id: 'old', noteId: note.id, content: '历史正文快照', contentHash: 'a'.repeat(64), createdAt: '2026-09-19T01:00:00Z', createdBy: 'user' };
  const onSaveMarkdown = vi.fn().mockRejectedValue(Object.assign(new Error('另一端已修改正文'), { code: 'NOTE_UPDATE_CONFLICT' }));
  const onSaveVersionAs = vi.fn();
  const props: NoteEditorViewProps = {
    note, folder: null, foldersById: {}, notes: [note], tags: [], openNotes: [note], inspectorOpen: true,
    view: getEffectiveEditorViewState({ ...initialEditorViewState, showSourceEditor: true, showRightSidebar: true }), canWrite: true,
    onOpenNote: vi.fn(), onCloseNote: vi.fn(), onCloseOtherNotes: vi.fn(), onReorderNotes: vi.fn(), onCopyTabPath: vi.fn(),
    onCreateNote: vi.fn(), onCreateFolder: vi.fn(), onImportMarkdown: vi.fn(), onRenameNote: vi.fn(), onSaveMarkdown,
    onSaveAs: vi.fn(), onDeleteNote: vi.fn(), onSetTags: vi.fn(), onListVersions: vi.fn().mockResolvedValue([version]), onGetVersion: vi.fn().mockResolvedValue(version), onSaveVersionAs,
    onOrganizeNote: vi.fn(), onListAttachments: vi.fn().mockResolvedValue([]), onUploadAttachment: vi.fn(), onRenameAttachment: vi.fn(), onDeleteAttachment: vi.fn(),
    onGetLinkedNotes: vi.fn().mockResolvedValue([]), onListAnnotations: vi.fn().mockResolvedValue([]), onCreateAnnotation: vi.fn(), onDeleteAnnotation: vi.fn(), onUpdateAnnotationAnchor: vi.fn(),
    onFileStatus: vi.fn(), onViewAction: vi.fn(), onToggleFavorite: vi.fn(), onToggleInspector: vi.fn()
  };
  render(<NoteEditorView {...props} />);
  await user.click(screen.getByRole('tab', { name: '记录' }));
  await user.click(await screen.findByRole('button', { name: /^历史正文/ }));
  await screen.findByText('历史正文快照');
  const source = screen.getByRole('textbox', { name: 'Markdown 源码编辑器' });
  fireEvent.change(source, { target: { value: '我尚未保存的草稿' } });
  await user.click(screen.getByRole('button', { name: '恢复此版本' }));
  await user.click(screen.getByRole('button', { name: '确认恢复' }));
  await waitFor(() => expect(onSaveMarkdown).toHaveBeenCalled());
  expect(onSaveMarkdown).toHaveBeenLastCalledWith(note.id, '我尚未保存的草稿', note.updatedAt, note.rawMarkdown, expect.objectContaining({ formatVersion: 1, edits: expect.any(Array) }));
  expect(source).toHaveValue('我尚未保存的草稿');
  expect(screen.getByRole('dialog', { name: '恢复历史正文' })).toHaveTextContent('另一端已修改正文');
  await user.click(screen.getByRole('button', { name: '取消' }));
  await user.click(screen.getByRole('button', { name: '另存为新笔记' }));
  await waitFor(() => expect(onSaveMarkdown.mock.calls.length).toBeGreaterThan(1));
  expect(onSaveVersionAs).not.toHaveBeenCalled();
  expect(source).toHaveValue('我尚未保存的草稿');
});
