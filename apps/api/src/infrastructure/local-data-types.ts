import type { Prisma } from '@prisma/client';
import type { ContentAnchor } from '@study-accelerator/content-anchor';
import type { PdfAnnotation } from '@study-accelerator/shared/pdf';
import type { Todo } from '../../../../packages/web-core/src/personal-todos/types.ts';
import type { KnowledgeSpaceRecord } from '../modules/knowledge/infrastructure/knowledge-space-repository.ts';
import type { FolderRecord } from '../modules/knowledge/infrastructure/folder-repository.ts';
import type { TagRecord } from '../modules/knowledge/infrastructure/tag-repository.ts';
import type { TagGroupRecord } from '../modules/knowledge/infrastructure/tag-group-repository.ts';
import type { NoteRecord } from '../modules/knowledge/infrastructure/note-repository.ts';
import type { KnowledgeItemRecord } from '../modules/knowledge/infrastructure/knowledge-item-repository.ts';
import type { KnowledgeEvidenceRecord } from '../modules/knowledge/infrastructure/knowledge-evidence-repository.ts';
import type { KnowledgeArtifactProvenance } from '../modules/knowledge/domain/knowledge-artifact-provenance-contract.ts';
import type {
  AnalysisScopeAliasSnapshot,
  AnalysisScopeVersionBinding
} from '../modules/knowledge/domain/analysis-scope-version-alias.ts';
import type { QuestionStructureInput } from '../modules/knowledge/application/question-validation.ts';

/** 文件边界保留历史原值；这些视图只收窄已有字段校验及关系检查实际使用的结构。 */
export type LocalNote = NoteRecord;
export type LocalFolder = Pick<FolderRecord, 'id' | 'spaceId' | 'name' | 'parentId' | 'deletedAt'>;
export interface LocalNoteVersion {
  id: string;
  noteId: string;
  content: string;
  contentHash: string;
  createdBy: string;
  createdAt?: unknown;
}
export interface LocalAnnotation {
  id: string;
  spaceId: string;
  noteId: string;
  noteVersionId?: string | null;
  quoteText: string;
  schemaVersion?: number;
  scopeType?: string;
  lifecycleStatus?: string;
  anchorStatus?: string;
  status?: unknown;
  noteContentHash?: unknown;
  anchor?: ContentAnchor;
}
export interface LocalLearningObjective {
  id: string;
  knowledgeItemId: string;
  objective: string;
  actionVerb: string;
  cognitiveLevel: string;
  reviewStatus?: string;
  deletedAt?: unknown;
}
export interface LocalExamProfile {
  id: string;
  archivedAt?: unknown;
}
export interface LocalExamFocus {
  id: string;
  examProfileId: string;
  learningObjectiveId: string;
}
export interface LocalQuestion extends QuestionStructureInput {
  id: string;
  reviewStatus?: string;
  deletedAt?: unknown;
}
export interface LocalQuestionObjective {
  id: string;
  questionId: string;
  learningObjectiveId: string;
}
export interface LocalQuestionSource {
  id: string;
  questionId: string;
  sourceType?: string;
  sourceId?: string | null;
  status?: string;
  quote?: unknown;
  locator?: unknown;
  contentHash?: unknown;
}
export interface LocalAttachment {
  id: string;
  noteId: string;
  fileName: string;
  status?: string;
  sha256?: string;
}
export interface LocalExclusion {
  id: string;
  parentAnnotationId: string;
  noteVersionId?: string | null;
}
export interface LocalAnnotationRevision {
  id: string;
  annotationId: string;
  operation: string;
  revision: number;
}
export interface LocalAnalysisScope extends AnalysisScopeAliasSnapshot {
  id: string;
  spaceId: string;
  inputHash: string;
  idempotencyKey: string;
  noteVersions: AnalysisScopeVersionBinding[];
}
interface LocalDataCollections {
  spaces: KnowledgeSpaceRecord[];
  folders: LocalFolder[];
  tags: TagRecord[];
  tagGroups: TagGroupRecord[];
  notes: LocalNote[];
  noteVersions: LocalNoteVersion[];
  knowledgeItems: KnowledgeItemRecord[];
  knowledgeEvidence: KnowledgeEvidenceRecord[];
  knowledgeArtifactProvenance: KnowledgeArtifactProvenance[];
  learningObjectives: LocalLearningObjective[];
  examProfiles: LocalExamProfile[];
  examFocuses: LocalExamFocus[];
  questions: LocalQuestion[];
  questionObjectives: LocalQuestionObjective[];
  questionSources: LocalQuestionSource[];
  attachments: LocalAttachment[];
  contentAnnotations: LocalAnnotation[];
  pdfAnnotations: PdfAnnotation[];
  annotationExclusions: LocalExclusion[];
  annotationRevisions: LocalAnnotationRevision[];
  analysisScopeSnapshots: LocalAnalysisScope[];
  personalTodos: Todo[];
}
/** 持久 JSON 保留扩展字段的原值，不把它们冒充领域构造器输出。 */
export type StoredJsonField<Value> = unknown extends Value
  ? keyof Value extends never
    ? Prisma.JsonValue | undefined
    : { [Key in keyof Value]: StoredJsonField<Value[Key]> }
  : Value extends object
    ? { [Key in keyof Value]: StoredJsonField<Value[Key]> }
    : Value;
export type LocalDataState = { [Key in keyof LocalDataCollections]: StoredJsonField<LocalDataCollections[Key]> };
export type LocalCollection = keyof LocalDataState;
export type LocalRows<Key extends LocalCollection> = LocalDataState[Key];
export type LocalRow<Key extends LocalCollection> = LocalRows<Key> extends readonly (infer Row)[] ? Row : never;
