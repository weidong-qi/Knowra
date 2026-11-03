import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { NoteEditorView } from './NoteEditorView';
import { getEffectiveEditorViewState, initialEditorViewState } from './editorViewState';

const folder = { id: 'folder-1', name: '产品设计', parentId: null, children: [] };
const foldersById = { [folder.id]: folder };
const tags = [{ id: 'tag-1', name: 'AI' }];
const note = {
  id: 'note-1',
  title: '注意力机制复盘',
  folderId: 'folder-1',
  tagIds: ['tag-1'],
  internalLinks: [],
  rawMarkdown: '# 核心结论',
  contentLoaded: true,
  favorite: false,
  deleted: false,
  status: 'draft',
  updatedAt: '2026-08-29T08:00:00.000Z'
};
const editorView = getEffectiveEditorViewState(initialEditorViewState);

describe('NoteEditorView skeleton', () => {
  it('renders the visual-source framework and delegates panel actions', () => {
    const onToggleInspector = vi.fn();
    const onToggleFavorite = vi.fn();
    render(
      <NoteEditorView
        note={note}
        folder={folder}
        foldersById={foldersById}
        notes={[note]}
        tags={tags}
        openNotes={[note]}
        inspectorOpen
        view={{ ...editorView, showRightSidebar: true }}
        canWrite
        onOpenNote={vi.fn()}
        onCloseNote={vi.fn()}
        onCloseOtherNotes={vi.fn()}
        onReorderNotes={vi.fn()}
        onCopyTabPath={vi.fn()}
        onCreateNote={vi.fn()}
        onCreateFolder={vi.fn()}
        onImportMarkdown={vi.fn()}
        onRenameNote={vi.fn()}
        onSaveMarkdown={vi.fn()}
        onSaveAs={vi.fn()}
        onDeleteNote={vi.fn()}
        onSetTags={vi.fn()}
        onListVersions={vi.fn().mockResolvedValue([])}
        onGetVersion={vi.fn()}
        onOrganizeNote={vi.fn()}
        onListAttachments={vi.fn().mockResolvedValue([])}
        onUploadAttachment={vi.fn()}
        onRenameAttachment={vi.fn()}
        onDeleteAttachment={vi.fn()}
        onGetLinkedNotes={vi.fn().mockResolvedValue([])}
        onListAnnotations={vi.fn().mockResolvedValue([])}
        onCreateAnnotation={vi.fn()}
        onDeleteAnnotation={vi.fn()}
        onUpdateAnnotationAnchor={vi.fn()}
        onFileStatus={vi.fn()}
        onViewAction={vi.fn()}
        onToggleFavorite={onToggleFavorite}
        onToggleInspector={onToggleInspector}
      />
    );

    expect(screen.getByRole('tablist', { name: '打开的笔记' })).toBeInTheDocument();
    expect(screen.getByRole('toolbar', { name: '笔记格式工具栏' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '注意力机制复盘', level: 1 })).toBeInTheDocument();
    expect(screen.getByRole('complementary', { name: '文档检查器' })).toBeVisible();
    expect(screen.getByLabelText('笔记正文编辑器')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '切换文档检查器' }));
    expect(onToggleInspector).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: '收藏当前笔记' }));
    expect(onToggleFavorite).toHaveBeenCalledOnce();
  });

  it('supports switching, closing and creating tabs without conflating their actions', async () => {
    const secondNote = { ...note, id: 'note-2', title: '产品规划草案' };
    const onOpenNote = vi.fn();
    const onCloseNote = vi.fn();
    const onCreateNote = vi.fn();
    render(
      <NoteEditorView
        note={note}
        folder={folder}
        foldersById={foldersById}
        notes={[note, secondNote]}
        tags={tags}
        openNotes={[note, secondNote]}
        inspectorOpen={false}
        view={editorView}
        canWrite
        onOpenNote={onOpenNote}
        onCloseNote={onCloseNote}
        onCloseOtherNotes={vi.fn()}
        onReorderNotes={vi.fn()}
        onCopyTabPath={vi.fn()}
        onCreateNote={onCreateNote}
        onCreateFolder={vi.fn()}
        onImportMarkdown={vi.fn()}
        onRenameNote={vi.fn()}
        onSaveMarkdown={vi.fn()}
        onSaveAs={vi.fn()}
        onDeleteNote={vi.fn()}
        onSetTags={vi.fn()}
        onListVersions={vi.fn().mockResolvedValue([])}
        onGetVersion={vi.fn()}
        onOrganizeNote={vi.fn()}
        onListAttachments={vi.fn().mockResolvedValue([])}
        onUploadAttachment={vi.fn()}
        onRenameAttachment={vi.fn()}
        onDeleteAttachment={vi.fn()}
        onGetLinkedNotes={vi.fn().mockResolvedValue([])}
        onListAnnotations={vi.fn().mockResolvedValue([])}
        onCreateAnnotation={vi.fn()}
        onDeleteAnnotation={vi.fn()}
        onUpdateAnnotationAnchor={vi.fn()}
        onFileStatus={vi.fn()}
        onViewAction={vi.fn()}
        onToggleFavorite={vi.fn()}
        onToggleInspector={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole('tab', { name: '产品规划草案' }));
    await waitFor(() => expect(onOpenNote).toHaveBeenCalledWith('note-2'));
    fireEvent.click(screen.getByRole('button', { name: '关闭产品规划草案' }));
    expect(onCloseNote).toHaveBeenCalledWith('note-2');
    fireEvent.click(screen.getByRole('button', { name: '新建笔记' }));
    expect(onCreateNote).toHaveBeenCalledOnce();

    const firstTab = screen.getByRole('tab', { name: '注意力机制复盘' });
    firstTab.focus();
    fireEvent.keyDown(firstTab, { key: 'ArrowRight' });
    await waitFor(() => expect(onOpenNote).toHaveBeenLastCalledWith('note-2'));
  });

  it('does not append an old upload response to the newly selected note', async () => {
    const secondNote = { ...note, id: 'note-2', title: '第二篇笔记' };
    const oldAttachment = { id: 'old-attachment', noteId: note.id, fileName: '旧请求.txt', mimeType: 'text/plain', size: 1, status: 'ready' };
    const newAttachment = { ...oldAttachment, id: 'new-attachment', noteId: secondNote.id, fileName: '新笔记.txt' };
    let finishUpload!: (value: typeof oldAttachment) => void;
    const onUploadAttachment = vi.fn().mockReturnValue(new Promise(resolve => { finishUpload = resolve; }));
    const props = {
      folder, foldersById, notes: [note, secondNote], tags, openNotes: [note, secondNote], inspectorOpen: true,
      view: { ...editorView, showRightSidebar: true }, canWrite: true,
      onOpenNote: vi.fn(), onCloseNote: vi.fn(), onCloseOtherNotes: vi.fn(), onReorderNotes: vi.fn(), onCopyTabPath: vi.fn(),
      onCreateNote: vi.fn(), onCreateFolder: vi.fn(), onImportMarkdown: vi.fn(), onRenameNote: vi.fn(), onSaveMarkdown: vi.fn(),
      onSaveAs: vi.fn(), onDeleteNote: vi.fn(), onSetTags: vi.fn(), onListVersions: vi.fn().mockResolvedValue([]), onGetVersion: vi.fn(), onOrganizeNote: vi.fn(),
      onListAttachments: vi.fn(async (id: string) => id === secondNote.id ? [newAttachment] : []), onUploadAttachment, onRenameAttachment: vi.fn(), onDeleteAttachment: vi.fn(),
      onGetLinkedNotes: vi.fn().mockResolvedValue([]), onListAnnotations: vi.fn().mockResolvedValue([]), onCreateAnnotation: vi.fn(), onDeleteAnnotation: vi.fn(),
      onUpdateAnnotationAnchor: vi.fn(), onFileStatus: vi.fn(), onViewAction: vi.fn(), onToggleFavorite: vi.fn(), onToggleInspector: vi.fn()
    };
    const result = render(<NoteEditorView {...props} note={note} />);
    fireEvent.change(screen.getByLabelText('选择要上传的附件'), { target: { files: [new File(['x'], '旧请求.txt', { type: 'text/plain' })] } });
    await waitFor(() => expect(onUploadAttachment).toHaveBeenCalledOnce());
    result.rerender(<NoteEditorView {...props} note={secondNote} />);
    await screen.findByRole('button', { name: '打开附件 新笔记.txt' });
    await act(async () => { finishUpload(oldAttachment); });
    expect(screen.queryByRole('button', { name: '打开附件 旧请求.txt' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '打开附件 新笔记.txt' })).toBeInTheDocument();
  });

  it('shows a truthful unavailable state for an unknown note route', () => {
    render(
      <NoteEditorView
        note={null}
        folder={null}
        foldersById={{}}
        notes={[]}
        tags={[]}
        openNotes={[]}
        inspectorOpen={false}
        view={editorView}
        canWrite={false}
        onOpenNote={vi.fn()}
        onCloseNote={vi.fn()}
        onCloseOtherNotes={vi.fn()}
        onReorderNotes={vi.fn()}
        onCopyTabPath={vi.fn()}
        onCreateNote={vi.fn()}
        onCreateFolder={vi.fn()}
        onImportMarkdown={vi.fn()}
        onRenameNote={vi.fn()}
        onSaveMarkdown={vi.fn()}
        onSaveAs={vi.fn()}
        onDeleteNote={vi.fn()}
        onSetTags={vi.fn()}
        onListVersions={vi.fn().mockResolvedValue([])}
        onGetVersion={vi.fn()}
        onOrganizeNote={vi.fn()}
        onListAttachments={vi.fn().mockResolvedValue([])}
        onUploadAttachment={vi.fn()}
        onRenameAttachment={vi.fn()}
        onDeleteAttachment={vi.fn()}
        onGetLinkedNotes={vi.fn().mockResolvedValue([])}
        onListAnnotations={vi.fn().mockResolvedValue([])}
        onCreateAnnotation={vi.fn()}
        onDeleteAnnotation={vi.fn()}
        onUpdateAnnotationAnchor={vi.fn()}
        onFileStatus={vi.fn()}
        onViewAction={vi.fn()}
        onToggleFavorite={vi.fn()}
        onToggleInspector={vi.fn()}
      />
    );

    expect(screen.getByRole('heading', { name: '未找到这篇笔记' })).toBeInTheDocument();
  });
});
