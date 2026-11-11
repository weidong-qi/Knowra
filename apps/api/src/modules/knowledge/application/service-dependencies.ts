import type { CreateQuestionDto } from './dto/assessment.dto.ts';
import type {
  CreateKnowledgeItemDto,
  UpdateKnowledgeItemDto,
  CreateKnowledgeEvidenceDto
} from './dto/knowledge-item.dto.ts';
import type { KnowledgeItem } from '../domain/knowledge-item.ts';
import type { KnowledgeEvidence } from '../domain/knowledge-evidence.ts';
import type {
  AssessmentCollectionRepository,
  LearningObjectiveRecord,
  ExamProfileRecord,
  ExamFocusRecord,
  QuestionRecord,
  ExamFocusRepository,
  QuestionObjectiveRepository,
  QuestionSourceRepository
} from '../infrastructure/assessment-repository.ts';
import type { KnowledgeItemRepository, KnowledgeItemRecord } from '../infrastructure/knowledge-item-repository.ts';
import type {
  KnowledgeEvidenceRepository,
  KnowledgeEvidenceRecord
} from '../infrastructure/knowledge-evidence-repository.ts';
import type { ContentAnnotationRepository } from '../infrastructure/content-annotation-repository.ts';
import type { NoteRepository } from '../infrastructure/note-repository.ts';
import type { NoteVersionRepository } from '../infrastructure/note-version-repository.ts';
import type { ContentAnchor } from '@study-accelerator/content-anchor';
import type { CreateLearningObjectiveDto } from './dto/learning-objective.dto.ts';
import type { LearningObjective } from '../domain/learning-objective.ts';
import type { Question } from '../domain/question.ts';

interface TransactionDependencies {
  getTombstone?: ((collection: string, id: string) => { previousUpdatedAt?: unknown } | null | undefined) | null;
  runTransaction?: <T>(operation: () => T) => T;
}
export interface AssessmentWritePort<Record, Result = Record> {
  create?: (record: Record) => Result;
  save: (record: Record) => Result;
}
export interface AssessmentContextDependencies extends TransactionDependencies {
  examProfileRepository?: Pick<AssessmentCollectionRepository<ExamProfileRecord>, 'findById' | 'list' | 'save'> &
    Partial<Pick<AssessmentCollectionRepository<ExamProfileRecord>, 'create'>>;
  examFocusRepository?: Pick<ExamFocusRepository<ExamFocusRecord>, 'findById' | 'list' | 'save'> &
    Partial<Pick<ExamFocusRepository<ExamFocusRecord>, 'create'>>;
  learningObjectiveRepository?: Pick<AssessmentCollectionRepository<LearningObjectiveRecord>, 'findById'>;
}
export type LearningObjectiveServiceRecord = LearningObjective<
  CreateLearningObjectiveDto['actionVerb'],
  CreateLearningObjectiveDto['cognitiveLevel'],
  CreateLearningObjectiveDto['difficultyHint'],
  CreateLearningObjectiveDto['createdAt'],
  CreateLearningObjectiveDto['updatedAt']
>;
export interface LearningObjectiveDependencies extends TransactionDependencies {
  repository?: Pick<AssessmentCollectionRepository<LearningObjectiveRecord>, 'findById' | 'list' | 'save'> &
    Partial<Pick<AssessmentCollectionRepository<LearningObjectiveRecord>, 'create'>>;
  knowledgeItemRepository?: { findById(id: unknown): KnowledgeItemRecord<unknown> | null };
  onObjectiveInvalidated?: ((id: unknown) => void) | null;
}
export type KnowledgeItemServiceRecord = KnowledgeItem<
  CreateKnowledgeItemDto['title'],
  CreateKnowledgeItemDto['canonicalStatement'],
  UpdateKnowledgeItemDto['userExplanation'],
  CreateKnowledgeItemDto['knowledgeType'],
  CreateKnowledgeItemDto['sourceMode'],
  CreateKnowledgeItemDto['createdAt'],
  CreateKnowledgeItemDto['updatedAt']
>;
export type KnowledgeEvidenceServiceRecord = KnowledgeEvidence<
  CreateKnowledgeEvidenceDto['sourceType'],
  CreateKnowledgeEvidenceDto['relationType'],
  CreateKnowledgeEvidenceDto['headingPath']
>;
export interface KnowledgeItemDependencies extends TransactionDependencies {
  repository: Pick<KnowledgeItemRepository<KnowledgeItemRecord<unknown>>, 'findById' | 'list' | 'save'> &
    Partial<Pick<KnowledgeItemRepository<KnowledgeItemRecord<unknown>>, 'create'>>;
  evidenceRepository: Omit<
    KnowledgeEvidenceRepository<KnowledgeEvidenceRecord<unknown, unknown>>,
    'deleteByKnowledgeItemId'
  >;
  noteVersionRepository?: Pick<NoteVersionRepository, 'findById'>;
  annotationRepository?: Pick<ContentAnnotationRepository, 'findById'>;
  noteRepository?: Pick<NoteRepository, 'findById'>;
  onItemInvalidated?: ((id: string) => void) | null;
}
export type QuestionServiceRecord = Question<
  CreateQuestionDto['questionType'],
  CreateQuestionDto['difficulty'],
  CreateQuestionDto['createdAt'],
  CreateQuestionDto['updatedAt']
>;
export interface QuestionDependencies extends TransactionDependencies {
  repository: Pick<AssessmentCollectionRepository<QuestionRecord>, 'findById' | 'save' | 'list'> &
    Partial<Pick<AssessmentCollectionRepository<QuestionRecord>, 'create'>>;
  questionObjectiveRepository: Pick<
    QuestionObjectiveRepository,
    'listByQuestionIds' | 'listByObjectiveId' | 'replaceForQuestion'
  >;
  questionSourceRepository: Pick<
    QuestionSourceRepository,
    'findById' | 'listByQuestionIds' | 'replaceForQuestion' | 'markBySourceIds'
  >;
  learningObjectiveRepository: Pick<AssessmentCollectionRepository<LearningObjectiveRecord>, 'findById'>;
  examFocusRepository?: Pick<ExamFocusRepository<ExamFocusRecord>, 'findById'>;
  knowledgeItemRepository?: { findById(id: unknown): KnowledgeItemRecord<unknown> | null };
  noteRepository?: Pick<NoteRepository, 'findById'>;
  noteVersionRepository?: Pick<NoteVersionRepository, 'findById'>;
  knowledgeEvidenceRepository?: Pick<
    KnowledgeEvidenceRepository<KnowledgeEvidenceRecord<unknown, unknown>>,
    'findById'
  >;
}
type VersionServiceMethods = 'findByNoteIdAndContentHash' | 'save' | 'findById' | 'list' | 'listIds' | 'listPage';
export interface NoteVersionDependencies {
  repository?: Pick<NoteVersionRepository, VersionServiceMethods>;
}
export interface AsyncNoteVersionDependencies {
  repository?: Pick<
    ReturnType<
      typeof import('../infrastructure/postgres/note-version-repository.ts').createPostgresNoteVersionRepository
    >,
    VersionServiceMethods
  >;
}
export interface ContentAnnotationNoteRepository {
  findById(
    id: string | null | undefined
  ): Pick<
    import('../infrastructure/note-repository.ts').NoteRecord,
    'id' | 'title' | 'rawMarkdown' | 'spaceId' | 'deleted' | 'contentHash' | 'annotationStructure'
  > | null;
}
export interface ContentAnnotationDependencies {
  repository?: ContentAnnotationRepository;
  noteRepository?: ContentAnnotationNoteRepository;
  noteVersionRepository?: NoteVersionRepository;
  revisionRepository?: import('../infrastructure/annotation-support-repositories.ts').AnnotationRevisionRepository<ServiceAnnotationRevision>;
  exclusionRepository?: import('../infrastructure/annotation-support-repositories.ts').AnnotationExclusionRepository<ServiceAnnotationExclusion>;
  onSourceChanged?: (
    annotation: import('../infrastructure/content-annotation-repository.ts').ContentAnnotationRecord
  ) => void;
}

interface ServiceAnnotationRevision {
  id: string;
  annotationId: string;
  revision: number;
  oldAnchor?: (ContentAnchor & { noteVersionId?: string }) | null;
  newAnchor?: (ContentAnchor & { noteVersionId?: string }) | null;
  operation: string;
  rangeSummary: { scopeType: string; quoteText: string };
  reason?: string | null;
  createdAt: string;
}
interface ServiceAnnotationExclusion {
  id: string;
  parentAnnotationId: string;
  noteVersionId?: string;
  revision: number;
  anchor: ContentAnchor & { unresolved?: boolean };
}
