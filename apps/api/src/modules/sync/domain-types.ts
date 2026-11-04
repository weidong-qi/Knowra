import type { ContentAnchor, AnnotationStructure } from '@study-accelerator/content-anchor';
import type { Prisma } from '@prisma/client';
import type { PdfAnnotation } from '@study-accelerator/shared/pdf';
import type { KnowledgeSpace } from '../knowledge/domain/knowledge-space.ts';
import type { Folder } from '../knowledge/domain/folder.ts';
import type { Tag } from '../knowledge/domain/tag.ts';
import type { TagGroup } from '../knowledge/domain/tag-group.ts';
import type { Note } from '../knowledge/domain/note.ts';
import type { NoteVersion } from '../knowledge/domain/note-version.ts';
import type { ContentAnnotation } from '../knowledge/domain/content-annotation.ts';
import type { KnowledgeItem } from '../knowledge/domain/knowledge-item.ts';
import type { KnowledgeEvidence } from '../knowledge/domain/knowledge-evidence.ts';
import type { KnowledgeArtifactProvenance } from '../knowledge/domain/knowledge-artifact-provenance-contract.ts';
import type { LearningObjective } from '../knowledge/domain/learning-objective.ts';
import type { ExamProfile } from '../knowledge/domain/exam-profile.ts';
import type { ExamFocus } from '../knowledge/domain/exam-focus.ts';
import type { Question } from '../knowledge/domain/question.ts';
import type { QuestionSource } from '../knowledge/domain/question-source.ts';
import type { AnalysisScopeSnapshot } from '../../http/storage-route-types.ts';
import type { AttachmentStatus } from '../../infrastructure/attachment-status.ts';
import type { SyncEntry, SyncJournal, SyncNoteContent, SyncReceiptResult, SyncSnapshot } from './journal.ts';
import type { SyncContract } from './protocol-contract.ts';
import type { SyncMappedEntityMap } from './postgres-state-types.ts';

export type SyncJsonValue =
  string | number | boolean | null | SyncJsonValue[] | { [field: string]: SyncJsonValue | undefined };
export interface SyncAttachment {
  id: string;
  noteId: string;
  fileName: string;
  mimeType: string;
  size: number;
  sha256: string;
  storagePath: string;
  status: AttachmentStatus;
  verifiedAt: string | null;
  createdAt: string;
  updatedAt?: string;
}
export interface SyncAnnotationExclusion {
  id: string;
  parentAnnotationId: string;
  noteVersionId: string | null;
  anchor: ContentAnchor;
  status: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
}
export interface SyncAnnotationRevision {
  id: string;
  annotationId: string;
  revision: number;
  operation: string;
  oldAnchor?: (ContentAnchor & { noteVersionId?: string }) | null;
  newAnchor?: (ContentAnchor & { noteVersionId?: string }) | null;
  rangeSummary: { scopeType: string; quoteText: string };
  reason?: string | null;
  createdAt: string;
}
export interface SyncQuestionObjective {
  id: string;
  questionId: string;
  learningObjectiveId: string;
  order: number;
  isPrimary: boolean;
  createdAt: string;
}
export interface SyncEntityMap {
  spaces: KnowledgeSpace;
  folders: Folder;
  tags: Tag;
  tagGroups: TagGroup;
  notes: Omit<Note, 'plainText' | 'internalLinks'> & Partial<Pick<Note, 'plainText' | 'internalLinks'>>;
  noteVersions: NoteVersion;
  attachments: SyncAttachment;
  pdfAnnotations: PdfAnnotation;
  contentAnnotations: ContentAnnotation;
  annotationExclusions: SyncAnnotationExclusion;
  annotationRevisions: SyncAnnotationRevision;
  analysisScopeSnapshots: AnalysisScopeSnapshot;
  knowledgeItems: KnowledgeItem;
  // DTO 和构造器都允许动态 map/filter；该外部动态边界没有后续 headingPath 结构校验。
  knowledgeEvidence: KnowledgeEvidence<string | undefined, string | undefined, unknown>;
  knowledgeArtifactProvenance: KnowledgeArtifactProvenance;
  learningObjectives: LearningObjective;
  examProfiles: ExamProfile;
  examFocuses: ExamFocus;
  questions: Question;
  questionObjectives: SyncQuestionObjective;
  questionSources: QuestionSource;
}
export type SyncCollection = keyof SyncEntityMap;
type EntityUnion = SyncEntityMap[SyncCollection];
type EntityKeys<Value> = Value extends Value ? keyof Value : never;
type EntityField<Value, Key extends PropertyKey> = Value extends Value
  ? Key extends keyof Value
    ? Value[Key]
    : never
  : never;
// JSON 记录可携带其他集合也认识的字段；这不会放宽各自领域的必选字段。
type EntityFields = { [Key in EntityKeys<EntityUnion>]?: EntityField<EntityUnion, Key> };
type Mutable<Value> = { -readonly [Key in keyof Value]: Value[Key] };
type ConcreteEntityMap = { [Collection in SyncCollection]: Mutable<SyncEntityMap[Collection]> & EntityFields };
export type SyncEntity<Collection extends SyncCollection = SyncCollection> = ConcreteEntityMap[Collection];
export type SyncDomainState = { [Collection in SyncCollection]: SyncEntity<Collection>[] };
type SyncDerivedNote = Omit<SyncEntity<'notes'>, 'annotationStructure'> & {
  annotationStructure: AnnotationStructure | Prisma.JsonValue;
};
type StoredEntityUnion = SyncEntity | SyncMappedEntityMap[SyncCollection] | SyncDerivedNote;
type StoredFields = { [Key in EntityKeys<StoredEntityUnion>]?: EntityField<StoredEntityUnion, Key> };
export type SyncStoredEntity<Collection extends SyncCollection = SyncCollection> =
  | SyncEntity<Collection>
  | ((SyncMappedEntityMap[Collection] | (Collection extends 'notes' ? SyncDerivedNote : never)) & StoredFields);
export type SyncStoredState = { [Collection in SyncCollection]: SyncStoredEntity<Collection>[] };
export type SyncBackend = 'local' | 'postgres';
export type SyncProviderState<Backend extends SyncBackend> = Backend extends 'local'
  ? SyncDomainState
  : SyncStoredState;
// DTO 的 ID 列表与从 PG 继承的结构 JSON 尚未保证完整领域结构。
type WorkingEntityMap = Omit<SyncEntityMap, 'notes'> & {
  notes: Omit<SyncEntityMap['notes'], 'tagIds' | 'annotationStructure'> & {
    tagIds: unknown[];
    annotationStructure: AnnotationStructure | Prisma.JsonValue;
  };
};
type ConcreteWorkingMap = {
  [Collection in SyncCollection]: Collection extends 'notes'
    ? Mutable<WorkingEntityMap['notes']> & Omit<EntityFields, 'tagIds' | 'annotationStructure'>
    : SyncEntity<Collection>;
};
export type SyncWorkingEntity<Collection extends SyncCollection = SyncCollection> = ConcreteWorkingMap[Collection];
export type SyncWorkingRecord<Collection extends SyncCollection = SyncCollection> =
  SyncWorkingEntity<Collection> | SyncStoredEntity<Collection>;
export type SyncWorkingState = { [Collection in SyncCollection]: SyncWorkingRecord<Collection>[] };
export type SyncWorkingConstructors = Partial<{
  [Collection in SyncCollection]: new (input: SyncWorkingEntity<Collection>) => WorkingEntityMap[Collection];
}>;
export type SyncWorkingBuilders = Partial<{
  [Collection in SyncCollection]: (input: SyncWorkingEntity<Collection>) => Partial<SyncWorkingEntity<Collection>>;
}>;
export type SyncWorkingMutation<Collection extends SyncCollection = SyncCollection> = Omit<
  SyncMutation<Collection>,
  'value'
> & { value: SyncWorkingEntity<Collection> | null };
export type SyncAnnotationNoteFactory = (input: {
  records: SyncWorkingRecord<'notes'>[];
}) => NonNullable<
  import('../knowledge/application/service-dependencies.ts').ContentAnnotationDependencies['noteRepository']
>;
export type SyncBatchValidator = (input: SyncWorkingState & { schemaVersion: number }) => SyncStoredState;
export type SyncRawNoteReferences = (
  collection: 'notes',
  note: SyncWorkingRecord<'notes'>
) => { collection: string; id: unknown }[];
export type SyncRawChangeReferences = (
  change: SyncChange,
  before: SyncStoredState,
  after: SyncStoredState
) => { collection: SyncCollection; id: unknown }[];
/** 仅供原始数据库 JSON 的属性读取，不表示其通过结构校验。 */
export type SyncRawObject = Record<string, SyncJsonValue | undefined>;
export type SyncRawStructureUpdate = (
  before: string,
  after: string,
  previous: SyncWorkingRecord<'notes'>['annotationStructure'] | undefined
) => Prisma.JsonObject;
export type SyncRawAnchorResolution = (
  markdown: string,
  anchor: SyncWorkingRecord<'contentAnnotations' | 'annotationExclusions'>['anchor']
) => Pick<ReturnType<typeof import('@study-accelerator/content-anchor').resolveAnchor>, 'status' | 'quoteText'>;
interface SyncAnnotationReconcileDependencies {
  repository: ReturnType<
    typeof import('../knowledge/infrastructure/content-annotation-repository.ts').createInMemoryContentAnnotationRepository
  >;
  noteRepository: ReturnType<SyncAnnotationNoteFactory>;
  noteVersionRepository: ReturnType<
    typeof import('../knowledge/infrastructure/note-version-repository.ts').createInMemoryNoteVersionRepository
  >;
  revisionRepository: import('../knowledge/infrastructure/annotation-support-repositories.ts').AnnotationRevisionRepository<
    SyncWorkingRecord<'annotationRevisions'>
  >;
}
export type SyncAnnotationReconcileFactory = (dependencies: SyncAnnotationReconcileDependencies) => {
  reconcileForNote(noteId: string, contentHash: string): void;
};
export interface SyncMutation<Collection extends SyncCollection = SyncCollection> {
  collection: Collection;
  id: string;
  baseRevision: number | null;
  value: SyncEntity<Collection> | null;
  lifecycleAction?: 'trash' | 'restore' | 'withdraw' | 'readopt' | null;
}
export type SyncChange<Collection extends SyncCollection = SyncCollection> = {
  [Name in Collection]: {
    collection: Name;
    id: string;
    baseRevision: number | null;
    value: SyncEntity<Name> | null;
    lifecycleAction?: 'trash' | 'restore' | 'withdraw' | 'readopt' | null;
  };
}[Collection];
export interface SyncDependency {
  collection: SyncCollection;
  id: string;
  baseRevision: number | null;
  value?: never;
}
export interface SyncBatchOperation extends SyncContract {
  protocolVersion: 2;
  deviceId: string;
  operationId: string;
  datasetEpoch: string;
  sequence: number;
  changes: SyncChange[];
  dependencies: SyncDependency[];
}
export interface PreparedSyncAttachment {
  id: unknown;
  fileName: unknown;
  sha256: unknown;
  size: unknown;
  storagePath: string;
}
export interface SyncTransferRecord {
  id?: unknown;
  fileName?: unknown;
  sha256?: unknown;
  size?: unknown;
  mimeType?: unknown;
}
export interface SyncBlobStreamInput {
  deviceId?: unknown;
  attachment: SyncTransferRecord;
  stream: AsyncIterable<Uint8Array | string>;
}
export interface SyncBlobInput {
  deviceId?: unknown;
  attachment?: SyncTransferRecord | null;
  contentBase64?: unknown;
}
export interface SyncAttachmentTransfer {
  verify(record: SyncTransferRecord | null | undefined): PreparedSyncAttachment;
  put(input: SyncBlobInput): PreparedSyncAttachment;
  putStream?(input: SyncBlobStreamInput): Promise<PreparedSyncAttachment>;
}
export type SyncAwaitable<Value> = Value | PromiseLike<Value>;
export interface SyncPreview<Backend extends SyncBackend = 'local'> {
  state: SyncProviderState<Backend>;
  journal: SyncJournal;
}
export interface SyncBatchProvider<Backend extends SyncBackend = 'local'> {
  read<Result>(
    callback: (state: SyncProviderState<Backend> | null, journal: SyncJournal) => Result
  ): SyncAwaitable<Result>;
  mutate<Result>(callback: (state: SyncProviderState<Backend>, journal: SyncJournal) => Result): SyncAwaitable<Result>;
  mutateBatch?: SyncBatchProvider<Backend>['mutate'];
  mutateJournal?: SyncBatchProvider<Backend>['mutate'];
  historyReferences?: () => SyncAwaitable<unknown[] | null>;
  applyState(state: SyncProviderState<Backend>): SyncAwaitable<void>;
  preview(): SyncAwaitable<SyncPreview<Backend>>;
}
export interface SyncNoteOperation {
  noteId: string;
  value: SyncIncomingNoteContent & { title: string; rawMarkdown: string; deleted: boolean; tagIds: unknown[] };
}
/** HTTP 只校验这些笔记字段的结构；其他字段继续交给原服务/DTO 处理。 */
export type SyncIncomingNoteContent = { [Field in keyof SyncNoteContent]?: unknown };
export interface SyncNoteMutationResult {
  id: string;
  title: string;
  rawMarkdown: string;
}
export interface SyncNoteService {
  createNote(
    input: Omit<SyncNoteOperation['value'], 'deleted'> & { id: string }
  ): SyncAwaitable<SyncNoteMutationResult>;
  updateNote(id: string, input: Omit<SyncNoteOperation['value'], 'deleted'>): SyncAwaitable<SyncNoteMutationResult>;
  deleteNote(id: string): SyncAwaitable<SyncNoteMutationResult>;
  restoreNote(id: string): SyncAwaitable<SyncNoteMutationResult>;
}
export interface LocalSyncDataStore {
  state: SyncDomainState;
  getSyncJournal?: () => SyncJournal;
  previewSyncJournal(): SyncJournal;
  runSyncTransaction<Result>(operation: () => Result): Result;
  runSyncJournalTransaction?: LocalSyncDataStore['runSyncTransaction'];
  runSyncBatchTransaction?: LocalSyncDataStore['runSyncTransaction'];
  getHistoryRetentionReferences?: () => unknown[] | null;
}
export interface LocalSyncProvider extends SyncBatchProvider<'local'> {
  snapshotEntries(
    state: SyncDomainState,
    journal: SyncJournal
  ): { entriesEncoding: string; entryPageSize: number; entryPages: string[]; count: number };
  readSnapshotEntries(snapshot: SyncSnapshot, start: number, end: number): SyncEntry[];
  applyNote(
    operation: SyncNoteOperation,
    current: Pick<Note, 'deleted'> | null
  ): SyncAwaitable<SyncNoteMutationResult | void>;
}
export type SyncBatchResult = SyncReceiptResult;
