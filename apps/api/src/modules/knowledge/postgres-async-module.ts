import {
  degradeInlineSourceEvidenceAsync,
  deriveInlineAnnotations,
  marksOnlyDependencies,
  withInlineAnnotations
} from './application/inline-annotations.ts';
import { createAsyncNoteDependencyLifecycle } from './application/postgres-async/note-dependency-lifecycle.ts';
import { createAsyncSpaceAssetLifecycle } from './application/postgres-async/space-asset-lifecycle.ts';
import { createPostgresPdfAnnotationRepository } from '../pdf/repository.ts';
import { createAsyncNavigationReferencePolicy } from './application/postgres-async/navigation-reference-policy.ts';
import {
  asyncTaskCoverage,
  supplementPurgePreview,
  assertPurgeDatasetEpoch,
  assertManualPurgeScope
} from './application/asset-purge-guard.ts';
import { createAsyncNoteService } from './application/postgres-async/note-service.ts';
import { createAsyncFolderService } from './application/postgres-async/folder-service.ts';
import { createAsyncTagService } from './application/postgres-async/tag-service.ts';
import { createAsyncTagGroupService } from './application/postgres-async/tag-group-service.ts';
import { createAsyncKnowledgeSpaceService } from './application/postgres-async/space-service.ts';
import { createAsyncContentAnnotationService } from './application/postgres-async/content-annotation-service.ts';
import { createAsyncNoteVersionService } from './application/note-version-service.ts';
import { buildNoteVersionPrunePreview } from './application/note-version-prune-preview.ts';
import { createAsyncKnowledgeItemService } from './application/postgres-async/knowledge-domain-service.ts';
import { inspectKnowledgeItemPurge, assertKnowledgeItemPurgeAllowed } from './application/knowledge-item-purge.ts';
import { createAsyncSearchService } from './application/postgres-async/search-service.ts';
import { createPostgresNoteRepository } from './infrastructure/postgres/note-repository.ts';
import { createPostgresFolderRepository } from './infrastructure/postgres/folder-repository.ts';
import { createPostgresContentAnnotationRepository } from './infrastructure/postgres/content-annotation-repository.ts';
import { createPostgresNoteVersionRepository } from './infrastructure/postgres/note-version-repository.ts';
import { createPostgresKnowledgeItemRepository } from './infrastructure/postgres/knowledge-item-repository.ts';
import { createKnowledgeArtifactProvenanceReader } from './application/knowledge-artifact-provenance-read.ts';
import { createPostgresKnowledgeArtifactProvenanceRepository } from './infrastructure/postgres/knowledge-artifact-provenance-repository.ts';
import { createPostgresKnowledgeEvidenceRepository } from './infrastructure/postgres/knowledge-evidence-repository.ts';
import { createPostgresLearningObjectiveRepository } from './infrastructure/postgres/learning-objective-repository.ts';
import { createPostgresExamProfileRepository } from './infrastructure/postgres/exam-profile-repository.ts';
import { createPostgresExamFocusRepository } from './infrastructure/postgres/exam-focus-repository.ts';
import { createPostgresQuestionRepository } from './infrastructure/postgres/question-repository.ts';
import { createPostgresQuestionObjectiveRepository } from './infrastructure/postgres/question-objective-repository.ts';
import { createPostgresQuestionSourceRepository } from './infrastructure/postgres/question-source-repository.ts';
import {
  createPostgresAnalysisScopeRepository,
  createPostgresAnnotationExclusionRepository,
  createPostgresAnnotationRevisionRepository
} from './infrastructure/postgres/annotation-support-repositories.ts';
import { createAsyncAnnotationScopeService } from './application/postgres-async/annotation-scope-service.ts';
import { createPostgresKnowledgeSpaceRepository } from './infrastructure/postgres/knowledge-space-repository.ts';
import { createPostgresTagGroupRepository } from './infrastructure/postgres/tag-group-repository.ts';
import { createPostgresTagRepository } from './infrastructure/postgres/tag-repository.ts';
import { createAsyncLearningObjectiveService } from './application/postgres-async/learning-objective-service.ts';
import { createAsyncAssessmentContextService } from './application/postgres-async/assessment-context-service.ts';
import { createAsyncQuestionService } from './application/postgres-async/question-service.ts';
import { createTrainingAssetLifecycle } from './application/training-asset-lifecycle.ts';
import { createWorkspaceQueryService } from './application/workspace-query-service.ts';
import { conflictError, validationError } from './application/knowledge-errors.ts';
import { withPostgresErrors } from '../../infrastructure/postgres-errors.ts';
import { withLearningObjectiveReviewErrors } from './application/learning-objective-concurrency.ts';

import type {
  PostgresModuleDependencies,
  KnowledgeModuleRepositories,
  KnowledgeModuleTransaction,
  SiblingNameInput
} from './application/postgres-async/service-dependencies.ts';

// 同一方法名的参数元组与返回类型保持关联，转发时不改变调用目标或参数。
type ForwardMethod<Method extends (...args: never[]) => unknown> = (
  ...args: Parameters<Method>
) => Promise<Awaited<ReturnType<Method>>>;

export function createPostgresKnowledgeModule({
  noteRepository: suppliedNoteRepository,
  folderRepository: suppliedFolderRepository,
  tagRepository: suppliedTagRepository,
  tagGroupRepository: suppliedTagGroupRepository,
  knowledgeSpaceRepository: suppliedKnowledgeSpaceRepository,
  contentAnnotationRepository: suppliedContentAnnotationRepository,
  pdfAnnotationRepository: suppliedPdfAnnotationRepository,
  annotationExclusionRepository: suppliedAnnotationExclusionRepository,
  annotationRevisionRepository: suppliedAnnotationRevisionRepository,
  analysisScopeRepository: suppliedAnalysisScopeRepository,
  noteVersionRepository: suppliedNoteVersionRepository,
  knowledgeItemRepository: suppliedKnowledgeItemRepository,
  knowledgeEvidenceRepository: suppliedKnowledgeEvidenceRepository,
  knowledgeArtifactProvenanceRepository: suppliedKnowledgeArtifactProvenanceRepository,
  learningObjectiveRepository: suppliedLearningObjectiveRepository,
  examProfileRepository: suppliedExamProfileRepository,
  examFocusRepository: suppliedExamFocusRepository,
  questionRepository: suppliedQuestionRepository,
  questionObjectiveRepository: suppliedQuestionObjectiveRepository,
  questionSourceRepository: suppliedQuestionSourceRepository,
  client = null,
  getPurgeTombstone = null,
  readPurgeTaskState = null,
  getPurgeDatasetEpoch = null
}: PostgresModuleDependencies = {}) {
  const suppliedRepositories = {
    noteRepository: suppliedNoteRepository,
    folderRepository: suppliedFolderRepository,
    tagRepository: suppliedTagRepository,
    tagGroupRepository: suppliedTagGroupRepository,
    knowledgeSpaceRepository: suppliedKnowledgeSpaceRepository,
    contentAnnotationRepository: suppliedContentAnnotationRepository,
    pdfAnnotationRepository: suppliedPdfAnnotationRepository,
    annotationExclusionRepository: suppliedAnnotationExclusionRepository,
    annotationRevisionRepository: suppliedAnnotationRevisionRepository,
    analysisScopeRepository: suppliedAnalysisScopeRepository,
    noteVersionRepository: suppliedNoteVersionRepository,
    knowledgeItemRepository: suppliedKnowledgeItemRepository,
    knowledgeEvidenceRepository: suppliedKnowledgeEvidenceRepository,
    knowledgeArtifactProvenanceRepository: suppliedKnowledgeArtifactProvenanceRepository,
    learningObjectiveRepository: suppliedLearningObjectiveRepository,
    examProfileRepository: suppliedExamProfileRepository,
    examFocusRepository: suppliedExamFocusRepository,
    questionRepository: suppliedQuestionRepository,
    questionObjectiveRepository: suppliedQuestionObjectiveRepository,
    questionSourceRepository: suppliedQuestionSourceRepository
  };
  Object.entries(suppliedRepositories).forEach(([name, repository]) => {
    if (!repository?.supportsAsync) throw new TypeError(`Missing PostgreSQL repository: ${name}`);
  });

  // 上面的原有循环已排除全部缺失仓储；Object.entries 不保留键与可选值的缩窄关系。
  const repositories = suppliedRepositories as KnowledgeModuleRepositories;
  const {
    noteRepository,
    folderRepository,
    tagRepository,
    tagGroupRepository,
    knowledgeSpaceRepository,
    contentAnnotationRepository,
    pdfAnnotationRepository,
    annotationExclusionRepository,
    annotationRevisionRepository,
    analysisScopeRepository,
    noteVersionRepository,
    knowledgeItemRepository,
    knowledgeEvidenceRepository,
    knowledgeArtifactProvenanceRepository,
    learningObjectiveRepository,
    examProfileRepository,
    examFocusRepository,
    questionRepository,
    questionObjectiveRepository,
    questionSourceRepository
  } = repositories;

  const transactionRepositories = {
    folderRepository,
    knowledgeSpaceRepository,
    tagRepository,
    tagGroupRepository,
    noteRepository,
    noteVersionRepository,
    knowledgeItemRepository,
    knowledgeEvidenceRepository,
    knowledgeArtifactProvenanceRepository,
    contentAnnotationRepository,
    pdfAnnotationRepository,
    annotationExclusionRepository,
    annotationRevisionRepository,
    analysisScopeRepository,
    learningObjectiveRepository,
    examProfileRepository,
    examFocusRepository,
    questionRepository,
    questionObjectiveRepository,
    questionSourceRepository
  };
  function createTransactionFormalServices(transaction: KnowledgeModuleRepositories) {
    const transactionQuestionService = createAsyncQuestionService({
      repository: transaction.questionRepository,
      questionObjectiveRepository: transaction.questionObjectiveRepository,
      questionSourceRepository: transaction.questionSourceRepository,
      learningObjectiveRepository: transaction.learningObjectiveRepository,
      examFocusRepository: transaction.examFocusRepository,
      knowledgeItemRepository: transaction.knowledgeItemRepository,
      noteRepository: transaction.noteRepository,
      noteVersionRepository: transaction.noteVersionRepository,
      knowledgeEvidenceRepository: transaction.knowledgeEvidenceRepository,
      getTombstone: getPurgeTombstone,
      runTransaction: operation => operation(transaction)
    });
    const transactionLearningObjectiveService = createAsyncLearningObjectiveService({
      repository: transaction.learningObjectiveRepository,
      knowledgeItemRepository: transaction.knowledgeItemRepository,
      getTombstone: getPurgeTombstone,
      onObjectiveInvalidated: learningObjectiveId =>
        transactionQuestionService.invalidateByObjectiveId(learningObjectiveId),
      runTransaction: operation => operation(transaction)
    });
    const transactionKnowledgeItemService = createAsyncKnowledgeItemService({
      repository: transaction.knowledgeItemRepository,
      evidenceRepository: transaction.knowledgeEvidenceRepository,
      noteVersionRepository: transaction.noteVersionRepository,
      annotationRepository: transaction.contentAnnotationRepository,
      noteRepository: transaction.noteRepository,
      getTombstone: getPurgeTombstone,
      onItemInvalidated: async knowledgeItemId => {
        await transactionLearningObjectiveService.invalidateByKnowledgeItemId(knowledgeItemId);
        await transactionQuestionService.markSourcesStale('knowledgeItem', [knowledgeItemId]);
      },
      runTransaction: operation => operation(transaction)
    });
    return {
      knowledgeItemService: transactionKnowledgeItemService,
      learningObjectiveService: transactionLearningObjectiveService,
      questionService: transactionQuestionService
    };
  }
  function buildNoteTransactionContext(transaction: KnowledgeModuleRepositories) {
    const formalServices = createTransactionFormalServices(transaction);
    const dependencies = {
      createAnnotationService: () => buildTransactionAnnotationServices(transaction).annotationService,
      contentAnnotationRepository: transaction.contentAnnotationRepository,
      noteVersionRepository: transaction.noteVersionRepository,
      knowledgeEvidenceRepository: transaction.knowledgeEvidenceRepository,
      questionSourceRepository: transaction.questionSourceRepository,
      analysisScopeRepository: transaction.analysisScopeRepository,
      knowledgeItemService: formalServices.knowledgeItemService,
      questionService: formalServices.questionService
    };
    const lifecycle = (deps: Parameters<typeof createAsyncNoteDependencyLifecycle>[0]) =>
      createAsyncNoteDependencyLifecycle(deps);
    return {
      noteRepository: transaction.noteRepository,
      annotationRepository: transaction.contentAnnotationRepository,
      noteVersionService: createAsyncNoteVersionService({ repository: transaction.noteVersionRepository }),
      // 重点内联化：只改标记的保存不让旧版本证据过期；级联完成后从正文派生内联重点行。
      ...withInlineAnnotations(lifecycle(dependencies), {
        repository: transaction.contentAnnotationRepository,
        revisionRepository: transaction.annotationRevisionRepository,
        marksOnlyLifecycle: lifecycle(marksOnlyDependencies(dependencies)),
        onSourceChanged: degradeInlineSourceEvidenceAsync(dependencies)
      })
    };
  }
  const runTransaction = (
    client?.$transaction
      ? operation =>
          withPostgresErrors(() =>
            client.$transaction(
              async tx =>
                operation({
                  folderRepository: createPostgresFolderRepository({ db: tx }),
                  knowledgeSpaceRepository: createPostgresKnowledgeSpaceRepository({ db: tx }),
                  tagRepository: createPostgresTagRepository({ db: tx }),
                  tagGroupRepository: createPostgresTagGroupRepository({ db: tx }),
                  noteRepository: createPostgresNoteRepository({ db: tx }),
                  noteVersionRepository: createPostgresNoteVersionRepository({ db: tx }),
                  knowledgeItemRepository: createPostgresKnowledgeItemRepository({ db: tx }),
                  knowledgeEvidenceRepository: createPostgresKnowledgeEvidenceRepository({ db: tx }),
                  knowledgeArtifactProvenanceRepository: createPostgresKnowledgeArtifactProvenanceRepository({
                    db: tx
                  }),
                  contentAnnotationRepository: createPostgresContentAnnotationRepository({ db: tx }),
                  pdfAnnotationRepository: createPostgresPdfAnnotationRepository({ db: tx }),
                  annotationExclusionRepository: createPostgresAnnotationExclusionRepository({ db: tx }),
                  annotationRevisionRepository: createPostgresAnnotationRevisionRepository({ db: tx }),
                  analysisScopeRepository: createPostgresAnalysisScopeRepository({ db: tx }),
                  learningObjectiveRepository: createPostgresLearningObjectiveRepository({ db: tx }),
                  examProfileRepository: createPostgresExamProfileRepository({ db: tx }),
                  examFocusRepository: createPostgresExamFocusRepository({ db: tx }),
                  questionRepository: createPostgresQuestionRepository({ db: tx }),
                  questionObjectiveRepository: createPostgresQuestionObjectiveRepository({ db: tx }),
                  questionSourceRepository: createPostgresQuestionSourceRepository({ db: tx })
                }),
              { isolationLevel: 'Serializable' }
            )
          )
      : operation => operation(transactionRepositories)
  ) as KnowledgeModuleTransaction;
  const trainingAssetLifecycle = createTrainingAssetLifecycle({
    repositories,
    runTransaction,
    getTombstone: getPurgeTombstone,
    readPurgeTaskState,
    getPurgeDatasetEpoch
  });

  function normalizeComparableName(value: string | null | undefined) {
    return String(value ?? '').trim();
  }

  async function assertSiblingNameAvailable({
    spaceId,
    parentId = null,
    folderId = null,
    title,
    name,
    currentFolderId = null,
    currentNoteId = null
  }: Omit<SiblingNameInput, 'spaceId'> & { spaceId?: string | null }) {
    const candidate = normalizeComparableName(name ?? title);
    if (!candidate) return;
    const folders = await folderRepository.list({ spaceId });
    if (
      folders.some(
        folder =>
          folder.parentId === parentId &&
          folder.id !== currentFolderId &&
          normalizeComparableName(folder.name) === candidate
      )
    ) {
      throw conflictError('SIBLING_NAME_CONFLICT', 'A file or folder with the same name already exists');
    }
    const notes = await noteRepository.list({ spaceId, includeDeleted: true });
    if (
      notes.some(
        note =>
          !note.deleted &&
          note.folderId === folderId &&
          note.id !== currentNoteId &&
          normalizeComparableName(note.title) === candidate
      )
    ) {
      throw conflictError('SIBLING_NAME_CONFLICT', 'A file or folder with the same name already exists');
    }
  }

  const { assertSpaceReference, assertNoteReferences, assertTagGroupReference, normalizeTagIds } =
    createAsyncNavigationReferencePolicy({
      knowledgeSpaceRepository,
      folderRepository,
      tagRepository,
      tagGroupRepository
    });

  const folderService = createAsyncFolderService({
    repository: folderRepository,
    validateSpaceReference: spaceId => assertSpaceReference(spaceId, 'FOLDER'),
    validateSiblingNameConflict: assertSiblingNameAvailable
  });
  const tagService = createAsyncTagService({
    repository: tagRepository,
    validateSpaceReference: spaceId => assertSpaceReference(spaceId, 'TAG'),
    validateGroupReference: assertTagGroupReference
  });
  const tagGroupService = createAsyncTagGroupService({
    repository: tagGroupRepository,
    tagRepository,
    validateSpaceReference: spaceId => assertSpaceReference(spaceId, 'TAG_GROUP')
  });
  const knowledgeSpaceService = createAsyncKnowledgeSpaceService({
    repository: knowledgeSpaceRepository,
    tagGroupRepository,
    runTransaction: async operation =>
      runTransaction(async transaction =>
        operation({
          knowledgeSpaceRepository: transaction.knowledgeSpaceRepository,
          tagGroupRepository: transaction.tagGroupRepository
        })
      )
  });
  const noteVersionService = createAsyncNoteVersionService({ repository: noteVersionRepository });
  let learningObjectiveService: ReturnType<typeof createAsyncLearningObjectiveService> | null = null;
  let questionService: ReturnType<typeof createAsyncQuestionService> | null = null;
  const knowledgeItemService = createAsyncKnowledgeItemService({
    repository: knowledgeItemRepository,
    evidenceRepository: knowledgeEvidenceRepository,
    noteVersionRepository,
    annotationRepository: contentAnnotationRepository,
    noteRepository,
    getTombstone: getPurgeTombstone,
    onItemInvalidated: async knowledgeItemId => {
      await learningObjectiveService?.invalidateByKnowledgeItemId(knowledgeItemId);
      await questionService?.markSourcesStale('knowledgeItem', [knowledgeItemId]);
    },
    runTransaction: async operation =>
      runTransaction(async transaction =>
        operation({
          itemRepository: transaction.knowledgeItemRepository,
          evidenceRepository: transaction.knowledgeEvidenceRepository,
          noteRepository: transaction.noteRepository,
          noteVersionRepository: transaction.noteVersionRepository,
          annotationRepository: transaction.contentAnnotationRepository
        })
      )
  });
  for (const method of [
    'updateItem',
    'confirmItem',
    'markNeedsRevision',
    'archive',
    'restore',
    'trash',
    'restoreDeleted',
    'retireEvidence',
    'markEvidenceByNoteId',
    'markEvidenceByAnnotationId',
    'reconcileEvidenceByAnnotationIds',
    'markEvidenceByNoteVersionId'
  ] as const) {
    type Method = (typeof knowledgeItemService)[typeof method];
    (knowledgeItemService as Record<typeof method, ForwardMethod<Method>>)[method] = (...args: Parameters<Method>) =>
      runTransaction(transaction =>
        (createTransactionFormalServices(transaction).knowledgeItemService[method] as ForwardMethod<Method>)(...args)
      );
  }
  learningObjectiveService = createAsyncLearningObjectiveService({
    repository: learningObjectiveRepository,
    knowledgeItemRepository,
    getTombstone: getPurgeTombstone,
    onObjectiveInvalidated: learningObjectiveId => questionService?.invalidateByObjectiveId(learningObjectiveId),
    runTransaction: async operation =>
      runTransaction(async transaction =>
        operation({
          learningObjectiveRepository: transaction.learningObjectiveRepository
        })
      )
  });
  for (const method of [
    'createCandidate',
    'updateObjective',
    'confirmObjective',
    'requestRevision',
    'archive',
    'restore',
    'invalidateByKnowledgeItemId'
  ] as const) {
    type Method = (typeof learningObjectiveService)[typeof method];
    (learningObjectiveService as Record<typeof method, ForwardMethod<Method>>)[method] = (
      ...args: Parameters<Method>
    ) => {
      const operation = () =>
        runTransaction(transaction =>
          (createTransactionFormalServices(transaction).learningObjectiveService[method] as ForwardMethod<Method>)(
            ...args
          )
        );
      return ['createCandidate', 'updateObjective', 'confirmObjective'].includes(method)
        ? withLearningObjectiveReviewErrors(method === 'createCandidate' ? args[0] : args[1], operation, {
            hasObjective: method !== 'createCandidate'
          })
        : operation();
    };
  }
  const { profileService: examProfileService, focusService: examFocusService } = createAsyncAssessmentContextService({
    examProfileRepository,
    examFocusRepository,
    learningObjectiveRepository,
    getTombstone: getPurgeTombstone,
    runTransaction: async operation =>
      runTransaction(async transaction =>
        operation({
          examProfileRepository: transaction.examProfileRepository,
          examFocusRepository: transaction.examFocusRepository,
          learningObjectiveRepository: transaction.learningObjectiveRepository
        })
      )
  });
  questionService = createAsyncQuestionService({
    repository: questionRepository,
    questionObjectiveRepository,
    questionSourceRepository,
    learningObjectiveRepository,
    examFocusRepository,
    knowledgeItemRepository,
    noteRepository,
    noteVersionRepository,
    knowledgeEvidenceRepository,
    getTombstone: getPurgeTombstone,
    runTransaction: async operation =>
      runTransaction(async transaction =>
        operation({
          questionRepository: transaction.questionRepository,
          questionObjectiveRepository: transaction.questionObjectiveRepository,
          questionSourceRepository: transaction.questionSourceRepository
        })
      )
  });
  const directAnnotationService = createAsyncContentAnnotationService({
    repository: contentAnnotationRepository,
    noteRepository,
    noteVersionRepository,
    revisionRepository: annotationRevisionRepository
  });
  const buildTransactionAnnotationServices = (transaction: KnowledgeModuleRepositories) => {
    const annotationService = createAsyncContentAnnotationService({
      repository: transaction.contentAnnotationRepository,
      noteRepository: transaction.noteRepository,
      noteVersionRepository: transaction.noteVersionRepository,
      revisionRepository: transaction.annotationRevisionRepository,
      exclusionRepository: transaction.annotationExclusionRepository,
      onSourceChanged: async annotation => {
        const formal = createTransactionFormalServices(transaction);
        const changed = await formal.knowledgeItemService.markEvidenceByAnnotationId(
          annotation.id,
          annotation.anchorStatus === 'missing' ? 'insufficient' : 'stale'
        );
        await formal.questionService.markSourcesStale(
          'knowledgeEvidence',
          changed.map(evidence => evidence.id)
        );
      }
    });
    const scopeService = createAsyncAnnotationScopeService({
      annotationRepository: transaction.contentAnnotationRepository,
      exclusionRepository: transaction.annotationExclusionRepository,
      analysisScopeRepository: transaction.analysisScopeRepository,
      noteRepository: transaction.noteRepository,
      noteVersionRepository: transaction.noteVersionRepository,
      evidenceRepository: transaction.knowledgeEvidenceRepository,
      knowledgeItemRepository: transaction.knowledgeItemRepository
    });
    return { annotationService, scopeService };
  };
  type AnnotationService = ReturnType<typeof buildTransactionAnnotationServices>['annotationService'];
  const annotationMutation =
    <Method extends keyof AnnotationService>(method: Method) =>
    (...args: Parameters<AnnotationService[Method]>) =>
      runTransaction(transaction =>
        (
          buildTransactionAnnotationServices(transaction).annotationService[method] as ForwardMethod<
            AnnotationService[Method]
          >
        )(...args)
      );
  const contentAnnotationService = {
    listAnnotationsByNote: (...args: Parameters<typeof directAnnotationService.listAnnotationsByNote>) =>
      directAnnotationService.listAnnotationsByNote(...args),
    getAnnotation: (...args: Parameters<typeof directAnnotationService.getAnnotation>) =>
      directAnnotationService.getAnnotation(...args),
    ...Object.fromEntries(
      (
        [
          'createAnnotation',
          'updateAnnotation',
          'archiveAnnotation',
          'deleteAnnotation',
          'restoreAnnotation',
          'updateAnnotationAnchor',
          'confirmAnnotationRange',
          'reconcileForNote'
        ] as const
      ).map(method => [method, annotationMutation(method)])
    )
  } as ReturnType<typeof createAsyncContentAnnotationService>;
  const directScopeService = createAsyncAnnotationScopeService({
    annotationRepository: contentAnnotationRepository,
    exclusionRepository: annotationExclusionRepository,
    analysisScopeRepository,
    noteRepository,
    noteVersionRepository,
    evidenceRepository: knowledgeEvidenceRepository,
    knowledgeItemRepository
  });
  type ScopeService = ReturnType<typeof buildTransactionAnnotationServices>['scopeService'];
  const scopeMutation =
    <Method extends keyof ScopeService>(method: Method) =>
    (...args: Parameters<ScopeService[Method]>) =>
      runTransaction(transaction =>
        (buildTransactionAnnotationServices(transaction).scopeService[method] as ForwardMethod<ScopeService[Method]>)(
          ...args
        )
      );
  const annotationScopeService = {
    /** @param {Parameters<typeof directScopeService.previewAnnotation>} args */
    previewAnnotation: (...args: Parameters<typeof directScopeService.previewAnnotation>) =>
      directScopeService.previewAnnotation(...args),
    /** @param {Parameters<typeof directScopeService.getKnowledgeLinks>} args */
    getKnowledgeLinks: (...args: Parameters<typeof directScopeService.getKnowledgeLinks>) =>
      directScopeService.getKnowledgeLinks(...args),
    previewAnalysisScope: (...args: Parameters<typeof directScopeService.previewAnalysisScope>) =>
      directScopeService.previewAnalysisScope(...args),
    /** @param {Parameters<typeof directScopeService.getAnalysisScope>} args */
    getAnalysisScope: (...args: Parameters<typeof directScopeService.getAnalysisScope>) =>
      directScopeService.getAnalysisScope(...args),
    createExclusion: scopeMutation('createExclusion'),
    deleteExclusion: scopeMutation('deleteExclusion'),
    createAnalysisScope: scopeMutation('createAnalysisScope'),
    /** @param {Parameters<typeof directScopeService.listAnalysisScopes>} args */
    listAnalysisScopes: (...args: Parameters<typeof directScopeService.listAnalysisScopes>) =>
      directScopeService.listAnalysisScopes(...args),
    trashAnalysisScope: scopeMutation('trashAnalysisScope'),
    restoreAnalysisScope: scopeMutation('restoreAnalysisScope')
  };

  const noteService = createAsyncNoteService({
    repository: noteRepository,
    annotationRepository: contentAnnotationRepository,
    noteVersionService,
    runTransaction: async operation =>
      runTransaction(async transaction => operation(buildNoteTransactionContext(transaction))),
    onNoteContentChanged: async (note, version) => {
      await deriveInlineAnnotations(
        { repository: contentAnnotationRepository, revisionRepository: annotationRevisionRepository },
        note,
        version
      );
    },
    onNoteDeleted: noteId => knowledgeItemService.markEvidenceByNoteId(noteId, 'invalid'),
    onBeforePermanentDelete: async noteId => {
      if ((await knowledgeEvidenceRepository.list({ noteId })).length > 0) {
        throw conflictError(
          'NOTE_HAS_KNOWLEDGE_EVIDENCE',
          'Note has formal knowledge evidence and cannot be permanently deleted'
        );
      }
      const versions = await noteVersionRepository.list({ noteId });
      const versionIds = new Set<unknown>(versions.map(version => version.id));
      const sources = await questionSourceRepository.list();
      if (sources.some(source => source.sourceType === 'noteVersion' && versionIds.has(source.sourceId))) {
        throw conflictError(
          'NOTE_HAS_QUESTION_SOURCE',
          'Note has a formal question source and cannot be permanently deleted'
        );
      }
      const snapshots = await analysisScopeRepository.list();
      if (
        snapshots.some(snapshot =>
          (
            snapshot.noteVersions as import('./application/postgres-async/note-dependency-lifecycle.ts').DependencyScopeSnapshot['noteVersions']
          )?.some(version => version.noteId === noteId || (versionIds as Set<unknown>).has(version.noteVersionId))
        )
      ) {
        throw conflictError(
          'NOTE_HAS_ANALYSIS_SCOPE',
          'NoteVersion is referenced by an analysis scope snapshot and cannot be deleted'
        );
      }
    },
    validateNoteReferences: assertNoteReferences,
    normalizeTagIds,
    validateSiblingNameConflict: assertSiblingNameAvailable
  });
  const searchService = createAsyncSearchService({
    findKnowledgeSpace: spaceId => knowledgeSpaceRepository.findById(spaceId),
    listNotes: options => noteService.listNotes(options)
  });
  const workspaceQueryService = createWorkspaceQueryService({ repositories });

  const getKnowledgeProvenance = createKnowledgeArtifactProvenanceReader(repositories);

  async function inspectKnowledgePurge(
    id: string,
    source: KnowledgeModuleRepositories | null = null
  ): Promise<ReturnType<typeof supplementPurgePreview<ReturnType<typeof inspectKnowledgeItemPurge>>>> {
    if (!source) return runTransaction(transaction => inspectKnowledgePurge(id, transaction));
    const [item, evidence, provenance, learningObjectives, questionSources, analysisScopes] = await Promise.all([
      source.knowledgeItemRepository.findById(id),
      source.knowledgeEvidenceRepository.list({ knowledgeItemId: id }),
      source.knowledgeArtifactProvenanceRepository.list({ artifactId: id }),
      source.learningObjectiveRepository.list({ includeArchived: true, includeDeleted: true }),
      source.questionSourceRepository.list(),
      source.analysisScopeRepository.list({ includeDeleted: true })
    ]);
    const epoch = await getPurgeDatasetEpoch?.();
    return supplementPurgePreview(
      inspectKnowledgeItemPurge({ item, evidence, provenance, learningObjectives, questionSources, analysisScopes }),
      await asyncTaskCoverage(readPurgeTaskState),
      epoch
    );
  }

  async function permanentlyDeleteKnowledgeItem(
    id: string,
    input: Parameters<typeof assertManualPurgeScope>[2] & { expectedUpdatedAt?: unknown } = {}
  ) {
    const { expectedUpdatedAt } = input;
    return runTransaction(async transaction => {
      assertPurgeDatasetEpoch(input, await getPurgeDatasetEpoch?.());
      if (!(await transaction.knowledgeItemRepository.findById(id))) {
        const tombstone = await getPurgeTombstone?.('knowledgeItems', id);
        if (
          !expectedUpdatedAt ||
          !tombstone ||
          (tombstone.previousUpdatedAt && tombstone.previousUpdatedAt !== expectedUpdatedAt)
        ) {
          throw validationError('KNOWLEDGE_ITEM_NOT_FOUND', '知识点不存在');
        }
        return {
          status: 'already-purged',
          asset: { type: 'knowledgeItem', id },
          exclusiveRecordsDeleted: { knowledgeEvidence: 0, knowledgeArtifactProvenance: 0 },
          offlineDevices: 'pending-sync',
          backups: 'retention-managed'
        };
      }
      const preflight = await inspectKnowledgePurge(id, transaction);
      assertKnowledgeItemPurgeAllowed(preflight, expectedUpdatedAt);
      assertManualPurgeScope(
        'knowledgeItem',
        // 真实 PG 路径使用同一 Serializable 快照，已确认存在且尚未删除；注入回退须保持相同一致性契约。
        (await transaction.knowledgeItemRepository.findById(id))!,
        input,
        await transaction.knowledgeArtifactProvenanceRepository.list({ artifactId: id })
      );
      const removedProvenance = await transaction.knowledgeArtifactProvenanceRepository.deleteByKnowledgeItemId(id);
      const removedEvidence = await transaction.knowledgeEvidenceRepository.deleteByKnowledgeItemId(id);
      await transaction.knowledgeItemRepository.delete(id);
      return {
        status: 'subject-purged',
        asset: preflight.asset,
        exclusiveRecordsDeleted: {
          knowledgeEvidence: removedEvidence.length,
          knowledgeArtifactProvenance: removedProvenance.length
        },
        offlineDevices: 'pending-sync',
        backups: 'retention-managed'
      };
    });
  }

  async function previewNoteVersionPrune(noteId: string) {
    const [note, versions, evidence, questionSources, annotations, exclusions, analysisScopes, provenance] =
      await Promise.all([
        noteRepository.findById(noteId),
        noteVersionRepository.list({ noteId }),
        knowledgeEvidenceRepository.list({ noteId }),
        questionSourceRepository.list(),
        contentAnnotationRepository.list({ noteId, includeDeleted: true }),
        annotationExclusionRepository.list({ includeDeleted: true }),
        analysisScopeRepository.list({ includeDeleted: true }),
        knowledgeArtifactProvenanceRepository.list()
      ]);
    if (!note) throw validationError('NOTE_NOT_FOUND', '笔记不存在');
    return buildNoteVersionPrunePreview({
      note,
      versions,
      evidence,
      questionSources,
      annotations,
      exclusions,
      analysisScopes,
      provenance
    });
  }

  const { inspectEmptySpaceDeletion, deleteEmptySpace, previewSpaceMigration, migrateSpaceAssets } =
    createAsyncSpaceAssetLifecycle({
      knowledgeSpaceRepository,
      folderRepository,
      noteRepository,
      tagRepository,
      tagGroupRepository,
      contentAnnotationRepository,
      pdfAnnotationRepository,
      analysisScopeRepository,
      noteVersionRepository,
      runTransaction
    });

  return {
    repositories,
    noteService,
    folderService,
    tagService,
    tagGroupService,
    contentAnnotationService,
    annotationScopeService,
    noteVersionService,
    knowledgeItemService,
    learningObjectiveService,
    examProfileService,
    examFocusService,
    questionService,
    trainingAssetLifecycle,
    workspaceQueryService,
    knowledgeSpaceService,
    searchService,
    getKnowledgeProvenance,
    inspectKnowledgePurge,
    permanentlyDeleteKnowledgeItem,
    previewNoteVersionPrune,
    inspectEmptySpaceDeletion,
    deleteEmptySpace,
    previewSpaceMigration,
    migrateSpaceAssets,
    async deleteFolderAndCleanup(folderId: string, input: { mode?: string; destinationId?: string | null } = {}) {
      return runTransaction(async transaction => {
        const txFolderService = createAsyncFolderService({
          repository: transaction.folderRepository,
          validateSiblingNameConflict: assertSiblingNameAvailable
        });
        const txNoteService = createAsyncNoteService({
          repository: transaction.noteRepository,
          annotationRepository: transaction.contentAnnotationRepository,
          runTransaction: operation => operation(buildNoteTransactionContext(transaction)),
          validateSiblingNameConflict: assertSiblingNameAvailable
        });
        const root = await transaction.folderRepository.findById(folderId);
        if (!root || root.deletedAt) throw conflictError('FOLDER_NOT_FOUND', '文件夹不存在');
        if (!(['keep', 'with-content'] as readonly (string | undefined)[]).includes(input.mode))
          throw validationError('FOLDER_DELETE_MODE_REQUIRED', '请选择保留并移动内容，或将内容一起移入回收站');
        const subtreeIds = await txFolderService.getFolderSubtreeIds(folderId);
        const destinationId = Object.hasOwn(input, 'destinationId') ? input.destinationId : (root.parentId ?? null);
        if (input.mode === 'keep' && destinationId) {
          const destination = await transaction.folderRepository.findById(destinationId);
          if (
            !destination ||
            destination.deletedAt ||
            destination.spaceId !== root.spaceId ||
            subtreeIds.includes(destinationId)
          )
            throw conflictError('FOLDER_DESTINATION_INVALID', '目标文件夹不可用');
        }
        const notes = (await transaction.noteRepository.list({ spaceId: root.spaceId, includeDeleted: true })).filter(
          note => (subtreeIds as readonly (string | null)[]).includes(note.folderId)
        );
        const packageId = `folder-${folderId}-${Date.now()}`;
        const noteIds = [];
        for (const note of notes.filter(note => !note.deleted)) {
          if (input.mode === 'keep') {
            await txNoteService.updateNote(note.id, { folderId: destinationId });
            noteIds.push(note.id);
          } else {
            const deleted = await txNoteService.deleteNote(note.id);
            // PG 删除服务经 CAS 写后读返回记录；事务持有行锁，注入仓储须遵守写后可读契约。
            await transaction.noteRepository.save({ ...deleted!, folderDeletionPackageId: packageId });
            noteIds.push(note.id);
          }
        }
        const deletionPackage = {
          id: packageId,
          mode: input.mode as 'keep' | 'with-content',
          folderIds: subtreeIds,
          noteIds,
          destinationId
        };
        return { folders: await txFolderService.trashFolder(folderId, deletionPackage), deletionPackage };
      });
    },
    async restoreDeletedFolder(folderId: string) {
      return runTransaction(async transaction => {
        const txFolderService = createAsyncFolderService({
          repository: transaction.folderRepository,
          validateSiblingNameConflict: assertSiblingNameAvailable
        });
        const txNoteService = createAsyncNoteService({
          repository: transaction.noteRepository,
          annotationRepository: transaction.contentAnnotationRepository,
          runTransaction: operation => operation(buildNoteTransactionContext(transaction)),
          validateSiblingNameConflict: assertSiblingNameAvailable
        });
        const root = await transaction.folderRepository.findById(folderId);
        const deletionPackage = root?.deletionPackage as Pick<
          import('./domain/folder.ts').FolderDeletionPackage,
          'id' | 'mode' | 'noteIds'
        > | null;
        if (!deletionPackage) throw conflictError('FOLDER_NOT_IN_TRASH', '文件夹不在回收站中');
        const folders = await txFolderService.restoreDeletedFolder(folderId);
        for (const noteId of deletionPackage.mode === 'with-content' ? deletionPackage.noteIds : []) {
          const note = await transaction.noteRepository.findById(noteId);
          if (note?.deleted && note.folderDeletionPackageId === deletionPackage.id)
            await txNoteService.restoreNote(noteId);
        }
        return { folders, deletionPackage };
      });
    },
    async deleteTagAndCleanup(tagId: string) {
      const tag = await tagRepository.findById(tagId);
      if (tag?.isSystem) throw conflictError('SYSTEM_TAG_PROTECTED', 'System tags cannot be deleted');
      await noteService.removeTagFromAllNotes(tagId);
      return tagService.deleteTag(tagId);
    },
    async mergeTags(sourceTagId: string, targetTagId: string) {
      const source = await tagRepository.findById(sourceTagId);
      const target = await tagRepository.findById(targetTagId);
      if (!source || !target) throw validationError('TAG_MERGE_TARGET_INVALID', 'Both tags must exist');
      if (source.isSystem) throw conflictError('SYSTEM_TAG_PROTECTED', 'System tags cannot be merged');
      await noteService.replaceTagInAllNotes(sourceTagId, targetTagId);
      await tagRepository.delete(sourceTagId);
      return target;
    }
  };
}
