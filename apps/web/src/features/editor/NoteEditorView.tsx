import { useExtractionEnvironment } from './ExtractionEnvironment';
import type { AttachmentDeleteResult } from '@study-accelerator/web-core';
import type { AttachmentActions } from './EditorAttachmentPanel';
import { registerDesktopSave } from '../../app/desktopLifecycle';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useDesktopTitlebar } from '../../shell/DesktopTitlebarContext';
import {
  buildExportFileName,
  type Annotation,
  type Attachment,
  type CreateAnnotationInput,
  type Folder,
  type Note,
  type NoteVersion,
  type NoteVersionPage,
  type NoteVersionPageOptions,
  type NoteVersionPrunePreview,
  type Tag,
  type TagColor,
  type TagGroup,
  type UpdateAnnotationAnchorInput,
  type UpdateAnnotationInput,
  type AnnotationPreview,
  type AnnotationKnowledgeLinks,
  type AnalysisScopeInput,
  type AnalysisScopePreview,
  type UploadAttachmentInput
} from '@study-accelerator/web-core';
import { downloadTextFile } from '../../browser/downloadFile';
import { exportElementToPdf } from '../../browser/exportPdf';
import { Button } from '../../components/ui';
import { NoteIcon } from '../../components/icons/knowra';
import { EditorDocumentHeader, type EditorDocumentHeaderHandle } from './EditorDocumentHeader';
import { EditorContentPanes } from './EditorContentPanes';
import { EditorPageLayout } from './EditorPageLayout';
import { EditorSaveConflictFeedback } from './EditorSaveConflictFeedback';
import { EditorDocumentRepairDialog } from './EditorDocumentRepairDialog';
import { EditorFindReplacePanel } from './EditorFindReplacePanel';
import { EditorInspector } from './EditorInspector';
import { EditorTabs } from './EditorTabs';
import { EditorToolbar } from './EditorToolbar';
import type {
  EditorCommand,
  EditorCommandTarget,
  EditorEditAction,
  EditorFileAction,
  EditorFindMode
} from './editorCommands';
import type { EditorViewAction, EffectiveEditorViewState } from './editorViewState';
import { useEditorViewport } from './useEditorViewport';
import { useEditorSavedActions } from './useEditorSavedActions';
import { noteDraftRecovery } from './noteDraftRecovery';
import { getNoteDraftScope } from './noteDraftScope';
import { useNoteAutosave } from './useNoteAutosave';
import { useEditorInspectorData } from './useEditorInspectorData';
import { useEditorAnnotationWrites } from './useEditorAnnotationWrites';
import { useInlineAnnotationWrites } from './useInlineAnnotationWrites';
import { INLINE_IMAGE_ACCEPT } from './attachmentFiles';
import { useEditorAttachments } from './useEditorAttachments';
import { EditorAttachmentFeedback } from './EditorAttachmentFeedback';
import styles from './NoteEditorView.module.css';
import { EditorNoteLinkDialog } from './EditorNoteLinkDialog';
import { useEditorNoteLinks } from './useEditorNoteLinks';
import { buildFolderPath } from './editorInspectorModel';

export interface NoteEditorViewProps {
  note: Note | null;
  folder: Folder | null;
  foldersById: Record<string, Folder>;
  notes: Note[];
  tags: Tag[];
  tagGroups?: TagGroup[];
  openNotes: Note[];
  inspectorOpen: boolean;
  view: EffectiveEditorViewState;
  canWrite: boolean;
  favoritePending?: boolean;
  onOpenNote(noteId: string): void;
  onCloseNote(noteId: string): void;
  onCloseOtherNotes(noteId: string): void;
  onReorderNotes(sourceNoteId: string, targetNoteId: string): void;
  onCopyTabPath(note: Note): void;
  onCreateNote(): void;
  onReturnToList?(): void;
  onCreateFolder(): void;
  onImportMarkdown(): void;
  onRenameNote(title: string): Promise<void>;
  onSaveMarkdown(
    noteId: string,
    markdown: string,
    expectedUpdatedAt?: string,
    baseMarkdown?: string,
    annotationMapping?: import('@study-accelerator/web-core').AnnotationMapping
  ): Promise<Note>;
  onDraftStateChange?(hasLocalChanges: boolean, error?: string | null): void;
  extendedWritesEnabled?: boolean;
  onSaveAs(): Promise<void>;
  onDeleteNote(): void;
  onSetTags(tagIds: string[]): Promise<void>;
  onCreateTag?(input: { name: string; color: TagColor; groupId: string }): Promise<Tag>;
  onUpdateTag?(tagId: string, input: { name?: string; color?: TagColor; groupId?: string }): Promise<Tag>;
  onDeleteTag?(tagId: string): Promise<void>;
  onMergeTags?(sourceTagId: string, targetTagId: string): Promise<void>;
  onOpenTagManager?(): void;
  onOpenTag?(tagId: string): void;
  onListVersions(noteId: string): Promise<NoteVersion[]>;
  onListVersionPage?(noteId: string, options?: NoteVersionPageOptions): Promise<NoteVersionPage>;
  onPreviewVersionPrune?(noteId: string): Promise<NoteVersionPrunePreview>;
  onSaveVersionAs?(version: NoteVersion): Promise<void>;
  onGetVersion(noteId: string, versionId: string): Promise<NoteVersion>;
  onOrganizeNote(input: { folderId: string | null; status: string }): Promise<void>;
  onListAttachments(noteId: string): Promise<Attachment[]>;
  onUploadAttachment(input: UploadAttachmentInput): Promise<Attachment>;
  onRenameAttachment(attachmentId: string, fileName: string): Promise<Attachment>;
  onDeleteAttachment(attachmentId: string): Promise<AttachmentDeleteResult | void>;
  attachmentActions?: AttachmentActions;
  onGetLinkedNotes(noteId: string): Promise<Note[]>;
  onGetNoteLinkRelations?(noteId: string): Promise<import('@study-accelerator/web-core').NoteLinkRelations>;
  onSearchLinkNotes?: import('@study-accelerator/web-core').CommandNoteSearcher;
  onListAnnotations(noteId: string): Promise<Annotation[]>;
  onCreateAnnotation(input: CreateAnnotationInput): Promise<Annotation>;
  onDeleteAnnotation(annotationId: string, expectedRevision?: number): Promise<Annotation>;
  onRestoreAnnotation?(annotationId: string, expectedRevision?: number): Promise<Annotation>;
  onUpdateAnnotationAnchor(annotationId: string, input: UpdateAnnotationAnchorInput): Promise<Annotation>;
  onUpdateAnnotation?(annotationId: string, input: UpdateAnnotationInput): Promise<Annotation>;
  onConfirmAnnotationRange?(
    annotationId: string,
    input: import('@study-accelerator/web-core').ConfirmAnnotationRangeInput
  ): Promise<Annotation>;
  onPreviewAnnotation?(annotationId: string): Promise<AnnotationPreview>;
  onGetAnnotationKnowledgeLinks?(annotationId: string): Promise<AnnotationKnowledgeLinks>;
  onCreateKnowledgeCandidate?(annotation: Annotation): Promise<void>;
  onOpenKnowledgeItem?(itemId: string): void;
  onExtractWithAssistant?(noteId: string): void;
  knowledgeWriteDisabledReason?: string;
  onPreviewAnalysisScope?(input: AnalysisScopeInput): Promise<AnalysisScopePreview>;
  onCreateAnalysisScope?(
    input: AnalysisScopeInput & { previewHash: string; idempotencyKey: string }
  ): Promise<{ id: string }>;
  onListAnalysisScopes?(spaceId: string): Promise<import('@study-accelerator/web-core').AnalysisScopeSnapshot[]>;
  onTrashAnalysisScope?(
    id: string,
    input: { spaceId: string; expectedUpdatedAt: string }
  ): Promise<import('@study-accelerator/web-core').AnalysisScopeSnapshot>;
  onRestoreAnalysisScope?(
    id: string,
    input: { spaceId: string; expectedUpdatedAt: string }
  ): Promise<import('@study-accelerator/web-core').AnalysisScopeSnapshot>;
  onCreateAnnotationExclusion?(
    annotationId: string,
    input: {
      expectedRevision: number;
      noteContentHash: string;
      anchor: import('@study-accelerator/web-core').ContentAnchor;
    }
  ): Promise<{ annotation: Annotation }>;
  onDeleteAnnotationExclusion?(
    annotationId: string,
    exclusionId: string,
    expectedRevision: number
  ): Promise<{ annotation: Annotation }>;
  onFileStatus(message: string): void;
  onViewAction(action: EditorViewAction): void;
  onToggleFavorite(): void;
  onToggleInspector(): void;
}

export function NoteEditorView({
  note,
  folder,
  foldersById,
  notes,
  tags,
  tagGroups = [],
  openNotes,
  inspectorOpen,
  view,
  canWrite,
  favoritePending = false,
  onOpenNote,
  onCloseNote,
  onCloseOtherNotes,
  onReorderNotes,
  onCopyTabPath,
  onCreateNote,
  onReturnToList,
  onCreateFolder,
  onImportMarkdown,
  onRenameNote,
  onSaveMarkdown,
  onDraftStateChange,
  extendedWritesEnabled = true,
  onSaveAs,
  onDeleteNote,
  onSetTags,
  onCreateTag,
  onUpdateTag,
  onDeleteTag,
  onMergeTags,
  onOpenTagManager,
  onOpenTag,
  onListVersions,
  onListVersionPage,
  onPreviewVersionPrune,
  onSaveVersionAs,
  onGetVersion,
  onOrganizeNote,
  onListAttachments,
  onUploadAttachment,
  onRenameAttachment,
  onDeleteAttachment,
  attachmentActions,
  onGetLinkedNotes,
  onGetNoteLinkRelations,
  onSearchLinkNotes,
  onListAnnotations,
  onCreateAnnotation,
  onDeleteAnnotation,
  onRestoreAnnotation,
  onUpdateAnnotationAnchor,
  onUpdateAnnotation,
  onPreviewAnnotation,
  onConfirmAnnotationRange,
  onGetAnnotationKnowledgeLinks,
  onCreateKnowledgeCandidate,
  onOpenKnowledgeItem,
  onExtractWithAssistant,
  knowledgeWriteDisabledReason,
  onPreviewAnalysisScope,
  onCreateAnalysisScope,
  onListAnalysisScopes,
  onTrashAnalysisScope,
  onRestoreAnalysisScope,
  onCreateAnnotationExclusion,
  onDeleteAnnotationExclusion,
  onFileStatus,
  onViewAction,
  onToggleFavorite,
  onToggleInspector
}: NoteEditorViewProps) {
  const desktopTitlebar = useDesktopTitlebar();
  const {
    documentStageRef,
    paperRef,
    toolbarAnchorRef,
    toolbarRef,
    toolbarPinned,
    documentEdge,
    saveCurrentScrollPosition,
    restoreCurrentScrollPosition
  } = useEditorViewport(note?.id);
  const editorRef = useRef<EditorCommandTarget>(null);
  const documentHeaderRef = useRef<EditorDocumentHeaderHandle>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const [editPanelMode, setEditPanelMode] = useState<EditorFindMode | null>(null);
  const [repairDialogOpen, setRepairDialogOpen] = useState(false);
  const [discardDraftOpen, setDiscardDraftOpen] = useState(false);
  const [overlappingAnnotationIds, setOverlappingAnnotationIds] = useState<string[]>([]);
  useEffect(() => setOverlappingAnnotationIds([]), [note?.id]);
  const autosave = useNoteAutosave({
    noteId: note?.id ?? 'missing-note',
    // 列表摘要的占位正文不是恢复基线，等详情加载完成后再读取草稿。
    draftScope: note?.contentLoaded === false ? undefined : getNoteDraftScope(note?.spaceId),
    remoteMarkdown: note?.rawMarkdown ?? '',
    remoteUpdatedAt: note?.updatedAt,
    canWrite: Boolean(note && canWrite),
    onSave: onSaveMarkdown
  });
  useEffect(
    () =>
      registerDesktopSave(async mode => {
        const markdown = view.showSourceEditor ? autosave.getLatestMarkdown() : editorRef.current?.getMarkdown();
        if (markdown !== undefined && markdown !== autosave.getLatestMarkdown()) {
          autosave.updateDraft(markdown, { immediate: true });
        }
        if (
          mode !== 'recovery' &&
          markdown !== undefined &&
          (autosave.hasLocalChanges || markdown !== note?.rawMarkdown)
        ) {
          await autosave.saveNow(markdown);
        }
      }, 0),
    [autosave, note?.rawMarkdown, view.showSourceEditor]
  );

  const extractionEnvironment = useExtractionEnvironment();
  const savedActions = useEditorSavedActions({
    note,
    canWrite,
    showSourceEditor: view.showSourceEditor,
    extractionScope: extractionEnvironment.scopeKey,
    editorRef,
    autosave,
    onPreviewAnalysisScope,
    onCreateKnowledgeCandidate,
    onExtractWithAssistant,
    onSaveVersionAs,
    onFileStatus
  });
  const draftMarkdown = autosave.draftMarkdown;
  const canEditContent = canWrite && view.contentMode === 'edit' && !view.showSourceEditor;
  const noteLinks = useEditorNoteLinks({
    note,
    canWrite,
    canEditContent,
    refreshKey: notes,
    editorRef,
    autosave,
    onGetNoteLinkRelations,
    onOpenNote,
    onFileStatus,
    saveCurrentScrollPosition,
    restoreCurrentScrollPosition
  });
  useEffect(() => {
    onDraftStateChange?.(autosave.hasLocalChanges, autosave.saveError);
  }, [autosave.hasLocalChanges, autosave.saveError, onDraftStateChange]);
  useEffect(() => () => onDraftStateChange?.(false), [onDraftStateChange]);
  const {
    attachments,
    setAttachments,
    attachmentsLoading,
    linkedNotes,
    linkedNotesLoading,
    annotations,
    setAnnotations,
    annotationsLoading,
    annotationsReady,
    focusedAnnotationId,
    setFocusedAnnotationId
  } = useEditorInspectorData({
    noteId: note?.id,
    refreshKey: note?.updatedAt,
    inspectorOpen,
    onListAttachments,
    onGetLinkedNotes,
    onListAnnotations,
    onError: onFileStatus
  });

  const editorAttachments = useEditorAttachments({
    noteId: note?.id,
    canWrite,
    showSourceEditor: view.showSourceEditor,
    extendedWritesEnabled,
    editorRef,
    autosave,
    attachments,
    setAttachments,
    attachmentActions,
    onListAttachments,
    onUploadAttachment,
    onRenameAttachment,
    onDeleteAttachment,
    onFileStatus
  });

  const {
    createCurrentAnnotation: createLegacyAnnotation,
    reanchorAnnotation: reanchorLegacyAnnotation,
    excludeCurrentBlock: excludeLegacyBlock
  } = useEditorAnnotationWrites({
    note,
    canEditContent,
    editorRef,
    autosave,
    onListAnnotations,
    onCreateAnnotation,
    onUpdateAnnotationAnchor,
    onCreateAnnotationExclusion,
    onFileStatus,
    onCreated: created => {
      setAnnotations(current => [...current.filter(item => item.id !== created.id), created]);
      setFocusedAnnotationId(created.id);
    },
    onUpdated: (updated, focus) => {
      setAnnotations(current => current.map(item => (item.id === updated.id ? updated : item)));
      if (focus) setFocusedAnnotationId(updated.id);
    }
  });

  // 重点内联化：没有活跃旧重点的笔记改为直接修改正文标记；还有旧重点的笔记仍走旧链路，等迁移后切换。
  const inlineWrites = useInlineAnnotationWrites({
    note,
    canEditContent,
    editorRef,
    autosave,
    annotations,
    annotationsLoading,
    annotationsReady,
    onListAnnotations,
    onUpdateAnnotation,
    setAnnotations,
    setFocusedAnnotationId,
    onFileStatus
  });
  // 用最新一次渲染的分流结果：列表加载期间先等加载完成（最多 5 秒），再决定走正文标记还是旧链路。
  const inlineWritesRef = useRef(inlineWrites);
  inlineWritesRef.current = inlineWrites;
  const annotationsLoadingRef = useRef(annotationsLoading);
  annotationsLoadingRef.current = annotationsLoading;
  const annotationContextRef = useRef({ noteId: note?.id, canEditContent });
  if (
    annotationContextRef.current.noteId !== note?.id ||
    annotationContextRef.current.canEditContent !== canEditContent
  )
    annotationContextRef.current = { noteId: note?.id, canEditContent };
  useEffect(
    () => () => {
      annotationContextRef.current = { ...annotationContextRef.current };
    },
    []
  );
  const createCurrentAnnotation = async (
    scope: 'selection' | 'blocks' | 'section' | 'list' = 'selection',
    importance: 'normal' | 'important' | 'core' = 'normal'
  ) => {
    const context = annotationContextRef.current;
    for (
      let waited = 0;
      context === annotationContextRef.current && annotationsLoadingRef.current && waited < 5000;
      waited += 50
    )
      await new Promise(resolve => setTimeout(resolve, 50));
    if (context !== annotationContextRef.current) throw new Error('笔记或编辑状态已变化，请重新选择重点');
    if (annotationsLoadingRef.current || !inlineWritesRef.current.ready)
      throw new Error('重点列表尚未成功加载，请稍后重试');
    if (inlineWritesRef.current.enabled) return inlineWritesRef.current.create(scope, importance);
    return createLegacyAnnotation(scope, importance);
  };
  const annotationById = (annotationId: string) => annotations.find(item => item.id === annotationId);
  const reanchorAnnotation = (annotation: Annotation) =>
    inlineWrites.owns(annotation) ? inlineWrites.reanchor(annotation) : reanchorLegacyAnnotation(annotation);
  const excludeCurrentBlock = (annotation: Annotation) =>
    inlineWrites.owns(annotation) ? inlineWrites.exclude(annotation) : excludeLegacyBlock(annotation);

  useEffect(() => {
    setEditPanelMode(null);
    setRepairDialogOpen(false);
  }, [note?.id]);

  if (!note) {
    return (
      <section className={styles.unavailable} aria-labelledby="editor-unavailable-title">
        <NoteIcon size={32} />
        <h1 id="editor-unavailable-title">未找到这篇笔记</h1>
        <p>它可能尚未加载、已被删除，或链接已经失效。</p>
      </section>
    );
  }

  const runCommand = (command: EditorCommand) => {
    if (!editorRef.current?.run(command)) return;
    window.requestAnimationFrame(() => editorRef.current?.focus());
  };
  const insertTable = (rows: number, columns: number) => {
    if (!editorRef.current?.insertTable?.(rows, columns)) return;
    window.requestAnimationFrame(() => editorRef.current?.focus());
  };
  const handleEditAction = async (action: EditorEditAction) => {
    if (action === 'repair-document') {
      setRepairDialogOpen(true);
      return;
    }
    if (action === 'find' || action === 'replace') {
      setEditPanelMode(action);
      return;
    }
    if (action === 'undo' || action === 'redo') {
      runCommand(action);
      return;
    }
    const result = await editorRef.current?.runEdit(action);
    if (!result?.ok) {
      const messages = {
        'empty-selection': '请先选中要编辑的内容',
        'clipboard-empty': '剪贴板为空',
        'clipboard-denied': '无法访问剪贴板，请检查浏览器权限',
        'context-changed': '正文、选区或编辑状态已变化，已取消剪切，请重新选择',
        unsupported: '当前环境暂不支持该编辑操作'
      } as const;
      onFileStatus(messages[result?.reason ?? 'unsupported']);
      return;
    }
    if (action === 'copy') onFileStatus('已复制所选内容');
    if (action === 'cut') onFileStatus('已剪切所选内容');
    if (action === 'paste') onFileStatus('已粘贴剪贴板内容');
  };
  const saveImmediately = async () => {
    if (!canWrite) return;
    const markdown = editorRef.current?.getMarkdown() ?? autosave.getLatestMarkdown();
    await autosave.saveNow(markdown);
  };
  const replaceAnnotation = (updated: Annotation) => {
    setAnnotations(current => current.map(item => (item.id === updated.id ? updated : item)));
  };
  const selectAnnotation = (annotationId: string) => {
    setOverlappingAnnotationIds([]);
    setFocusedAnnotationId(annotationId);
    if (!editorRef.current?.selectAnnotation(annotationId)) onFileStatus('原文位置已变化，请重新选择来源');
  };
  const openNoteSafely = (targetNoteId: string) => {
    saveCurrentScrollPosition();
    if (targetNoteId === note.id || !canWrite) {
      onOpenNote(targetNoteId);
      return;
    }
    void saveImmediately()
      .then(() => onOpenNote(targetNoteId))
      .catch(error => onFileStatus(error instanceof Error ? error.message : '切换前保存失败'));
  };
  const handleFileAction = async (action: EditorFileAction) => {
    switch (action) {
      case 'new-note':
        onCreateNote();
        return;
      case 'new-folder':
        onCreateFolder();
        return;
      case 'import-markdown':
        onImportMarkdown();
        return;
      case 'save':
        await saveImmediately();
        return;
      case 'save-as':
        await saveImmediately();
        await onSaveAs();
        return;
      case 'rename':
        onViewAction('mode-edit');
        window.setTimeout(() => documentHeaderRef.current?.focusTitle(), 0);
        return;
      case 'favorite-note':
        onToggleFavorite();
        return;
      case 'delete-note':
        onDeleteNote();
        return;
      case 'export-markdown': {
        const fileName = buildExportFileName(note.title, 'md');
        const markdown = editorRef.current?.getMarkdown() ?? autosave.getLatestMarkdown();
        downloadTextFile(fileName, markdown, 'text/markdown;charset=utf-8');
        onFileStatus(`已导出 Markdown：${fileName}`);
        return;
      }
      case 'export-pdf': {
        if (!paperRef.current) throw new Error('笔记纸张尚未准备好，无法导出 PDF');
        onFileStatus('正在生成 PDF…');
        const fileName = await exportElementToPdf(paperRef.current, note.title);
        onFileStatus(`已导出 PDF：${fileName}`);
      }
    }
  };

  const handleEditorPageKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (!(event.target instanceof HTMLElement) || !event.target.closest('.ProseMirror')) return;
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    const mod = event.metaKey || event.ctrlKey;
    if (!mod) return;
    const key = event.key.toLowerCase();
    if (
      ((event.metaKey && event.ctrlKey && !event.altKey) || (event.ctrlKey && event.altKey && !event.metaKey)) &&
      !event.shiftKey &&
      key === 'i' &&
      canEditContent &&
      extendedWritesEnabled
    ) {
      event.preventDefault();
      event.stopPropagation();
      imageInputRef.current?.click();
    } else if (event.altKey) {
      return;
    } else if (!event.shiftKey && key === 'f') {
      event.preventDefault();
      setEditPanelMode('find');
    } else if (!event.shiftKey && key === 'h' && canEditContent) {
      event.preventDefault();
      setEditPanelMode('replace');
    } else if (key === 's' && canWrite) {
      event.preventDefault();
      void handleFileAction(event.shiftKey ? 'save-as' : 'save').catch(error =>
        onFileStatus(error instanceof Error ? error.message : '保存失败')
      );
    }
  };

  const tabs = note ? (
    <EditorTabs
      notes={openNotes.length > 0 ? openNotes : [note]}
      activeNoteId={note.id}
      canWrite={canWrite}
      windowTitlebar={Boolean(desktopTitlebar.host)}
      onOpenNote={openNoteSafely}
      onCloseNote={closingNoteId => {
        if (closingNoteId !== note.id || !canWrite) {
          onCloseNote(closingNoteId);
          return;
        }
        saveCurrentScrollPosition();
        void saveImmediately()
          .then(() => onCloseNote(closingNoteId))
          .catch(error => onFileStatus(error instanceof Error ? error.message : '关闭前保存失败'));
      }}
      onCloseOtherNotes={onCloseOtherNotes}
      onReorderNotes={onReorderNotes}
      onCopyTabPath={onCopyTabPath}
      onCreateNote={onCreateNote}
    />
  ) : null;

  return (
    <EditorPageLayout
      view={view}
      inspectorOpen={inspectorOpen}
      titlebar={desktopTitlebar}
      documentEdge={documentEdge}
      documentStageRef={documentStageRef}
      paperRef={paperRef}
      onKeyDownCapture={handleEditorPageKeyDown}
      onAttachmentLink={editorAttachments.handleAttachmentLink}
      tabs={tabs}
      onReturnToList={() => {
        saveCurrentScrollPosition();
        if (!canWrite) {
          onReturnToList?.();
          return;
        }
        void saveImmediately()
          .then(() => onReturnToList?.())
          .catch(error => onFileStatus(error instanceof Error ? error.message : '返回前保存失败'));
      }}
      onToggleInspector={onToggleInspector}
      feedback={
        <EditorAttachmentFeedback
          preview={editorAttachments.bodyPreview}
          savedToken={editorAttachments.bodySavedToken}
          onClosePreview={editorAttachments.closePreview}
          onDismissDownload={editorAttachments.dismissDownload}
          onOpenSavedAttachment={editorAttachments.openSavedAttachment}
        />
      }
      inspector={
        <EditorInspector
          nativeTitlebar={desktopTitlebar.enabled}
          note={note}
          folder={folder}
          foldersById={foldersById}
          notes={notes}
          tags={tags}
          tagGroups={tagGroups}
          markdown={draftMarkdown}
          open={inspectorOpen}
          canWrite={canWrite}
          canInsertAttachment={canEditContent}
          extendedWritesEnabled={extendedWritesEnabled}
          attachmentActions={editorAttachments.actions}
          attachments={attachments}
          attachmentsLoading={attachmentsLoading}
          linkedNotes={linkedNotes}
          linkedNotesLoading={linkedNotesLoading}
          noteLinkRelations={noteLinks.relations.relations}
          noteLinkRelationsLoading={noteLinks.relations.loading}
          noteLinkRelationsError={noteLinks.relations.error}
          onOpenLinkedOccurrence={(sourceId, locator) => {
            void noteLinks.openLinkedNote(sourceId, locator);
          }}
          onOpenLinkedNote={id => {
            void noteLinks.openLinkedNote(id);
          }}
          annotations={annotations}
          annotationsLoading={annotationsLoading}
          focusedAnnotationId={focusedAnnotationId}
          overlappingAnnotationIds={overlappingAnnotationIds}
          onClearOverlappingAnnotations={() => setOverlappingAnnotationIds([])}
          onClose={onToggleInspector}
          onOpenNote={openNoteSafely}
          onSetTags={onSetTags}
          onCreateTag={onCreateTag}
          onUpdateTag={onUpdateTag}
          onDeleteTag={onDeleteTag}
          onMergeTags={onMergeTags}
          onOpenTagManager={onOpenTagManager}
          onOpenTag={onOpenTag}
          onListVersions={onListVersions}
          onListVersionPage={onListVersionPage}
          onPreviewVersionPrune={onPreviewVersionPrune}
          onRestoreVersion={savedActions.restoreVersion}
          onSaveVersionAs={savedActions.saveVersionAs}
          onGetVersion={onGetVersion}
          onOrganizeNote={onOrganizeNote}
          onUploadAttachment={editorAttachments.uploadAttachmentFile}
          onInsertAttachment={editorAttachments.insertStoredAttachment}
          onRenameAttachment={editorAttachments.renameAttachment}
          onDeleteAttachment={editorAttachments.deleteAttachment}
          onCreateAnnotation={createCurrentAnnotation}
          onSelectAnnotation={selectAnnotation}
          onDeleteAnnotation={async (annotationId, expectedRevision) => {
            const inline = annotationById(annotationId);
            const deleted = inlineWrites.owns(inline)
              ? await inlineWrites.remove(inline)
              : await onDeleteAnnotation(annotationId, expectedRevision);
            setAnnotations(current => current.filter(item => item.id !== annotationId));
            setFocusedAnnotationId(current => (current === annotationId ? null : current));
            return deleted;
          }}
          onRestoreAnnotation={async (annotationId, expectedRevision) => {
            if (inlineWrites.canRestore(annotationId)) {
              await inlineWrites.restore(annotationId);
              return;
            }
            if (!onRestoreAnnotation) throw new Error('当前环境不支持恢复重点');
            replaceAnnotation(await onRestoreAnnotation(annotationId, expectedRevision));
          }}
          onReanchorAnnotation={reanchorAnnotation}
          onUpdateAnnotation={
            onUpdateAnnotation
              ? async (annotationId, input) => {
                  const inline = annotationById(annotationId);
                  if (inlineWrites.owns(inline)) {
                    await inlineWrites.update(inline, input);
                    return;
                  }
                  replaceAnnotation(await onUpdateAnnotation(annotationId, input));
                }
              : undefined
          }
          onConfirmAnnotationRange={
            onConfirmAnnotationRange
              ? async (id, input) => replaceAnnotation(await onConfirmAnnotationRange(id, input))
              : undefined
          }
          onPreviewAnnotation={onPreviewAnnotation}
          onGetAnnotationKnowledgeLinks={onGetAnnotationKnowledgeLinks}
          onCreateKnowledgeCandidate={savedActions.createKnowledgeCandidate}
          onOpenKnowledgeItem={onOpenKnowledgeItem}
          onExtractWithAssistant={savedActions.extractWithAssistant}
          knowledgeWriteDisabledReason={knowledgeWriteDisabledReason}
          onPreviewAnalysisScope={savedActions.previewAnalysis}
          onCreateAnalysisScope={onCreateAnalysisScope}
          onListAnalysisScopes={onListAnalysisScopes}
          onTrashAnalysisScope={onTrashAnalysisScope}
          onRestoreAnalysisScope={onRestoreAnalysisScope}
          onCreateAnnotationExclusion={excludeCurrentBlock}
          onDeleteAnnotationExclusion={
            onDeleteAnnotationExclusion
              ? async (annotationId, exclusionId, expectedRevision) =>
                  replaceAnnotation(
                    (await onDeleteAnnotationExclusion(annotationId, exclusionId, expectedRevision)).annotation
                  )
              : undefined
          }
          onNavigateHeading={(_heading, index) => {
            const behavior = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
            if (editorRef.current?.navigateToHeading(index, behavior)) return;
            const heading = paperRef.current?.querySelectorAll<HTMLElement>(
              '.ProseMirror h1, .ProseMirror h2, .ProseMirror h3, .ProseMirror h4'
            )[index];
            heading?.scrollIntoView({
              block: 'start',
              behavior
            });
            if (heading) {
              const range = document.createRange();
              const selection = window.getSelection();
              range.selectNodeContents(heading);
              range.collapse(true);
              selection?.removeAllRanges();
              selection?.addRange(range);
              heading.closest<HTMLElement>('.ProseMirror')?.focus({ preventScroll: true });
            }
          }}
        />
      }
    >
      <EditorDocumentHeader
        ref={documentHeaderRef}
        note={note}
        folder={folder}
        canWrite={canEditContent}
        onRenameNote={onRenameNote}
      />
      <div ref={toolbarAnchorRef} className={styles.toolbarAnchor} aria-hidden="true" />
      <EditorToolbar
        toolbarRef={toolbarRef}
        pinned={toolbarPinned}
        favorite={note.favorite}
        favoritePending={favoritePending}
        canWrite={canWrite}
        canEditContent={canEditContent}
        canInsertImage={extendedWritesEnabled}
        inspectorOpen={inspectorOpen}
        view={view}
        onRunCommand={runCommand}
        onInsertTable={insertTable}
        onEditAction={action => {
          void handleEditAction(action);
        }}
        onViewAction={onViewAction}
        onFileAction={action => {
          void handleFileAction(action).catch(error => {
            onFileStatus(error instanceof Error ? error.message : '文件操作失败');
          });
        }}
        onToggleFavorite={onToggleFavorite}
        onToggleInspector={onToggleInspector}
        onInsertImage={() => imageInputRef.current?.click()}
      />
      <input
        ref={imageInputRef}
        className={styles.nativeFileInput}
        type="file"
        accept={INLINE_IMAGE_ACCEPT}
        aria-label="选择要插入的图片"
        disabled={!canEditContent || !extendedWritesEnabled}
        onChange={event => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = '';
          if (file)
            void editorAttachments.insertImageFile(file).catch(error => {
              onFileStatus(error instanceof Error ? error.message : '图片上传失败');
            });
        }}
      />
      <EditorFindReplacePanel
        mode={editPanelMode}
        editor={editorRef.current}
        onClose={() => setEditPanelMode(null)}
        onStatus={onFileStatus}
      />
      {noteLinks.navigationNotice ? (
        <div className={styles.linkNotice} role="status">
          <span>引用位置或来源版本已变化，已打开来源笔记</span>
          <Button variant="ghost" size="mini" onPress={() => noteLinks.dismissNavigationNotice()}>
            关闭提示
          </Button>
        </div>
      ) : null}
      {noteLinks.editSession ? (
        <EditorNoteLinkDialog
          session={noteLinks.editSession}
          spaceId={note.spaceId ?? ''}
          search={onSearchLinkNotes}
          folderPath={id => buildFolderPath(id ? (foldersById[id] ?? null) : null, foldersById)}
          canWrite={canEditContent}
          onClose={noteLinks.closeLink}
          onApply={noteLinks.applyLink}
        />
      ) : null}
      <EditorDocumentRepairDialog
        markdown={draftMarkdown}
        open={repairDialogOpen}
        onOpenChange={setRepairDialogOpen}
        onApply={(markdown, report) => {
          if (!editorRef.current?.replaceMarkdown(markdown)) {
            onFileStatus('文档内容未变更');
            return;
          }
          onFileStatus(`已修复 ${report.total} 处异常格式，可使用撤销恢复`);
        }}
      />
      <EditorSaveConflictFeedback
        visible={Boolean(autosave.saveError || autosave.hasConflict)}
        error={autosave.saveError}
        discardOpen={discardDraftOpen}
        onDiscardOpenChange={setDiscardDraftOpen}
        onRetry={() => {
          void autosave.saveNow().catch(error => onFileStatus(error instanceof Error ? error.message : '保存失败'));
        }}
        onExport={() => {
          const fileName = buildExportFileName(`${note.title}-冲突草稿`, 'md');
          downloadTextFile(fileName, autosave.getLatestMarkdown(), 'text/markdown;charset=utf-8');
          onFileStatus(`已导出本地冲突草稿：${fileName}`);
        }}
        onReload={() => {
          void noteDraftRecovery
            .flush()
            .then(() => window.location.reload())
            .catch(error => onFileStatus(error instanceof Error ? error.message : '草稿写入失败'));
        }}
        onDiscard={() => {
          autosave.discardRecoveredDraft();
          void noteDraftRecovery
            .flush()
            .then(() => window.location.reload())
            .catch(error => onFileStatus(String(error)));
        }}
      />
      <EditorContentPanes
        showSourceEditor={view.showSourceEditor}
        contentMode={view.contentMode}
        contentLoaded={note.contentLoaded}
        sourceProps={{
          markdown: draftMarkdown,
          readOnly: !canWrite,
          onChange: markdown => {
            autosave.updateDraft(markdown, { immediate: true });
            editorRef.current?.setMarkdown(markdown);
          },
          onSave: () => {
            void saveImmediately()
              .then(() => onFileStatus('源码已保存'))
              .catch(error => onFileStatus(error instanceof Error ? error.message : '源码保存失败'));
          }
        }}
        contextMenuProps={{
          enabled: note.contentLoaded && !view.showSourceEditor,
          canEdit: canEditContent,
          extendedWritesEnabled,
          onRunCommand: runCommand,
          onEditAction: action => {
            void handleEditAction(action);
          },
          onInsertImage: () => imageInputRef.current?.click(),
          onCreateAnnotation: () => {
            void createCurrentAnnotation('selection').catch(error =>
              onFileStatus(error instanceof Error ? error.message : '创建标注失败')
            );
          }
        }}
        editorProps={{
          ref: editorRef,
          noteId: note.id,
          markdown: draftMarkdown,
          readOnly: !canEditContent,
          allowExternalSync: !autosave.hasLocalChanges,
          onCreateAnnotation: extendedWritesEnabled ? createCurrentAnnotation : undefined,
          annotations,
          focusedAnnotationId,
          blockIdentity: note.annotationStructure?.identity ?? null,
          onChange: autosave.updateDraft,
          onSelectAnnotation: ids => {
            if (ids.length === 1) {
              setOverlappingAnnotationIds([]);
              setFocusedAnnotationId(ids[0]);
            } else {
              setOverlappingAnnotationIds(ids);
              if (!inspectorOpen) onToggleInspector();
            }
          },
          onStatus: onFileStatus,
          onRequestNoteLink: noteLinks.requestLink,
          onOpenNoteLink: locator => {
            void noteLinks.openLinkedNote(locator.targetNoteId);
          },
          noteLinkStatuses: noteLinks.statuses,
          onReady: noteLinks.onReady,
          onUploadImage: editorAttachments.uploadEditorImage
        }}
      />
    </EditorPageLayout>
  );
}
