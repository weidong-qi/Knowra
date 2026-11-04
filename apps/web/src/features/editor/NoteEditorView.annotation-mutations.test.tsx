import { act, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { NoteEditorView, type NoteEditorViewProps } from './NoteEditorView';
import { getEffectiveEditorViewState, initialEditorViewState } from './editorViewState';
import { type Annotation } from '@study-accelerator/web-core';
import { calculateContentHash } from '@study-accelerator/content-anchor';
import { requestNoteLinkNavigation } from './editorLinkNavigation';
import { noteDraftRecovery } from './noteDraftRecovery';

const state = vi.hoisted(() => ({
  markdown: '保存后的正文',
  selection: {
    anchor: { segments: [] },
    quoteText: '正文',
    headingPath: [],
    fromPosition: 1,
    toPosition: 3,
    prefixText: '',
    suffixText: '',
    scopeType: 'blocks'
  },
  inspector: {} as Record<string, Function>,
  editorProps: {} as Record<string, Function>,
  locate: vi.fn(() => true)
}));
vi.mock('./MilkdownNoteEditor', async () => {
  const React = await import('react');
  return {
    MilkdownNoteEditor: React.forwardRef((props, ref) => {
      state.editorProps = props as Record<string, Function>;
      React.useImperativeHandle(
        ref,
        () => ({
          getMarkdown: () => state.markdown,
          setAnnotations: () => {},
          clearFind: () => {},
          focus: () => {},
          matchesMarkdownDocument: (markdown: string) => markdown === state.markdown,
          selectNoteLinkOccurrence: state.locate
        }),
        []
      );
      return <div data-testid="mutation-editor" />;
    })
  };
});
vi.mock('./EditorInspector', () => ({
  EditorInspector: (props: Record<string, Function>) => {
    state.inspector = props;
    return null;
  }
}));
const annotation = {
  id: 'annotation-1',
  noteId: 'note-1',
  scopeType: 'blocks',
  revision: 1,
  lifecycleStatus: 'active'
} as Annotation;
function fixture() {
  state.markdown = '保存后的正文';
  state.selection = {
    anchor: { segments: [] },
    quoteText: '正文',
    headingPath: [],
    fromPosition: 1,
    toPosition: 3,
    prefixText: '',
    suffixText: '',
    scopeType: 'blocks'
  };
  let revision = 1;
  const props = {
    note: {
      id: 'note-1',
      title: '标注并发',
      spaceId: 'space-1',
      rawMarkdown: '旧正文',
      contentLoaded: true,
      updatedAt: 'v1',
      tagIds: [],
      internalLinks: [],
      deleted: false
    },
    foldersById: {},
    notes: [],
    tags: [],
    openNotes: [],
    inspectorOpen: true,
    canWrite: true,
    view: { ...getEffectiveEditorViewState(initialEditorViewState), contentMode: 'edit' },
    ...Object.fromEntries(
      [
        'onOpenNote',
        'onCloseNote',
        'onCloseOtherNotes',
        'onReorderNotes',
        'onCopyTabPath',
        'onCreateNote',
        'onCreateFolder',
        'onImportMarkdown',
        'onRenameNote',
        'onSaveAs',
        'onDeleteNote',
        'onSetTags',
        'onGetVersion',
        'onOrganizeNote',
        'onUploadAttachment',
        'onRenameAttachment',
        'onDeleteAttachment',
        'onDeleteAnnotation',
        'onFileStatus',
        'onViewAction',
        'onToggleFavorite',
        'onToggleInspector'
      ].map(key => [key, vi.fn()])
    ),
    onListVersions: vi.fn().mockResolvedValue([]),
    onListAttachments: vi.fn().mockResolvedValue([]),
    onGetLinkedNotes: vi.fn().mockResolvedValue([]),
    onListAnnotations: vi.fn(async () => [{ ...annotation, revision }]),
    onSaveMarkdown: vi.fn(async () => {
      revision += 1;
      return { updatedAt: 'v2', rawMarkdown: state.markdown };
    })
  } as unknown as NoteEditorViewProps;
  return props;
}
describe('笔记链接导航取消过期异步结果', () => {
  it('恢复来源冲突草稿时不在不同版本中定位，并保留失效提示', async () => {
    const props = fixture();
    props.note = {
      ...props.note!,
      rawMarkdown: 'Remote [文字](knowra://note/target#ref=ref-location)',
      updatedAt: 'remote-v2'
    };
    state.markdown = 'Local [文字](knowra://note/target#ref=ref-location)';
    state.locate.mockClear();
    noteDraftRecovery.write('space-1', 'note-1', {
      markdown: state.markdown,
      baseMarkdown: 'Base',
      baseUpdatedAt: 'remote-v1',
      conflict: '合成冲突'
    });
    const { unmount } = render(<NoteEditorView {...props} />);
    try {
      await screen.findByTestId('mutation-editor');
      requestNoteLinkNavigation(
        'note-1',
        'space-1',
        { targetNoteId: 'target', occurrenceId: 'ref-location' },
        calculateContentHash(props.note.rawMarkdown)
      );
      await act(async () => {
        await state.editorProps.onReady();
      });
      expect(state.locate).not.toHaveBeenCalled();
      expect(screen.getByText('引用位置或来源版本已变化，已打开来源笔记')).toBeVisible();
    } finally {
      unmount();
      const record = noteDraftRecovery.read('space-1', 'note-1');
      if (record) noteDraftRecovery.remove('space-1', 'note-1', record);
    }
  });
  it.each(['save', 'relations'])('等待 %s 时离开编辑页不触发迟到导航', async phase => {
    const props = fixture();
    const relation = {
      noteId: 'note-1',
      spaceId: 'space-1',
      contentHash: calculateContentHash(state.markdown),
      outgoing: [{ id: 'target', title: '目标', folderId: null, status: 'active' as const, occurrences: [] }],
      backlinks: []
    };
    props.onGetNoteLinkRelations = vi.fn().mockResolvedValue(relation);
    let finish!: () => void;
    if (phase === 'save')
      vi.mocked(props.onSaveMarkdown).mockImplementation(
        () =>
          new Promise(resolve => {
            finish = () => resolve({ ...props.note!, rawMarkdown: state.markdown, updatedAt: 'v2' });
          })
      );
    const { unmount } = render(<NoteEditorView {...props} />);
    await screen.findByTestId('mutation-editor');
    if (phase === 'relations')
      vi.mocked(props.onGetNoteLinkRelations).mockImplementation(
        () =>
          new Promise(resolve => {
            finish = () => resolve(relation);
          })
      );
    act(() => {
      state.inspector.onOpenLinkedNote('target');
    });
    await waitFor(() => expect(finish).toBeTypeOf('function'));
    unmount();
    await act(async () => {
      finish();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(props.onOpenNote).not.toHaveBeenCalled();
  });
});
describe('没有正文标记的旧格式重点', () => {
  it.each(['onReanchorAnnotation', 'onCreateAnnotationExclusion'])('%s 直接拒绝，不保存正文', async action => {
    const props = fixture();
    render(<NoteEditorView {...props} />);
    await screen.findByTestId('mutation-editor');
    await expect(state.inspector[action](annotation)).rejects.toThrow('这条重点没有正文标记');
    expect(props.onSaveMarkdown).not.toHaveBeenCalled();
  });
});
