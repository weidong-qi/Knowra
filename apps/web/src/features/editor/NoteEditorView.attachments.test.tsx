import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { NoteEditorView, type NoteEditorViewProps } from './NoteEditorView';
import { downloadAttachment, fetchAttachmentBlob } from './attachmentAccess';
import { getEffectiveEditorViewState, initialEditorViewState } from './editorViewState';

vi.mock('./attachmentAccess', () => ({ downloadAttachment: vi.fn(), fetchAttachmentBlob: vi.fn() }));
vi.mock('./MilkdownNoteEditor', () => ({ MilkdownNoteEditor: () => <>
  <a href="/api/storage/attachments/picture/content#attachment=picture">正文图片附件</a>
  <a href="/api/storage/attachments/text/content#attachment=text">正文文档附件</a>
</> }));
function fixture(): NoteEditorViewProps {
  const note = { id: 'attachment-note', spaceId: 'synthetic-space', title: '合成附件笔记', folderId: null, tagIds: [], internalLinks: [], rawMarkdown: '合成正文', contentLoaded: true, favorite: false, deleted: false, updatedAt: '2026-10-11T01:00:00Z' };
  return { note, folder: null, foldersById: {}, notes: [note], tags: [], openNotes: [note], inspectorOpen: false,
    view: getEffectiveEditorViewState(initialEditorViewState), canWrite: true,
    onOpenNote: vi.fn(), onCloseNote: vi.fn(), onCloseOtherNotes: vi.fn(), onReorderNotes: vi.fn(), onCopyTabPath: vi.fn(), onCreateNote: vi.fn(), onCreateFolder: vi.fn(), onImportMarkdown: vi.fn(), onRenameNote: vi.fn(), onSaveMarkdown: vi.fn(), onSaveAs: vi.fn(), onDeleteNote: vi.fn(), onSetTags: vi.fn(), onListVersions: vi.fn().mockResolvedValue([]), onGetVersion: vi.fn(), onOrganizeNote: vi.fn(),
    onListAttachments: vi.fn().mockResolvedValue([
      { id: 'picture', noteId: note.id, fileName: '合成预览.png', mimeType: 'image/png', size: 4, status: 'ready' },
      { id: 'text', noteId: note.id, fileName: '合成文档.txt', mimeType: 'text/plain', size: 4, status: 'ready' }
    ]), onUploadAttachment: vi.fn(), onRenameAttachment: vi.fn(), onDeleteAttachment: vi.fn(), onGetLinkedNotes: vi.fn().mockResolvedValue([]), onListAnnotations: vi.fn().mockResolvedValue([]), onCreateAnnotation: vi.fn(), onDeleteAnnotation: vi.fn(), onUpdateAnnotationAnchor: vi.fn(), onFileStatus: vi.fn(), onViewAction: vi.fn(), onToggleFavorite: vi.fn(), onToggleInspector: vi.fn() };
}
beforeEach(() => {
  vi.mocked(fetchAttachmentBlob).mockResolvedValue(new Blob(['synthetic']));
  vi.mocked(downloadAttachment).mockResolvedValue('synthetic-token');
  vi.stubGlobal('URL', class extends URL {
    static createObjectURL = vi.fn(() => 'blob:synthetic');
    static revokeObjectURL = vi.fn();
  });
});
afterEach(() => { delete window.knowraDesktop; vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.clearAllMocks(); });

it('View 把正文点击连接到预览反馈；关闭和切笔记均释放对象 URL', async () => {
  const props = fixture(); const user = userEvent.setup(); const { rerender } = render(<NoteEditorView {...props} />);
  await user.click(await screen.findByRole('link', { name: '正文图片附件' }));
  expect(await screen.findByRole('dialog', { name: '合成预览.png' })).toBeVisible();
  expect(screen.getByRole('img', { name: '合成预览.png' })).toHaveAttribute('src', 'blob:synthetic');
  expect(props.onListAttachments).toHaveBeenCalledWith('');
  await user.keyboard('{Escape}');
  expect(screen.queryByRole('dialog', { name: '合成预览.png' })).not.toBeInTheDocument();
  expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1);
  await user.click(screen.getByRole('link', { name: '正文图片附件' }));
  await screen.findByRole('dialog', { name: '合成预览.png' });
  rerender(<NoteEditorView {...props} note={{ ...props.note!, id: 'next-note' }} />);
  expect(screen.queryByRole('dialog', { name: '合成预览.png' })).not.toBeInTheDocument();
  expect(URL.revokeObjectURL).toHaveBeenCalledTimes(2);
  expect(props.onSaveMarkdown).not.toHaveBeenCalled();
});

it('View 的中键附件点击显示桌面保存反馈，打开动作使用原 token 并可关闭', async () => {
  const props = fixture(); const user = userEvent.setup();
  const openSavedAttachment = vi.fn().mockResolvedValue(undefined);
  window.knowraDesktop = { openSavedAttachment, onPrepareClose: vi.fn(), onCancelClose: vi.fn() };
  render(<NoteEditorView {...props} />);
  fireEvent(await screen.findByRole('link', { name: '正文文档附件' }), new MouseEvent('auxclick', { bubbles: true, cancelable: true, button: 1 }));
  await screen.findByText('附件已保存');
  await user.click(screen.getByRole('button', { name: '打开已保存附件' }));
  await waitFor(() => expect(openSavedAttachment).toHaveBeenCalledWith('synthetic-token'));
  await user.click(screen.getByRole('button', { name: '关闭' }));
  expect(screen.queryByText('附件已保存')).not.toBeInTheDocument();
  expect(props.onSaveMarkdown).not.toHaveBeenCalled();
});

it('View 只读或能力关闭时仍禁止文件选择，但正文附件可阅读', async () => {
  const props = fixture(); const { rerender } = render(<NoteEditorView {...props} canWrite={false} />);
  expect(screen.getByLabelText('选择要插入的图片')).toBeDisabled();
  await act(async () => { fireEvent.click(await screen.findByRole('link', { name: '正文图片附件' })); });
  expect(await screen.findByRole('dialog', { name: '合成预览.png' })).toBeVisible();
  rerender(<NoteEditorView {...props} extendedWritesEnabled={false} />);
  expect(screen.getByLabelText('选择要插入的图片')).toBeDisabled();
  expect(props.onUploadAttachment).not.toHaveBeenCalled();
});
