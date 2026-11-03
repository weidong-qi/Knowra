import { act, cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NoteEditorView, type NoteEditorViewProps } from './NoteEditorView';
import { getEffectiveEditorViewState, initialEditorViewState } from './editorViewState';
import { EDITOR_SCROLL_POSITIONS_KEY } from './editorScrollPosition';

const ready = vi.hoisted(() => new Map<string, () => Promise<void>>());
vi.mock('./MilkdownNoteEditor', () => ({
  MilkdownNoteEditor: ({ noteId, onReady }: { noteId: string; onReady: () => Promise<void> }) => {
    ready.set(noteId, onReady);
    return <div>合成正文</div>;
  }
}));
const note = { id: 'a', title: '甲', folderId: null, tagIds: [], internalLinks: [], rawMarkdown: '正文',
  contentLoaded: true, favorite: false, deleted: false, status: 'draft', updatedAt: '2026-10-01T00:00:00Z' };
function props(id: string): NoteEditorViewProps {
  return {
    note: { ...note, id }, folder: null, foldersById: {}, notes: [], tags: [], openNotes: [], inspectorOpen: false,
    view: getEffectiveEditorViewState(initialEditorViewState), canWrite: false,
    onOpenNote: vi.fn(), onCloseNote: vi.fn(), onCloseOtherNotes: vi.fn(), onReorderNotes: vi.fn(), onCopyTabPath: vi.fn(),
    onCreateNote: vi.fn(), onCreateFolder: vi.fn(), onImportMarkdown: vi.fn(), onRenameNote: vi.fn(), onSaveMarkdown: vi.fn(),
    onSaveAs: vi.fn(), onDeleteNote: vi.fn(), onSetTags: vi.fn(), onListVersions: vi.fn().mockResolvedValue([]), onGetVersion: vi.fn(), onOrganizeNote: vi.fn(),
    onListAttachments: vi.fn().mockResolvedValue([]), onUploadAttachment: vi.fn(), onRenameAttachment: vi.fn(), onDeleteAttachment: vi.fn(),
    onGetLinkedNotes: vi.fn().mockResolvedValue([]), onListAnnotations: vi.fn().mockResolvedValue([]), onCreateAnnotation: vi.fn(), onDeleteAnnotation: vi.fn(),
    onUpdateAnnotationAnchor: vi.fn(), onFileStatus: vi.fn(), onViewAction: vi.fn(), onToggleFavorite: vi.fn(), onToggleInspector: vi.fn()
  };
}
let frames: Map<number, FrameRequestCallback>;
async function advanceFrames(count: number) {
  for (let i = 0; i < count; i += 1) await act(async () => {
    const callbacks = [...frames.values()]; frames.clear();
    callbacks.forEach(callback => callback(i * 16));
  });
}
beforeEach(() => {
  frames = new Map(); ready.clear(); let id = 0;
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => { frames.set(++id, callback); return id; });
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(key => { frames.delete(key); });
  vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(2000);
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(500);
  localStorage.setItem(EDITOR_SCROLL_POSITIONS_KEY, JSON.stringify({ a: 400, b: 800 }));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); localStorage.clear(); });

describe('NoteEditorView 视口接线', () => {
  it('旧笔记仍在等待帧时，新笔记 onReady 独立恢复阅读位置', async () => {
    const view = render(<NoteEditorView {...props('a')} />);
    await waitFor(() => expect(ready.has('a')).toBe(true));
    await advanceFrames(1);
    let first!: Promise<void>;
    act(() => { first = ready.get('a')!(); });
    view.rerender(<NoteEditorView {...props('b')} />);
    await waitFor(() => expect(ready.has('b')).toBe(true));
    let second!: Promise<void>;
    act(() => { second = ready.get('b')!(); });
    await advanceFrames(40);
    await act(async () => { await Promise.all([first, second]); });
    expect(view.container.querySelector('[data-editor-scroll-root]')?.scrollTop).toBe(800);
  });
});
