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
  ExamFocusRepository,
  QuestionObjectiveRepository,
  QuestionSourceRepository
} from '../infrastructure/assessment-repository.ts';
import type { KnowledgeItemRepository } from '../infrastructure/knowledge-item-repository.ts';
import type { KnowledgeEvidenceRepository } from '../infrastructure/knowledge-evidence-repository.ts';
import type { ContentAnnotationRepository } from '../infrastructure/content-annotation-repository.ts';
import type { NoteRepository } from '../infrastructure/note-repository.ts';
import type { NoteVersionRepository } from '../infrastructure/note-version-repository.ts';
import type { ContentAnchor } from '@study-accelerator/content-anchor';
import type { CreateLearningObjectiveDto } from './dto/learning-objective.dto.ts';
import type { LearningObjective } from '../domain/learning-objective.ts';
import type { ExamProfile } from '../domain/exam-profile.ts';
import type { ExamFocus } from '../domain/exam-focus.ts';
import type { Question } from '../domain/question.ts';

interface TransactionDependencies {
  getTombstone?: ((collection: string, id: string) => { previousUpdatedAt?: unknown } | null) | null;
  runTransaction?: <T>(operation: () => T) => T;
}
export interface AssessmentWritePort<Record, Result = Record> {
  create?: (record: Record) => Result;
  save: (record: Record) => Result;
}
export interface AssessmentContextDependencies extends TransactionDependencies {
  examProfileRepository?: Pick<
    AssessmentCollectionRepository<ExamProfile<unknown, unknown>>,
    'findById' | 'list' | 'save'
  > &
    Partial<Pick<AssessmentCollectionRepository<ExamProfile<unknown, unknown>>, 'create'>>;
  examFocusRepository?: Pick<ExamFocusRepository<ExamFocus<unknown, unknown, unknown>>, 'findById' | 'list' | 'save'> &
    Partial<Pick<ExamFocusRepository<ExamFocus<unknown, unknown, unknown>>, 'create'>>;
  learningObjectiveRepository?: Pick<AssessmentCollectionRepository<LearningObjective>, 'findById'>;
}
export type LearningObjectiveServiceRecord = LearningObjective<
  CreateLearningObjectiveDto['actionVerb'],
  CreateLearningObjectiveDto['cognitiveLevel'],
  CreateLearningObjectiveDto['difficultyHint'],
  CreateLearningObjectiveDto['createdAt'],
  CreateLearningObjectiveDto['updatedAt']
>;
export interface LearningObjectiveDependencies extends TransactionDependencies {
  repository?: Pick<AssessmentCollectionRepository<LearningObjectiveServiceRecord>, 'findById' | 'list' | 'save'> &
    Partial<Pick<AssessmentCollectionRepository<LearningObjectiveServiceRecord>, 'create'>>;
  knowledgeItemRepository?: Pick<KnowledgeItemRepository, 'findById'>;
  onObjectiveInvalidated?: ((id: string) => void) | null;
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
  repository: Pick<KnowledgeItemRepository<KnowledgeItemServiceRecord>, 'findById' | 'list' | 'save'> &
    Partial<Pick<KnowledgeItemRepository<KnowledgeItemServiceRecord>, 'create'>>;
  evidenceRepository: Omit<KnowledgeEvidenceRepository<KnowledgeEvidenceServiceRecord>, 'deleteByKnowledgeItemId'>;
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
  repository: Pick<AssessmentCollectionRepository<QuestionServiceRecord>, 'findById' | 'save' | 'list'> &
    Partial<Pick<AssessmentCollectionRepository<QuestionServiceRecord>, 'create'>>;
  questionObjectiveRepository: Pick<
    QuestionObjectiveRepository,
    'listByQuestionIds' | 'listByObjectiveId' | 'replaceForQuestion'
  >;
  questionSourceRepository: Pick<
    QuestionSourceRepository,
    'findById' | 'listByQuestionIds' | 'replaceForQuestion' | 'markBySourceIds'
  >;
  learningObjectiveRepository: Pick<AssessmentCollectionRepository<LearningObjective>, 'findById'>;
  examFocusRepository?: Pick<ExamFocusRepository<ExamFocus<unknown, unknown, unknown>>, 'findById'>;
  knowledgeItemRepository?: Pick<KnowledgeItemRepository, 'findById'>;
  noteRepository?: Pick<NoteRepository, 'findById'>;
  noteVersionRepository?: Pick<NoteVersionRepository, 'findById'>;
  knowledgeEvidenceRepository?: Pick<KnowledgeEvidenceRepository, 'findById'>;
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
