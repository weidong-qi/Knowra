import type { KnowledgeSlice } from './slices/knowledgeSlice';
import type { TrainingSlice } from './slices/trainingSlice';
import type { CommandNoteLoadInput, CommandNoteLoadResult } from './commandNoteOpening';
import type {
  WorkspaceDataMode,
  WorkspaceServerData,
  WorkspaceSnapshot,
  WorkspaceLoadState,
  WorkspaceApi,
  CommandNoteSearcher,
  KeyValueStorage,
  Attachment,
  AttachmentDeleteResult,
  AttachmentDeletionPreflight,
  AttachmentCleanupStatus,
  Annotation,
  Note,
  Folder,
  NoteVersion,
  NoteVersionPage,
  NoteQueryInput,
  NoteQueryPage,
  CreateAnnotationInput,
  UpdateAnnotationAnchorInput,
  UpdateAnnotationInput,
  AnnotationPreview,
  AnnotationKnowledgeLinks,
  AnalysisScopeInput,
  AnalysisScopePreview,
  AnalysisScopeSnapshot,
  AnnotationExclusionResult,
  UploadAttachmentInput,
  Tag,
  TagColor,
  TagGroup
} from '@study-accelerator/web-core';

export interface WorkspaceDependencies {
  persistenceMode?: 'remote' | 'desktop-local';
  api: WorkspaceApi;
  storage?: KeyValueStorage | null;
  cacheKey: string;
  mockSnapshot: WorkspaceSnapshot;
}

export interface WorkspaceSlice {
  knowledgeExtraction?: import('@study-accelerator/web-core').KnowledgeExtractionApi;
  searchCommandNotes?: CommandNoteSearcher;
  loadCommandNote(input: CommandNoteLoadInput): Promise<CommandNoteLoadResult | null>;
  persistenceMode: 'remote' | 'desktop-local';
  knowledgeGeneration: number;
  serverData: WorkspaceServerData;
  dataMode: WorkspaceDataMode;
  workspaceLoadState: WorkspaceLoadState;
  workspaceError: string | null;
  loadWorkspace(): Promise<void>;
  retryWorkspace(): Promise<void>;
  refreshLocalWorkspace(): Promise<boolean>;
  canWriteWorkspace(): boolean;
  selectKnowledgeSpace(id: string): Promise<void>;
  createKnowledgeSpace(name: string): Promise<import('@study-accelerator/web-core').KnowledgeSpace>;
  inspectEmptySpaceDeletion(id: string): Promise<import('@study-accelerator/web-core').SpaceDeletionPreview>;
  deleteEmptySpace(id: string, expectedUpdatedAt: string): Promise<void>;
  previewSpaceMigration(sourceId: string, targetId: string): Promise<import('@study-accelerator/web-core').SpaceMigrationPreview>;
  migrateSpaceAssets(sourceId: string, targetId: string, expectedPreviewHash: string): Promise<void>;
  createNote(folderId: string | null, title: string): Promise<string>;
  importMarkdownNotes(
    folderId: string | null,
    sources: Array<{ fileName: string; rawMarkdown: string }>
  ): Promise<{ firstNoteId: string; count: number }>;
  duplicateNote(noteId: string): Promise<string>;
  createFolder(parentId: string | null, name: string): Promise<string>;
  renameNote(noteId: string, title: string): Promise<void>;
  loadNoteContent(noteId: string): Promise<void>;
  saveNoteContent(noteId: string, rawMarkdown: string, expectedUpdatedAt?: string, baseMarkdown?: string, annotationMapping?: import('@study-accelerator/web-core').AnnotationMapping): Promise<Note>;
  deleteNote(noteId: string): Promise<void>;
  restoreNote(noteId: string): Promise<void>;
  permanentlyDeleteNote(noteId: string): Promise<void>;
  setNoteFavorite(noteId: string, favorite: boolean): Promise<void>;
  setNoteTags(noteId: string, tagIds: string[]): Promise<void>;
  createTag(input: { name: string; color: TagColor; groupId: string }): Promise<Tag>;
  updateTag(tagId: string, input: { name?: string; color?: TagColor; groupId?: string; sortOrder?: number }): Promise<Tag>;
  deleteTag(tagId: string): Promise<void>;
  mergeTags(sourceTagId: string, targetTagId: string): Promise<void>;
  reorderTags(tagIds: string[]): Promise<void>;
  createTagGroup(input: { name: string; selectionMode: 'single' | 'multiple' }): Promise<TagGroup>;
  updateTagGroup(groupId: string, input: { name?: string; selectionMode?: 'single' | 'multiple'; sortOrder?: number }): Promise<TagGroup>;
  deleteTagGroup(groupId: string): Promise<void>;
  deleteNotes(noteIds: string[]): Promise<void>;
  assignTagToNotes(noteIds: string[], tagId: string): Promise<void>;
  updateTagsForNotes(noteIds: string[], addTagIds: string[], removeTagIds: string[]): Promise<void>;
  queryNotes(input: NoteQueryInput): Promise<NoteQueryPage>;
  getLinkedNotes(noteId: string): Promise<Note[]>;
  getNoteLinkRelations(noteId: string): Promise<import('@study-accelerator/web-core').NoteLinkRelations>;
  listAnnotations(noteId: string): Promise<Annotation[]>;
  createAnnotation(input: CreateAnnotationInput): Promise<Annotation>;
  deleteAnnotation(annotationId: string, expectedRevision?: number): Promise<Annotation>;
  restoreAnnotation(annotationId: string, expectedRevision?: number): Promise<Annotation>;
  updateAnnotationAnchor(annotationId: string, input: UpdateAnnotationAnchorInput): Promise<Annotation>;
  updateAnnotation(annotationId: string, input: UpdateAnnotationInput): Promise<Annotation>;
  confirmAnnotationRange(annotationId: string, input: import('@study-accelerator/web-core').ConfirmAnnotationRangeInput): Promise<Annotation>;
  previewAnnotation(annotationId: string): Promise<AnnotationPreview>;
  getAnnotationKnowledgeLinks(annotationId: string): Promise<AnnotationKnowledgeLinks>;
  previewAnalysisScope(input: AnalysisScopeInput): Promise<AnalysisScopePreview>;
  createAnalysisScope(input: AnalysisScopeInput & { previewHash: string; idempotencyKey: string }): Promise<{ id: string }>;
  listAnalysisScopes(spaceId: string): Promise<AnalysisScopeSnapshot[]>;
  trashAnalysisScope(id: string, input: { spaceId: string; expectedUpdatedAt: string }): Promise<AnalysisScopeSnapshot>;
  restoreAnalysisScope(id: string, input: { spaceId: string; expectedUpdatedAt: string }): Promise<AnalysisScopeSnapshot>;
  createAnnotationExclusion(annotationId: string, input: { expectedRevision: number; noteContentHash: string; anchor: import('@study-accelerator/web-core').ContentAnchor }): Promise<AnnotationExclusionResult>;
  deleteAnnotationExclusion(annotationId: string, exclusionId: string, expectedRevision: number): Promise<AnnotationExclusionResult>;
  listNoteVersions(noteId: string): Promise<NoteVersion[]>;
  listNoteVersionPage(noteId: string, options?: { limit?: number; cursor?: string }): Promise<NoteVersionPage>;
  previewNoteVersionPrune(noteId: string): Promise<import('@study-accelerator/web-core').NoteVersionPrunePreview>;
  saveNoteVersionAs(noteId: string, versionId: string): Promise<string>;
  getNoteVersion(noteId: string, versionId: string): Promise<NoteVersion>;
  organizeNote(noteId: string, input: { folderId: string | null; status: string }): Promise<void>;
  setNoteAiVisibility(noteId: string, input: { aiVisibility: 'normal' | 'private'; expectedUpdatedAt: string }): Promise<void>;
  listNoteAttachments(noteId: string): Promise<Attachment[]>;
  uploadNoteAttachment(input: UploadAttachmentInput): Promise<Attachment>;
  renameNoteAttachment(attachmentId: string, fileName: string): Promise<Attachment>;
  deleteNoteAttachment(attachmentId: string): Promise<AttachmentDeleteResult>;
  inspectAttachmentDeletion(attachmentId: string): Promise<AttachmentDeletionPreflight>;
  verifyNoteAttachment(attachmentId: string): Promise<Attachment>;
  restoreNoteAttachment(attachmentId: string, contentBase64: string): Promise<Attachment>;
  listAttachmentCleanup(): Promise<AttachmentCleanupStatus>;
  retryAttachmentCleanup(): Promise<{ completed: number; pending: number }>;
  moveEntry(kind: 'note' | 'folder', id: string, parentId: string | null): Promise<void>;
  renameFolder(folderId: string, name: string): Promise<void>;
  deleteFolder(folderId: string, input: { mode: 'keep' | 'with-content'; destinationId?: string | null }): Promise<void>;
  restoreFolder(folderId: string): Promise<void>;
  listDeletedFolders(spaceId: string): Promise<Folder[]>;
  emptyRecycleBin(): Promise<number>;
}

export type WorkDomain = 'materials' | 'knowledge' | 'training' | 'learning' | 'profile' | 'task-workspaces';

export const WORK_DOMAINS: readonly WorkDomain[] = [
  'materials',
  'knowledge',
  'training',
  'learning',
  'task-workspaces',
  'profile'
] as const;

export interface NavigationState {
  activeWorkDomain: WorkDomain;
  activeDomainView: string;
  selectedFolderId: string | null;
  selectedNoteId: string | null;
  openFolders: Record<string, boolean>;
  openNoteTabs: string[];
}

export interface NavigationSlice {
  navigation: NavigationState;
  selectFolder(folderId: string | null): void;
  selectNote(noteId: string | null): void;
  closeNoteTab(noteId: string): string | null;
  closeOtherNoteTabs(noteId: string): void;
  reorderNoteTabs(sourceNoteId: string, targetNoteId: string): void;
  toggleFolder(folderId: string): void;
  setActiveWorkDomain(domain: WorkDomain): void;
}

export type NotesIndexScope = 'all' | 'recent' | 'favorites' | 'unfiled' | 'root' | 'trash';

export interface NotesIndexState {
  scope: NotesIndexScope;
  selectedTagId: string | null;
  query: string;
  matchingNoteIds: string[] | null;
  searchState: 'idle' | 'loading' | 'ready' | 'error';
}

export interface NotesIndexSlice {
  notesIndex: NotesIndexState;
  selectNotesScope(scope: NotesIndexScope): void;
  selectNotesFolder(folderId: string | null): void;
  selectNotesTag(tagId: string | null): void;
  setNotesQuery(query: string): void;
  searchNotes(query: string): Promise<void>;
}

export interface StatusSlice {
  editorHasLocalChanges: boolean;
  editorSaveError: string | null;
  setEditorHasLocalChanges(value: boolean, error?: string | null): void;
  statusMessage: string;
  saveState: 'idle' | 'saving' | 'saved' | 'error';
  saveError: string | null;
  setStatusMessage(message: string): void;
  beginSave(message?: string): void;
  finishSave(message?: string): void;
  failSave(error: unknown): void;
}

export type AppStore = WorkspaceSlice & NavigationSlice & NotesIndexSlice & StatusSlice & KnowledgeSlice & TrainingSlice;
