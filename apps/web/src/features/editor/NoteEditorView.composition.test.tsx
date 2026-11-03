import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import type { EditorCommandTarget } from './editorCommands';
import type { MilkdownNoteEditorProps } from './MilkdownNoteEditor';
import { NoteEditorView, type NoteEditorViewProps } from './NoteEditorView';
import { DesktopTitlebarContext } from '../../shell/DesktopTitlebarContext';
import { getEffectiveEditorViewState, initialEditorViewState } from './editorViewState';

const editor = vi.hoisted(() => ({ mounts: 0, unmounts: 0, current: null as MilkdownNoteEditorProps | null }));
vi.mock('./MilkdownNoteEditor', () => ({
  MilkdownNoteEditor: forwardRef<EditorCommandTarget, MilkdownNoteEditorProps>(function SyntheticEditor(props, ref) {
    editor.current = props;
    const markdown = useRef(props.markdown);
    const handle = useRef({ getMarkdown: () => markdown.current,
      setMarkdown: (value: string) => { markdown.current = value; }, focus: vi.fn(), clearFind: vi.fn() } as unknown as EditorCommandTarget);
    useImperativeHandle(ref, () => handle.current, []);
    useEffect(() => { editor.mounts++; return () => { editor.unmounts++; }; }, []);
    return <textarea className="ProseMirror" aria-label="合成正文" defaultValue={props.markdown}
      onChange={event => { markdown.current = event.target.value; props.onChange(event.target.value); }} />;
  })
}));

function makeProps(): NoteEditorViewProps {
  const note = { id: 'composition-note', title: '布局验收', folderId: null, tagIds: [], internalLinks: [],
    rawMarkdown: '已保存正文', contentLoaded: true, favorite: false, deleted: false, updatedAt: '2026-10-01T00:00:00Z' };
  return {
    note, folder: null, foldersById: {}, notes: [note], tags: [], openNotes: [note], inspectorOpen: false,
    view: getEffectiveEditorViewState(initialEditorViewState), canWrite: true,
    onOpenNote: vi.fn(), onCloseNote: vi.fn(), onCloseOtherNotes: vi.fn(), onReorderNotes: vi.fn(), onCopyTabPath: vi.fn(),
    onCreateNote: vi.fn(), onReturnToList: vi.fn(), onCreateFolder: vi.fn(), onImportMarkdown: vi.fn(), onRenameNote: vi.fn(),
    onSaveMarkdown: vi.fn(async (_id, markdown) => ({ ...note, rawMarkdown: markdown, updatedAt: '2026-10-01T00:00:01Z' })),
    onSaveAs: vi.fn(), onDeleteNote: vi.fn(), onSetTags: vi.fn(), onListVersions: vi.fn().mockResolvedValue([]), onGetVersion: vi.fn(), onOrganizeNote: vi.fn(),
    onListAttachments: vi.fn().mockResolvedValue([]), onUploadAttachment: vi.fn(), onRenameAttachment: vi.fn(), onDeleteAttachment: vi.fn(),
    onGetLinkedNotes: vi.fn().mockResolvedValue([]), onListAnnotations: vi.fn().mockResolvedValue([]), onCreateAnnotation: vi.fn(), onDeleteAnnotation: vi.fn(),
    onUpdateAnnotationAnchor: vi.fn(), onFileStatus: vi.fn(), onViewAction: vi.fn(), onToggleFavorite: vi.fn(), onToggleInspector: vi.fn()
  };
}
beforeEach(() => { editor.mounts = 0; editor.unmounts = 0; editor.current = null; });
afterEach(() => { cleanup(); localStorage.clear(); document.documentElement.removeAttribute('data-theme'); vi.unstubAllGlobals(); });

describe('编辑页面组合边界', () => {
  it('同笔记阅读/专注、检查器、主题与断点重渲染保留正文实例、焦点和草稿', async () => {
    const props = makeProps();
    const view = render(<NoteEditorView {...props} />);
    const body = await screen.findByLabelText('合成正文');
    body.focus();
    fireEvent.change(body, { target: { value: '尚未保存的草稿' } });
    await waitFor(() => expect(editor.current?.markdown).toBe('尚未保存的草稿'));
    const stage = view.container.querySelector('[data-editor-scroll-root]');
    const paper = view.container.querySelector('[data-pdf-document]');
    for (const mode of ['read', 'focus', 'edit'] as const) {
      document.documentElement.setAttribute('data-theme', mode === 'read' ? 'dark' : 'light');
      vi.stubGlobal('innerWidth', mode === 'read' ? 600 : 1280);
      fireEvent(window, new Event('resize'));
      view.rerender(<NoteEditorView {...props} inspectorOpen={mode !== 'edit'}
        view={getEffectiveEditorViewState({ ...initialEditorViewState, mode })} />);
      expect(screen.getByLabelText('合成正文')).toBe(body);
      expect(body).toHaveFocus();
      expect(body).toHaveValue('尚未保存的草稿');
      expect(editor.current?.markdown).toBe('尚未保存的草稿');
      expect(editor.current?.allowExternalSync).toBe(false);
      expect(view.container.querySelector('[data-editor-scroll-root]')).toBe(stage);
      expect(view.container.querySelector('[data-pdf-document]')).toBe(paper);
    }
    expect(editor.mounts).toBe(1);
    expect(editor.unmounts).toBe(0);
    fireEvent.keyDown(body, { key: 's', ctrlKey: true });
    await waitFor(() => expect(vi.mocked(props.onSaveMarkdown).mock.calls.at(-1)?.[1]).toBe('尚未保存的草稿'));
  });

  it('源码切换保留草稿并通过原 editor ref 同步和保存，切换笔记使用新 key', async () => {
    const props = makeProps();
    const view = render(<NoteEditorView {...props} />);
    fireEvent.change(await screen.findByLabelText('合成正文'), { target: { value: '进入源码前草稿' } });
    await waitFor(() => expect(editor.current?.markdown).toBe('进入源码前草稿'));
    view.rerender(<NoteEditorView {...props} view={{ ...props.view, showSourceEditor: true }} />);
    expect(screen.getByLabelText('Markdown 源码编辑器')).toHaveValue('进入源码前草稿');
    fireEvent.change(screen.getByLabelText('Markdown 源码编辑器'), { target: { value: '源码继续编辑' } });
    fireEvent.click(screen.getByRole('button', { name: '保存源码' }));
    await waitFor(() => expect(props.onFileStatus).toHaveBeenCalledWith('源码已保存'));
    expect(vi.mocked(props.onSaveMarkdown).mock.calls.at(-1)?.[1]).toBe('源码继续编辑');
    // 模拟宿主发布保存回执，不能把旧远端正文重新送回已完成保存的会话。
    props.note = await vi.mocked(props.onSaveMarkdown).mock.results.at(-1)!.value;
    view.rerender(<NoteEditorView {...props} />);
    expect(await screen.findByLabelText('合成正文')).toHaveValue('源码继续编辑');
    const mounts = editor.mounts;
    view.rerender(<NoteEditorView {...props} note={{ ...props.note!, id: 'composition-other', rawMarkdown: '第二篇正文' }} />);
    await waitFor(() => expect(editor.current?.noteId).toBe('composition-other'));
    expect(editor.mounts).toBe(mounts + 1);
    expect(screen.getByLabelText('合成正文')).toHaveValue('第二篇正文');
  });

  it('桌面 portal 仅承载 tabs，纸张滚动层级不增加容器且正文不重挂', async () => {
    const props = makeProps();
    const host = document.createElement('div'); document.body.append(host);
    const view = render(<DesktopTitlebarContext.Provider value={{ enabled: false, host: null }}><NoteEditorView {...props} /></DesktopTitlebarContext.Provider>);
    const body = await screen.findByLabelText('合成正文');
    const stage = view.container.querySelector('[data-editor-scroll-root]')!;
    const paper = view.container.querySelector('[data-pdf-document]')!;
    const root = screen.getByRole('region', { name: '笔记编辑页面骨架' });
    expect(paper.parentElement).toBe(stage);
    expect(stage.parentElement?.parentElement).toBe(root);
    expect(paper.querySelector('h1')).toHaveAttribute('id', 'note-editor-title');
    expect(screen.getByRole('group', { name: '笔记导航与检查器' }).parentElement).toBe(root);
    view.rerender(<DesktopTitlebarContext.Provider value={{ enabled: true, host }}><NoteEditorView {...props} /></DesktopTitlebarContext.Provider>);
    expect(host.querySelector('[role="tablist"]')).not.toBeNull();
    expect(root).toHaveAttribute('data-window-tabs');
    expect(screen.queryByRole('group', { name: '笔记导航与检查器' })).not.toBeInTheDocument();
    expect(view.container.querySelector('[data-editor-scroll-root]')).toBe(stage);
    expect(screen.getByLabelText('合成正文')).toBe(body);
    expect(editor.mounts).toBe(1);
    view.unmount(); host.remove();
  });

  it('正文未加载时保留标题工具栏，只有加载后才挂载编辑器', async () => {
    const props = makeProps();
    const view = render(<NoteEditorView {...props} note={{ ...props.note!, contentLoaded: false }} />);
    expect(screen.getByText('正在加载正文…')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '布局验收' })).toBeInTheDocument();
    expect(editor.mounts).toBe(0);
    view.rerender(<NoteEditorView {...props} />);
    await screen.findByLabelText('合成正文');
    expect(editor.mounts).toBe(1);
  });
});
