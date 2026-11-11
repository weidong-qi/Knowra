import type { PostgresTransactionHost } from './postgres-transaction-port.ts';
import type { createMaintenanceGate } from './maintenance-gate.ts';
import type { createPostgresAttachmentStore } from './postgres-attachment-store.ts';
import type { createPostgresAttachmentRepository } from '../modules/knowledge/infrastructure/postgres/attachment-repository.ts';
import type { loadPostgresAttachmentReferenceState } from './attachment-deletion-preflight.ts';

export interface PostgresAttachmentStoreOptions {
  attachmentRepository?: ReturnType<typeof createPostgresAttachmentRepository>;
  uploadsDir?: string;
  storageRootDir?: string;
  legacyUploadsDirs?: string[];
  validateAttachmentNote?: ((noteId: string) => Promise<void>) | null;
  loadReferenceState?: (() => ReturnType<typeof loadPostgresAttachmentReferenceState>) | null;
  runTransaction?: (<T>(operation: () => Promise<T>) => Promise<T>) | null;
}

export interface PostgresSnapshotOptions {
  client?: PostgresTransactionHost<import('./migration/migration-client.ts').MigrationTransaction>;
  repositories?: SnapshotRepositories;
  attachmentStore?: ReturnType<typeof createPostgresAttachmentStore>;
  storageRootDir?: string;
  ownerId?: string;
  maintenanceGate?: ReturnType<typeof createMaintenanceGate> | null;
  aiRepository?: { rotateEpoch: () => Promise<string> } | null;
}

export interface SnapshotRepositories {
  noteRepository: Pick<
    ReturnType<
      typeof import('../modules/knowledge/infrastructure/postgres/note-repository.ts').createPostgresNoteRepository
    >,
    'list'
  >;
  folderRepository: Pick<
    ReturnType<
      typeof import('../modules/knowledge/infrastructure/postgres/folder-repository.ts').createPostgresFolderRepository
    >,
    'list'
  >;
  tagRepository: Pick<
    ReturnType<
      typeof import('../modules/knowledge/infrastructure/postgres/tag-repository.ts').createPostgresTagRepository
    >,
    'list'
  >;
  tagGroupRepository: Pick<
    ReturnType<
      typeof import('../modules/knowledge/infrastructure/postgres/tag-group-repository.ts').createPostgresTagGroupRepository
    >,
    'list'
  >;
  knowledgeSpaceRepository: Pick<
    ReturnType<
      typeof import('../modules/knowledge/infrastructure/postgres/knowledge-space-repository.ts').createPostgresKnowledgeSpaceRepository
    >,
    'list'
  >;
  contentAnnotationRepository: Pick<
    ReturnType<
      typeof import('../modules/knowledge/infrastructure/postgres/content-annotation-repository.ts').createPostgresContentAnnotationRepository
    >,
    'list'
  >;
  annotationExclusionRepository: Pick<
    ReturnType<
      typeof import('../modules/knowledge/infrastructure/postgres/annotation-support-repositories.ts').createPostgresAnnotationExclusionRepository
    >,
    'list'
  >;
  annotationRevisionRepository: Pick<
    ReturnType<
      typeof import('../modules/knowledge/infrastructure/postgres/annotation-support-repositories.ts').createPostgresAnnotationRevisionRepository
    >,
    'list'
  >;
  analysisScopeRepository: Pick<
    ReturnType<
      typeof import('../modules/knowledge/infrastructure/postgres/annotation-support-repositories.ts').createPostgresAnalysisScopeRepository
    >,
    'list'
  >;
  noteVersionRepository: Pick<
    ReturnType<
      typeof import('../modules/knowledge/infrastructure/postgres/note-version-repository.ts').createPostgresNoteVersionRepository
    >,
    'list'
  >;
  knowledgeItemRepository: Pick<
    ReturnType<
      typeof import('../modules/knowledge/infrastructure/postgres/knowledge-item-repository.ts').createPostgresKnowledgeItemRepository
    >,
    'list'
  >;
  knowledgeEvidenceRepository: Pick<
    ReturnType<
      typeof import('../modules/knowledge/infrastructure/postgres/knowledge-evidence-repository.ts').createPostgresKnowledgeEvidenceRepository
    >,
    'list'
  >;
  knowledgeArtifactProvenanceRepository: Pick<
    ReturnType<
      typeof import('../modules/knowledge/infrastructure/postgres/knowledge-artifact-provenance-repository.ts').createPostgresKnowledgeArtifactProvenanceRepository
    >,
    'list'
  >;
  learningObjectiveRepository: Pick<
    ReturnType<
      typeof import('../modules/knowledge/infrastructure/postgres/learning-objective-repository.ts').createPostgresLearningObjectiveRepository
    >,
    'list'
  >;
  examProfileRepository: Pick<
    ReturnType<
      typeof import('../modules/knowledge/infrastructure/postgres/exam-profile-repository.ts').createPostgresExamProfileRepository
    >,
    'list'
  >;
  examFocusRepository: Pick<
    ReturnType<
      typeof import('../modules/knowledge/infrastructure/postgres/exam-focus-repository.ts').createPostgresExamFocusRepository
    >,
    'list'
  >;
  questionRepository: Pick<
    ReturnType<
      typeof import('../modules/knowledge/infrastructure/postgres/question-repository.ts').createPostgresQuestionRepository
    >,
    'list'
  >;
  questionObjectiveRepository: Pick<
    ReturnType<
      typeof import('../modules/knowledge/infrastructure/postgres/question-objective-repository.ts').createPostgresQuestionObjectiveRepository
    >,
    'listByQuestionIds'
  >;
  questionSourceRepository: Pick<
    ReturnType<
      typeof import('../modules/knowledge/infrastructure/postgres/question-source-repository.ts').createPostgresQuestionSourceRepository
    >,
    'list'
  >;
}
