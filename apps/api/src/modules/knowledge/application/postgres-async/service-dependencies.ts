import type { Note } from '../../domain/note.ts';
import type { NoteVersion } from '../../domain/note-version.ts';
type SavedNote = Note | import('../../../sync/postgres-state-types.ts').SyncMappedEntityMap['notes'];
export interface PostgresRepositories {
  pdfAnnotationRepository: ReturnType<
    typeof import('../../../pdf/repository.ts').createPostgresPdfAnnotationRepository
  >;
  tagRepository: ReturnType<
    typeof import('../../infrastructure/postgres/tag-repository.ts').createPostgresTagRepository
  >;
  folderRepository: ReturnType<
    typeof import('../../infrastructure/postgres/folder-repository.ts').createPostgresFolderRepository
  >;
  knowledgeArtifactProvenanceRepository: ReturnType<
    typeof import('../../infrastructure/postgres/knowledge-artifact-provenance-repository.ts').createPostgresKnowledgeArtifactProvenanceRepository
  >;
  questionObjectiveRepository: ReturnType<
    typeof import('../../infrastructure/postgres/question-objective-repository.ts').createPostgresQuestionObjectiveRepository
  >;
  tagGroupRepository: ReturnType<
    typeof import('../../infrastructure/postgres/tag-group-repository.ts').createPostgresTagGroupRepository
  >;
  attachmentRepository: ReturnType<
    typeof import('../../infrastructure/postgres/attachment-repository.ts').createPostgresAttachmentRepository
  >;
  examFocusRepository: ReturnType<
    typeof import('../../infrastructure/postgres/exam-focus-repository.ts').createPostgresExamFocusRepository
  >;
  noteVersionRepository: ReturnType<
    typeof import('../../infrastructure/postgres/note-version-repository.ts').createPostgresNoteVersionRepository
  >;
  questionSourceRepository: ReturnType<
    typeof import('../../infrastructure/postgres/question-source-repository.ts').createPostgresQuestionSourceRepository
  >;
  contentAnnotationRepository: ReturnType<
    typeof import('../../infrastructure/postgres/content-annotation-repository.ts').createPostgresContentAnnotationRepository
  >;
  annotationExclusionRepository: ReturnType<
    typeof import('../../infrastructure/postgres/annotation-support-repositories.ts').createPostgresAnnotationExclusionRepository
  >;
  annotationRevisionRepository: ReturnType<
    typeof import('../../infrastructure/postgres/annotation-support-repositories.ts').createPostgresAnnotationRevisionRepository
  >;
  analysisScopeRepository: ReturnType<
    typeof import('../../infrastructure/postgres/annotation-support-repositories.ts').createPostgresAnalysisScopeRepository
  >;
  knowledgeEvidenceRepository: ReturnType<
    typeof import('../../infrastructure/postgres/knowledge-evidence-repository.ts').createPostgresKnowledgeEvidenceRepository
  >;
  examProfileRepository: ReturnType<
    typeof import('../../infrastructure/postgres/exam-profile-repository.ts').createPostgresExamProfileRepository
  >;
  knowledgeItemRepository: ReturnType<
    typeof import('../../infrastructure/postgres/knowledge-item-repository.ts').createPostgresKnowledgeItemRepository
  >;
  noteRepository: ReturnType<
    typeof import('../../infrastructure/postgres/note-repository.ts').createPostgresNoteRepository
  >;
  learningObjectiveRepository: ReturnType<
    typeof import('../../infrastructure/postgres/learning-objective-repository.ts').createPostgresLearningObjectiveRepository
  >;
  knowledgeSpaceRepository: ReturnType<
    typeof import('../../infrastructure/postgres/knowledge-space-repository.ts').createPostgresKnowledgeSpaceRepository
  >;
  questionRepository: ReturnType<
    typeof import('../../infrastructure/postgres/question-repository.ts').createPostgresQuestionRepository
  >;
}
// 无独立事务宿主时直接返回回调结果；有宿主时 Promise 采用回调的完成值。
// 关联 Result 与返回值，避免把本来始终异步的回调降为 T | Promise<T>。
export type KnowledgeModuleRepositories = Omit<PostgresRepositories, 'attachmentRepository'>;
export interface KnowledgeModuleTransaction {
  <Result>(operation: (repositories: KnowledgeModuleRepositories) => Result): Result | Promise<Awaited<Result>>;
}
type AwaitablePort<Port> = {
  [Key in keyof Port]: Port[Key] extends (...args: infer Args) => infer Result
    ? (...args: Args) => Result | Awaited<Result>
    : Port[Key];
};
type KnowledgeItemPort = AwaitablePort<Pick<PostgresRepositories['knowledgeItemRepository'], 'findById' | 'save'>> &
  Partial<AwaitablePort<Pick<PostgresRepositories['knowledgeItemRepository'], 'create'>>> & {
    list(options?: {
      reviewStatus?: import('../../domain/knowledge-item.ts').KnowledgeItem['reviewStatus'] | '';
      query?: string;
      includeArchived?: boolean | string;
      includeDeleted?: boolean | string;
    }):
      | ReturnType<PostgresRepositories['knowledgeItemRepository']['list']>
      | Awaited<ReturnType<PostgresRepositories['knowledgeItemRepository']['list']>>;
  };
type EvidencePort = AwaitablePort<Omit<PostgresRepositories['knowledgeEvidenceRepository'], 'supportsAsync'>>;
type AnnotationRecord = import('../../domain/content-annotation.ts').ContentAnnotation;
interface AnnotationReconciliation {
  annotations: AnnotationRecord[];
  contentChangedAnnotationIds: string[];
}
interface NoteTransactionContext extends Partial<PostgresRepositories> {
  itemRepository?: PostgresRepositories['knowledgeItemRepository'];
  evidenceRepository?: EvidencePort;
  annotationRepository?: PostgresRepositories['contentAnnotationRepository'] | null;
  noteVersionService?: ReturnType<typeof import('../note-version-service.ts').createAsyncNoteVersionService>;
  onNoteContentChanged?: (
    note: SavedNote,
    version: NoteVersion,
    change: ReturnType<typeof import('../annotation-change-context.ts').prepareAnnotationChange> | null
  ) => void | Promise<void | AnnotationReconciliation>;
  onNoteIdentityChanged?: (
    note: SavedNote,
    change: ReturnType<typeof import('../annotation-change-context.ts').prepareAnnotationChange> | null
  ) => void | AnnotationRecord[] | Promise<void | AnnotationRecord[]>;
  onNoteDeleted?: (
    id: string
  ) => void | Promise<void | Awaited<ReturnType<PostgresRepositories['knowledgeEvidenceRepository']['list']>>>;
  onBeforePermanentDelete?: (id: string) => void | Promise<void>;
}
interface TransactionDependencies {
  getTombstone?:
    | ((
        collection: string,
        id: string
      ) => { previousUpdatedAt?: string } | null | PromiseLike<{ previousUpdatedAt?: string } | null>)
    | null;
  runTransaction?: <T>(operation: (repositories?: NoteTransactionContext) => T | Promise<T>) => T | Promise<T>;
}
export interface KnowledgeItemDependencies extends TransactionDependencies {
  repository: KnowledgeItemPort;
  evidenceRepository: Omit<EvidencePort, 'deleteByKnowledgeItemId'>;
  noteRepository?: Pick<PostgresRepositories['noteRepository'], 'findById'>;
  noteVersionRepository?: Pick<PostgresRepositories['noteVersionRepository'], 'findById'>;
  annotationRepository?: Pick<PostgresRepositories['contentAnnotationRepository'], 'findById'> | null;
  onItemInvalidated?: ((id: string) => void | Promise<void>) | null;
}
export interface LearningObjectiveDependencies extends TransactionDependencies {
  repository?: Pick<PostgresRepositories['learningObjectiveRepository'], 'findById' | 'list' | 'save'> &
    Partial<Pick<PostgresRepositories['learningObjectiveRepository'], 'create' | 'lockById'>>;
  knowledgeItemRepository?: Pick<PostgresRepositories['knowledgeItemRepository'], 'findById'> &
    Partial<Pick<PostgresRepositories['knowledgeItemRepository'], 'lockById'>>;
  onObjectiveInvalidated?:
    | ((
        id: string
      ) =>
        | void
        | Promise<void>
        | ReturnType<
            ReturnType<typeof import('./question-service.ts').createAsyncQuestionService>['invalidateByObjectiveId']
          >)
    | null;
}
export interface AssessmentContextDependencies extends TransactionDependencies {
  examProfileRepository?: Pick<PostgresRepositories['examProfileRepository'], 'findById' | 'list' | 'save'> &
    Partial<Pick<PostgresRepositories['examProfileRepository'], 'create'>>;
  examFocusRepository?: Pick<
    PostgresRepositories['examFocusRepository'],
    'findById' | 'list' | 'save' | 'findByProfileAndObjective'
  > &
    Partial<Pick<PostgresRepositories['examFocusRepository'], 'create'>>;
  learningObjectiveRepository?: Pick<PostgresRepositories['learningObjectiveRepository'], 'findById'>;
}
export interface QuestionDependencies extends TransactionDependencies {
  repository: Pick<PostgresRepositories['questionRepository'], 'findById' | 'save' | 'list'> &
    Partial<Pick<PostgresRepositories['questionRepository'], 'create'>>;
  questionObjectiveRepository: Pick<
    PostgresRepositories['questionObjectiveRepository'],
    'listByQuestionIds' | 'listByObjectiveId' | 'replaceForQuestion'
  >;
  questionSourceRepository: Pick<
    PostgresRepositories['questionSourceRepository'],
    'findById' | 'listByQuestionIds' | 'replaceForQuestion' | 'markBySourceIds'
  >;
  learningObjectiveRepository: Pick<PostgresRepositories['learningObjectiveRepository'], 'findById'>;
  examFocusRepository?: Pick<PostgresRepositories['examFocusRepository'], 'findById'>;
  knowledgeItemRepository?: Pick<PostgresRepositories['knowledgeItemRepository'], 'findById'>;
  noteRepository?: Pick<PostgresRepositories['noteRepository'], 'findById'>;
  noteVersionRepository?: Pick<PostgresRepositories['noteVersionRepository'], 'findById'>;
  knowledgeEvidenceRepository?: Pick<PostgresRepositories['knowledgeEvidenceRepository'], 'findById'>;
}
export interface ContentAnnotationDependencies {
  repository?: PostgresRepositories['contentAnnotationRepository'];
  noteRepository?: PostgresRepositories['noteRepository'];
  noteVersionRepository?: PostgresRepositories['noteVersionRepository'];
  revisionRepository?: PostgresRepositories['annotationRevisionRepository'];
  exclusionRepository?: PostgresRepositories['annotationExclusionRepository'];
  onSourceChanged?: (
    annotation: import('../../../sync/postgres-state-types.ts').SyncMappedEntityMap['contentAnnotations']
  ) => void | Promise<void>;
}
export interface SpaceDependencies extends TransactionDependencies {
  repository?: PostgresRepositories['knowledgeSpaceRepository'];
  tagGroupRepository?: PostgresRepositories['tagGroupRepository'];
}
export interface SiblingNameInput {
  spaceId: string;
  parentId?: string | null;
  folderId?: string | null;
  title?: string;
  name?: string;
  currentFolderId?: string | null;
  currentNoteId?: string | null;
}
export interface FolderDependencies {
  repository?: PostgresRepositories['folderRepository'];
  validateSiblingNameConflict?: (input: SiblingNameInput) => void | Promise<void>;
  validateSpaceReference?: (id: string) => void | Promise<void>;
}
export interface TagDependencies {
  repository?: PostgresRepositories['tagRepository'];
  validateSpaceReference?: (id: string) => void | Promise<void>;
  validateGroupReference?: (groupId: string, spaceId: string) => void | Promise<void>;
}
export interface NoteDependencies extends TransactionDependencies {
  repository?: PostgresRepositories['noteRepository'];
  annotationRepository?: PostgresRepositories['contentAnnotationRepository'] | null;
  validateSiblingNameConflict?: (input: SiblingNameInput) => void | Promise<void>;
  validateNoteReferences?: import('./navigation-reference-policy.ts').AsyncNavigationReferencePolicy['assertNoteReferences'];
  normalizeTagIds?: import('./navigation-reference-policy.ts').AsyncNavigationReferencePolicy['normalizeTagIds'];
  noteVersionService?: NoteTransactionContext['noteVersionService'];
  onNoteContentChanged?: NoteTransactionContext['onNoteContentChanged'];
  onNoteIdentityChanged?: NoteTransactionContext['onNoteIdentityChanged'];
  onNoteDeleted?: NoteTransactionContext['onNoteDeleted'];
  onBeforePermanentDelete?: NoteTransactionContext['onBeforePermanentDelete'];
}
/** 不提供 client 时，注入仓储须遵守一致读取与写后可读契约；supportsAsync 只检查异步标记，不建立事务。 */
export interface PostgresModuleDependencies extends Partial<PostgresRepositories> {
  client?:
    | import('../../../../infrastructure/postgres-transaction-port.ts').PostgresTransactionHost<
        import('../../infrastructure/postgres/navigation-repository-types.ts').SpaceRepositoryOptions['db'] &
          import('../../infrastructure/postgres/navigation-repository-types.ts').FolderRepositoryOptions['db'] &
          import('../../infrastructure/postgres/navigation-repository-types.ts').TagRepositoryOptions['db'] &
          import('../../infrastructure/postgres/navigation-repository-types.ts').TagGroupRepositoryOptions['db'] &
          import('../../infrastructure/postgres/assessment-repository-types.ts').ObjectiveRepositoryOptions['db'] &
          import('../../infrastructure/postgres/assessment-repository-types.ts').ProfileRepositoryOptions['db'] &
          import('../../infrastructure/postgres/assessment-repository-types.ts').FocusRepositoryOptions['db'] &
          import('../../infrastructure/postgres/assessment-repository-types.ts').ObjectiveRelationRepositoryOptions['db'] &
          import('../../infrastructure/postgres/assessment-repository-types.ts').SourceRepositoryOptions['db'] &
          import('../../infrastructure/postgres/knowledge-graph-repository-types.ts').ItemRepositoryOptions['db'] &
          import('../../infrastructure/postgres/knowledge-graph-repository-types.ts').EvidenceRepositoryOptions['db'] &
          import('../../infrastructure/postgres/knowledge-graph-repository-types.ts').ProvenanceRepositoryOptions['db'] &
          import('../../infrastructure/postgres/knowledge-graph-repository-types.ts').QuestionRepositoryOptions['db'] &
          import('../../infrastructure/postgres/note-repository.ts').NoteRepositoryOptions['db'] &
          import('../../infrastructure/postgres/note-version-repository.ts').NoteVersionRepositoryOptions['db'] &
          import('../../infrastructure/postgres/content-annotation-repository.ts').ContentAnnotationRepositoryOptions['db'] &
          import('../../infrastructure/postgres/annotation-support-repositories.ts').AnnotationExclusionRepositoryOptions['db'] &
          import('../../infrastructure/postgres/annotation-support-repositories.ts').AnnotationRevisionRepositoryOptions['db'] &
          import('../../../pdf/repository.ts').PdfAnnotationRepositoryOptions['db'] &
          import('../../infrastructure/postgres/annotation-support-repositories.ts').AnalysisScopeRepositoryOptions['db']
      >
    | null;
  getPurgeTombstone?: TransactionDependencies['getTombstone'];
  readPurgeTaskState?: ReturnType<
    typeof import('../../../../infrastructure/asset-purge-task-state.ts').createPostgresPurgeTaskReader
  > | null;
  getPurgeDatasetEpoch?: (() => string | undefined | Promise<string | undefined>) | null;
}
