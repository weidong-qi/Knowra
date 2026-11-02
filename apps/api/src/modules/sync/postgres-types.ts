import type * as Models from '@prisma/client';
import type { Prisma, PrismaClient } from '@prisma/client';
import type { SyncCollection, SyncStoredEntity, SyncStoredState } from './domain-types.ts';
import type { SyncJournal } from './journal.ts';
import type { SyncMappedEntityMap } from './postgres-state-types.ts';
import type { SyncContract, SyncSnapshotBinding } from './protocol-contract.ts';

export interface SyncModelNames {
  spaces: 'knowledgeSpace';
  folders: 'folder';
  tags: 'tag';
  tagGroups: 'tagGroup';
  notes: 'note';
  noteVersions: 'noteVersion';
  attachments: 'attachment';
  contentAnnotations: 'contentAnnotation';
  annotationExclusions: 'annotationExclusion';
  annotationRevisions: 'annotationRevision';
  analysisScopeSnapshots: 'analysisScopeSnapshot';
  knowledgeItems: 'knowledgeItem';
  knowledgeEvidence: 'knowledgeEvidence';
  knowledgeArtifactProvenance: 'knowledgeArtifactProvenance';
  learningObjectives: 'learningObjective';
  examProfiles: 'examProfile';
  examFocuses: 'examFocus';
  questions: 'question';
  questionObjectives: 'questionObjective';
  questionSources: 'questionSource';
}
interface ReadRows {
  spaces: Models.KnowledgeSpace;
  folders: Models.Folder;
  tags: Models.Tag;
  tagGroups: Models.TagGroup;
  notes: Models.Note & { noteTags: { tagId: string }[] };
  noteVersions: Models.NoteVersion;
  attachments: Models.Attachment;
  contentAnnotations: Models.ContentAnnotation;
  annotationExclusions: Models.AnnotationExclusion;
  annotationRevisions: Models.AnnotationRevision;
  analysisScopeSnapshots: Models.AnalysisScopeSnapshot;
  knowledgeItems: Models.KnowledgeItem;
  knowledgeEvidence: Models.KnowledgeEvidence;
  knowledgeArtifactProvenance: Models.KnowledgeArtifactProvenance;
  learningObjectives: Models.LearningObjective;
  examProfiles: Models.ExamProfile;
  examFocuses: Models.ExamFocus;
  questions: Models.Question;
  questionObjectives: Models.QuestionObjective;
  questionSources: Models.QuestionSource;
}
type JsonFields =
  | 'deletionPackage'
  | 'annotationStructure'
  | 'internalLinks'
  | 'headingPath'
  | 'anchor'
  | 'originSnapshot'
  | 'identityBinding'
  | 'oldAnchor'
  | 'newAnchor'
  | 'rangeSummary'
  | 'payload'
  | 'noteVersions'
  | 'annotationRevisions'
  | 'segments'
  | 'contextSegments'
  | 'scope'
  | 'commonQuestionTypes'
  | 'difficultyProfile'
  | 'questionTypeSuggestions'
  | 'options'
  | 'referenceAnswer'
  | 'rubric'
  | 'locator';
type SyncWriteData<Collection extends SyncCollection> = Omit<Partial<ReadRows[Collection]>, JsonFields | 'noteTags'> & {
  [Field in Extract<keyof ReadRows[Collection], JsonFields>]?: Prisma.JsonValue | Prisma.NullTypes.DbNull;
} & { id: string };
type MapperSuffix = {
  spaces: 'Space';
  folders: 'Folder';
  tags: 'Tag';
  tagGroups: 'TagGroup';
  notes: 'Note';
  noteVersions: 'NoteVersion';
  attachments: 'Attachment';
  contentAnnotations: 'Annotation';
  annotationExclusions: 'AnnotationExclusion';
  annotationRevisions: 'AnnotationRevision';
  analysisScopeSnapshots: 'AnalysisScopeSnapshot';
  knowledgeItems: 'KnowledgeItem';
  knowledgeEvidence: 'KnowledgeEvidence';
  knowledgeArtifactProvenance: 'KnowledgeArtifactProvenance';
  learningObjectives: 'LearningObjective';
  examProfiles: 'ExamProfile';
  examFocuses: 'ExamFocus';
  questions: 'Question';
  questionObjectives: 'QuestionObjective';
  questionSources: 'QuestionSource';
};
export type SyncTable = {
  [Collection in SyncCollection]: readonly [Collection, SyncModelNames[Collection], `db${MapperSuffix[Collection]}`];
}[SyncCollection];
export type SyncReadMapper<Collection extends SyncCollection> = Collection extends
  'annotationExclusions' | 'annotationRevisions' | 'analysisScopeSnapshots'
  ? never
  : `map${MapperSuffix[Collection]}`;
export type SyncWriteMapper<Collection extends SyncCollection> = (
  value: SyncStoredEntity<Collection>
) => SyncWriteData<Collection>;
export type SyncRowMapper<Collection extends SyncCollection> = (
  row: ReadRows[Collection]
) => SyncMappedEntityMap[Collection];
export type SyncUpsertInput<Collection extends SyncCollection> = {
  where: { id: string };
  create: SyncWriteData<Collection>;
  update: SyncWriteData<Collection>;
};
export type SyncUpsertCall<Collection extends SyncCollection> = (input: SyncUpsertInput<Collection>) => Promise<object>;
export type SyncDeleteCall = (input: { where: { id: { in: string[] } } }) => Promise<{ count: number }>;
export type SyncRawRow<Collection extends SyncCollection> = ReadRows[Collection];
export type SyncReadOptions<Collection extends SyncCollection = SyncCollection> = {
  where?: { id: { in: string[] } };
  orderBy: { id: 'asc' };
} & (Collection extends 'notes' ? { include: { noteTags: { orderBy: { tagId: 'asc' } } } } : { include?: never });
export type SyncTouched = Record<SyncCollection, Set<string>>;
export interface SyncTransactionContext {
  tx: Prisma.TransactionClient;
  before: SyncStoredState;
  journal: SyncJournal;
  version: number;
  after: { version: number; state: SyncStoredState } | null;
  touched?: SyncTouched;
  touchedVersion?: number;
}
/** 此处是 SQL/JSON 数据库结果边界，binding 仍交给协议校验器解释。 */
export interface SyncSnapshotSqlRow {
  epoch: string | null;
  binding: unknown;
  cursor: string | null;
  expires: string | null;
  count: number | null;
  entries: Prisma.JsonValue[] | null;
}
export interface SyncJournalEpoch {
  epoch?: unknown;
}
type SyncSqlBinding = Omit<SyncSnapshotBinding, 'datasetEpoch'> & { datasetEpoch: string | null };
export type SyncSqlBindingCheck = (
  input: unknown,
  contract: SyncContract,
  ownerId: string,
  epoch: string | null
) => SyncSqlBinding;
export type SyncSqlBindingProjection = (binding: SyncSqlBinding) => SyncSqlBinding;
export type SyncPostgresClient = PrismaClient;
export type SyncPostgresTransaction = Prisma.TransactionClient;

export type SyncReadCall<Collection extends SyncCollection> = (
  input: SyncReadOptions<Collection>
) => Promise<SyncRawRow<Collection>[]>;
export type SyncIdentityReadCall = (input: { select: { id: true } }) => Promise<{ id: string }[]>;
export type SyncDelegateName = SyncModelNames[SyncCollection] | 'noteTag' | 'user';
/** Prisma 代理方法回调边界：不解释动态参数或结果，保持接收者与调用原样。 */
export type SyncDelegateMethods = { [method: PropertyKey]: (...input: unknown[]) => unknown };
