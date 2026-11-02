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
import type { LearningObjective } from '../domain/learning-objective.ts';
import type { ExamProfile } from '../domain/exam-profile.js';
import type { ExamFocus } from '../domain/exam-focus.js';
import type { Question } from '../domain/question.js';

interface TransactionDependencies {
  getTombstone?: (collection: string, id: string) => object | null;
  runTransaction?: <T>(operation: () => T) => T;
}
export interface AssessmentWritePort<Record, Result = Record> {
  create?: (record: Record) => Result;
  save: (record: Record) => Result;
}
export interface AssessmentContextDependencies extends TransactionDependencies {
  examProfileRepository?: AssessmentCollectionRepository<ExamProfile<unknown, unknown>>;
  examFocusRepository?: ExamFocusRepository<ExamFocus<unknown, unknown, unknown>>;
  learningObjectiveRepository?: AssessmentCollectionRepository<LearningObjective>;
}
export interface LearningObjectiveDependencies extends TransactionDependencies {
  repository?: AssessmentCollectionRepository<LearningObjective>;
  knowledgeItemRepository?: Pick<KnowledgeItemRepository, 'findById'>;
  onObjectiveInvalidated?: (id: string) => void;
}
export interface KnowledgeItemDependencies extends TransactionDependencies {
  repository?: KnowledgeItemRepository<KnowledgeItem>;
  evidenceRepository?: KnowledgeEvidenceRepository<KnowledgeEvidence>;
  noteVersionRepository?: NoteVersionRepository;
  annotationRepository?: ContentAnnotationRepository;
  noteRepository?: Pick<NoteRepository, 'findById'>;
  onItemInvalidated?: (id: string) => void;
}
export interface QuestionDependencies extends TransactionDependencies {
  repository?: AssessmentCollectionRepository<Question<unknown, unknown, unknown, unknown>>;
  questionObjectiveRepository?: QuestionObjectiveRepository;
  questionSourceRepository?: QuestionSourceRepository;
  learningObjectiveRepository?: AssessmentCollectionRepository<LearningObjective>;
  examFocusRepository?: ExamFocusRepository<ExamFocus<unknown, unknown, unknown>>;
  knowledgeItemRepository?: Pick<KnowledgeItemRepository, 'findById'>;
  noteRepository?: Pick<NoteRepository, 'findById'>;
  noteVersionRepository?: NoteVersionRepository;
  knowledgeEvidenceRepository?: KnowledgeEvidenceRepository;
}
export interface NoteVersionDependencies {
  repository?: NoteVersionRepository;
}
export interface AsyncNoteVersionDependencies {
  repository?: ReturnType<
    typeof import('../infrastructure/postgres/note-version-repository.ts').createPostgresNoteVersionRepository
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
