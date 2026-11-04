import type { NoteVersionRetentionPolicy, RetentionJsonValue } from './note-version-retention.ts';

/** 本地快照与已映射 SQL 行的最小历史视图，不承诺完整领域对象。 */
export interface HistoryNote {
  id: string;
  rawMarkdown: string;
  createdAt?: RetentionJsonValue;
  updatedAt?: RetentionJsonValue;
  historyContentHash?: RetentionJsonValue;
}
export interface HistoryAnnotation {
  id: string;
  noteId?: string | null;
  revision?: RetentionJsonValue;
  schemaVersion?: number | null;
  lifecycleStatus?: string | null;
  deletedAt?: RetentionJsonValue;
  updatedAt?: RetentionJsonValue;
  noteVersionId?: string | null;
  quoteText?: string;
  /** JSON 列尚未做完整锚点/快照校验。 */
  originSnapshot?: unknown;
}
export interface HistoryRevision {
  id: string;
  annotationId: string;
  revision: number;
  operation?: string;
  createdAt?: RetentionJsonValue;
  newAnchor?: unknown;
  rangeSummary?: unknown;
}
export interface HistoryVersion {
  id: string;
  noteId: string;
  createdAt?: RetentionJsonValue;
  contentHash?: string;
}
export interface HistoryExclusion {
  id: string;
  parentAnnotationId: string;
}
export interface HistoryEvidence {
  sourceType?: string | null;
  annotationId?: string | null;
  noteVersionId?: string | null;
  quoteText?: unknown;
}
export interface HistoryRetentionState {
  notes?: HistoryNote[];
  noteVersions?: HistoryVersion[];
  contentAnnotations?: HistoryAnnotation[];
  annotationRevisions?: HistoryRevision[];
  annotationExclusions?: HistoryExclusion[];
  knowledgeEvidence?: HistoryEvidence[];
  knowledgeArtifactProvenance?: object[];
  questionSources?: object[];
  analysisScopeSnapshots?: object[];
}
export interface HistoryWritableState extends HistoryRetentionState {
  noteVersions: HistoryVersion[];
  annotationRevisions: HistoryRevision[];
}
export interface HistoryChangedState {
  notes?: (Pick<HistoryNote, 'id' | 'updatedAt' | 'historyContentHash'> & Partial<Pick<HistoryNote, 'rawMarkdown'>>)[];
  contentAnnotations?: Pick<HistoryAnnotation, 'id' | 'noteId' | 'revision'>[];
}
export type HistoryCollection = 'noteVersions' | 'annotationRevisions' | 'contentAnnotations' | 'annotationExclusions';
export interface AnnotationRevisionRetentionPolicy {
  maxPerAnnotation: number;
  maxAgeMs: number;
  sampleMs: number;
  maxBytesPerAnnotation: number;
}
export interface HistoryRetentionOptions {
  now?: number;
  noteIds?: ReadonlySet<string | null | undefined> | null;
  /** 来自私有记录、备份和 SQL JSON 的未验证引用载荷。 */
  externalReferences?: readonly unknown[];
  protectedVersionIds?: ReadonlySet<string>;
  protectedRevisionIds?: ReadonlySet<string>;
  canDiscard?: (collection: HistoryCollection, record: { id: string }) => boolean;
  notePolicy?: Readonly<NoteVersionRetentionPolicy>;
  annotationPolicy?: Readonly<AnnotationRevisionRetentionPolicy>;
  deletedAnnotationRetentionMs?: number;
}
export interface HistoryRetentionPlan {
  removedRevisions: Set<string>;
  removedVersions: Set<string>;
  removedAnnotations: Set<string>;
  removedExclusions: Set<string>;
  summary: Record<HistoryCollection, { before: number; after: number; removed: number; removedBytes: number }>;
}
