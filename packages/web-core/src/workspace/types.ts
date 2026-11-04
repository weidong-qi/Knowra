export type WorkspaceDataMode = 'loading' | 'api' | 'cache' | 'local';
export type WorkspaceLoadState = 'idle' | 'loading' | 'ready' | 'error';

export interface EntityBase {
  id: string;
  createdAt?: string;
  updatedAt?: string;
  [key: string]: unknown;
}

export interface KnowledgeSpace extends EntityBase {
  name?: string;
  userId?: string;
  description?: string;
}

export interface Folder extends EntityBase {
  name: string;
  spaceId?: string;
  parentId: string | null;
  pathCache?: string;
  children: Folder[];
  deletedAt?: string | null;
  deletionPackage?: {
    id: string;
    mode: 'keep' | 'with-content';
    folderIds: string[];
    noteIds: string[];
    destinationId: string | null;
  } | null;
}

export type NoteAiVisibility = 'normal' | 'private';

export interface Note extends EntityBase {
  contentKind?: 'markdown' | 'pdf';
  pdfSource?: { attachmentId: string; sha256: string; importRequestHash?: string } | null;
  aiVisibility?: NoteAiVisibility;
  title: string;
  spaceId?: string;
  folderId: string | null;
  tagIds: string[];
  internalLinks: string[];
  rawMarkdown: string;
  plainText?: string;
  contentHash?: string | null;
  status?: string;
  sourceType?: string;
  contentLoaded: boolean;
  favorite: boolean;
  deleted: boolean;
  /** 服务端标注结构；前端只读取其中可选的块身份表（稳定身份迁移 S2b）。 */
  annotationStructure?: { identity?: AnnotationIdentityTable } | null;
}

/** 块身份表：按 Markdown 块顺序记录编辑器块 ID，正文哈希不一致时无效。 */
export interface AnnotationIdentityTable {
  formatVersion: 2;
  contentHash: string;
  blocks: Array<{ id: string; type: string }>;
}

export interface NoteVersion extends EntityBase {
  noteId: string;
  content: string;
  contentHash: string;
  createdAt: string;
  createdBy: string;
}

export interface NoteVersionSummary {
  id: string;
  noteId: string;
  contentHash: string;
  createdAt: string;
  createdBy: string;
}

export interface NoteVersionPage {
  items: NoteVersionSummary[];
  total: number;
  currentVersionId: string | null;
  nextCursor: string | null;
}

export interface NoteVersionPageOptions {
  limit?: number;
  cursor?: string;
}

export type AttachmentStatus = 'pending' | 'ready' | 'missing' | 'corrupt' | 'failed';
export type AttachmentCleanup = 'complete' | 'pending-retry' | 'retained-local';
export interface AttachmentDeleteResult extends Attachment {
  cleanup: AttachmentCleanup;
}
export interface AttachmentDeletionReference {
  category: string;
  collection: string;
  id: string;
  title?: string;
  noteId?: string;
  knowledgeItemId?: string;
  retention?: 'recycle-bin';
  reasonCode: string;
}
export interface AttachmentDeletionPreflight {
  asset: { type: 'attachment'; id: string };
  operation: string;
  decision: 'requires-dependency-action' | 'can-purge-no-history';
  references: AttachmentDeletionReference[];
  reasonCodes: string[];
  coverage: { persistedCurrentAndHistory: boolean; offlineDevices: string; backups: string; runningTasks: string };
}
export interface AttachmentCleanupTask {
  attachmentId: string | null;
  fileName: string;
  noteId?: string | null;
  createdAt?: string;
  cleanup: 'pending-retry';
  reasonCode: string;
}
export interface AttachmentCleanupStatus {
  items: AttachmentCleanupTask[];
  pending: number;
}

export interface Attachment extends EntityBase {
  noteId: string;
  fileName: string;
  mimeType: string;
  size: number;
  status: AttachmentStatus | (string & {});
  sha256?: string | null;
  verifiedAt?: string | null;
}

export type TagColor = 'neutral' | 'blue' | 'green' | 'orange' | 'red' | 'violet';

export interface Tag extends EntityBase {
  name?: string;
  color?: TagColor;
  spaceId?: string;
  groupId?: string | null;
  code?: string | null;
  isSystem?: boolean;
  sortOrder?: number;
}

export interface TagGroup extends EntityBase {
  spaceId: string;
  code?: string | null;
  name: string;
  selectionMode: 'single' | 'multiple';
  isSystem: boolean;
  sortOrder: number;
}

export interface Annotation extends EntityBase {
  spaceId: string;
  noteId: string;
  noteVersionId: string | null;
  schemaVersion?: number;
  scopeType?: 'selection' | 'blocks' | 'section' | 'list';
  kind: string;
  importance?: null | 'normal' | 'important' | 'core';
  comment?: string;
  sourceMode: string;
  quoteText: string;
  headingPath: string[];
  fromPosition: number;
  toPosition: number;
  prefixText: string;
  suffixText: string;
  anchorFingerprint: string;
  noteContentHash: string;
  idempotencyKey: string;
  status: string;
  lifecycleStatus?: 'active' | 'archived' | 'deleted';
  anchorStatus?: 'resolved' | 'needsReview' | 'missing';
  anchorReason?: string | null;
  revision?: number;
  anchor?: ContentAnchor | null;
  originSnapshot?: AnnotationOriginSnapshot | null;
  resolvedContentHash?: string | null;
  boundaryFingerprint?: string | null;
  deletedAt?: string | null;
}

export interface ContentAnchor {
  tracking?: {
    formatVersion?: number;
    empty?: boolean;
    emptyPosition?: number;
    emptyType?: string;
    [key: string]: unknown;
  };
  pending?: { anchor: ContentAnchor; contentHash: string; reason: string } | null;
  projectionVersion: number;
  scopeType: 'selection' | 'blocks' | 'section' | 'list';
  segments: Array<{ start: number; end: number; path: string }>;
  structurePath: string | null;
  quoteText: string;
  prefixText: string;
  suffixText: string;
  sourceStart: number;
  sourceEnd: number;
  projectedStart: number;
  projectedEnd: number;
  list?: {
    itemPath: string;
    parentItemPath: string | null;
    depth: number;
    ordered: boolean;
    childCount: number;
    memberFingerprint: string;
  };
  section?: Record<string, unknown>;
}

export interface AnnotationOriginSnapshot {
  noteVersionId?: string | null;
  contentHash: string;
  scopeType: 'selection' | 'blocks' | 'section' | 'list';
  segments: Array<{ start: number; end: number; path: string }>;
  quoteText: string;
  headingPath: string[];
}

export type { KnowledgeItem } from './knowledge-types.ts';

export interface LearningObjective extends EntityBase {
  knowledgeItemId: string;
  objective: string;
  actionVerb: string;
  cognitiveLevel: string;
  difficultyHint: string | null;
  reviewStatus?: string;
  reviewNote: string | null;
  order: number;
  questionCount?: number;
  questionIds?: string[];
}

export interface QuestionSource extends EntityBase {
  sourceType: string;
  sourceId: string | null;
  quote: string;
  locator: Record<string, unknown> | null;
  contentHash: string | null;
  status?: string;
  label?: string;
}

export interface Question extends EntityBase {
  stem: string;
  questionType: string;
  options: unknown[] | null;
  referenceAnswer: unknown | null;
  rubric: unknown | null;
  explanation: string;
  difficulty: string | null;
  sourceMode: string;
  reviewStatus?: string;
  version?: number;
  learningObjectiveIds?: string[];
  sources: QuestionSource[];
}

export interface WorkspaceSnapshot {
  spaces: KnowledgeSpace[];
  currentSpaceId: string | null;
  folderTree: Folder[];
  tags: Tag[];
  tagGroups?: TagGroup[];
  allNotes: Note[];
  openFolders: Record<string, boolean>;
  openNoteTabs: string[];
  selectedFolderId: string | null;
  selectedNoteId: string | null;
}

export interface WorkspaceServerData {
  spaces: KnowledgeSpace[];
  currentSpaceId: string | null;
  folderTree: Folder[];
  foldersById: Record<string, Folder>;
  notes: Note[];
  tags: Tag[];
  tagGroups: TagGroup[];
}

export interface AnnotationMapping {
  formatVersion: 1;
  operationId: string;
  baseContentHash: string;
  targetContentHash: string;
  baseStructureRevision?: number;
  edits: Array<{
    from: number;
    to: number;
    text: string;
    history?: boolean;
    moveId?: string;
    moveKind?: 'cut' | 'paste';
    preserveEmptyBlock?: boolean;
    deletedEmptyAnnotationIds?: string[];
  }>;
  /** 稳定身份迁移影子阶段：编辑器身份视角快照，服务端只用于比对诊断。 */
  editorState?: AnnotationIdentityEditorState;
}
export interface AnnotationIdentityEditorState {
  formatVersion: 2;
  targetContentHash: string;
  blocks: Array<{ id: string; type: string; empty: boolean }>;
  annotations: Array<{
    id: string;
    scopeType: 'selection' | 'blocks' | 'section' | 'list';
    present: boolean;
    rootBlockId?: string;
    startBlockId?: string;
    endBlockId?: string;
    quoteHash?: string;
    /** 选区起止的块内位置（S2b-2）；表格内附带单元格 [行, 列]。 */
    start?: { blockId: string; offset: number; cell?: [number, number] };
    end?: { blockId: string; offset: number; cell?: [number, number] };
  }>;
}
export interface ConfirmAnnotationRangeInput {
  expectedRevision: number;
  noteContentHash: string;
  candidateHash: string;
}
