import { createPdfService } from './modules/pdf/service.ts';
import { createTaskWorkspaceService } from './modules/task-workspaces/service.ts';
import { createPersonalTodoService, createStateBackedTodoStore } from './modules/personal-todos/service.ts';
import { createTaskWorkspaceFiles } from './infrastructure/task-workspace-files.ts';
import { createLocalPurgeTaskReader } from './infrastructure/asset-purge-task-state.ts';
import { createAttachmentTransfer } from './modules/sync/attachment-transfer.ts';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createKnowledgeModule } from './modules/knowledge/index.js';
import { createKnowledgeExtractionCommitService } from './modules/ai/knowledge-extraction-commit.js';
import { createKnowledgeExtractionTaskService } from './modules/ai/knowledge-extraction-task-service.ts';
import { createKnowledgeHttpHandlers } from './modules/knowledge/http/knowledge-handlers.js';
import { createFileDataStore } from './infrastructure/file-data-store.js';
import { createLocalAttachmentStore } from './infrastructure/local-attachment-store.js';
import { createInMemoryNoteRepository } from './modules/knowledge/infrastructure/note-repository.js';
import { createInMemoryPdfAnnotationRepository } from './modules/pdf/repository.ts';
import { createInMemoryFolderRepository } from './modules/knowledge/infrastructure/folder-repository.ts';
import { createInMemoryTagRepository } from './modules/knowledge/infrastructure/tag-repository.ts';
import { createInMemoryTagGroupRepository } from './modules/knowledge/infrastructure/tag-group-repository.ts';
import { createInMemoryKnowledgeSpaceRepository } from './modules/knowledge/infrastructure/knowledge-space-repository.ts';
import { createInMemoryContentAnnotationRepository } from './modules/knowledge/infrastructure/content-annotation-repository.js';
import { createInMemoryNoteVersionRepository } from './modules/knowledge/infrastructure/note-version-repository.ts';
import { createInMemoryKnowledgeItemRepository } from './modules/knowledge/infrastructure/knowledge-item-repository.js';
import { createInMemoryKnowledgeEvidenceRepository } from './modules/knowledge/infrastructure/knowledge-evidence-repository.js';
import { createInMemoryKnowledgeArtifactProvenanceRepository } from './modules/knowledge/infrastructure/knowledge-artifact-provenance-repository.js';
import { createInMemoryLearningObjectiveRepository } from './modules/knowledge/infrastructure/learning-objective-repository.js';
import { createInMemoryExamProfileRepository } from './modules/knowledge/infrastructure/exam-profile-repository.js';
import { createInMemoryExamFocusRepository } from './modules/knowledge/infrastructure/exam-focus-repository.js';
import { createInMemoryQuestionRepository } from './modules/knowledge/infrastructure/question-repository.js';
import { createInMemoryQuestionObjectiveRepository } from './modules/knowledge/infrastructure/question-objective-repository.js';
import { createInMemoryQuestionSourceRepository } from './modules/knowledge/infrastructure/question-source-repository.js';
import {
  createInMemoryAnalysisScopeRepository,
  createInMemoryAnnotationExclusionRepository,
  createInMemoryAnnotationRevisionRepository
} from './modules/knowledge/infrastructure/annotation-support-repositories.js';
import { createKnowledgeBaseSnapshotService } from './modules/knowledge/application/knowledge-base-snapshot-service.js';
import { createNoteDeletionCoordinator } from './modules/knowledge/application/note-deletion-coordinator.js';
import { createStorageConfig } from './config/storage.config.js';
import { createLocalSyncService } from './modules/sync/local-provider.ts';
import { createModelSettingsService } from './modules/ai/model-settings.ts';
import { createAiFeatureSettings } from './modules/ai/feature-settings.ts';
import { createOptionalAiRuntime } from './modules/ai/runtime.js';
import { aiRuntimeLifecycle } from './modules/ai/runtime-lifecycle.ts';
import { reviewedDeepSeekPriceProfile } from './modules/ai/reviewed-price-profile.ts';
import { assertSpacesOwnedBy, resolveSingleOwnerId } from './infrastructure/owner-boundary.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const workspaceRoot = path.resolve(__dirname, '..', '..', '..');

export function createAppContext(options = {}) {
  const dataStore = options.dataStore;
  ensureDataCollections(dataStore, [
    'pdfAnnotations',
    'noteVersions',
    'knowledgeItems',
    'knowledgeEvidence',
    'knowledgeArtifactProvenance',
    'learningObjectives',
    'examProfiles',
    'examFocuses',
    'questions',
    'questionObjectives',
    'questionSources',
    'tagGroups',
    'annotationExclusions',
    'annotationRevisions',
    'analysisScopeSnapshots'
  ]);
  const ownerId = resolveOwnerId(options.ownerId, dataStore?.state?.spaces);
  const attachmentStore =
    options.attachmentStore ??
    (dataStore
      ? createLocalAttachmentStore({
          dataStore,
          uploadsDir: options.uploadsDir ?? resolveStoragePath('storage/uploads'),
          storageRootDir: options.storageRootDir ?? workspaceRoot,
          legacyUploadsDirs: options.legacyUploadsDirs
        })
      : null);

  const knowledge = createKnowledgeModule({
    pdfAnnotationRepository:
      options.pdfAnnotationRepository ??
      (dataStore
        ? createInMemoryPdfAnnotationRepository({ records: dataStore.state.pdfAnnotations, onChange: dataStore.flush })
        : undefined),
    noteRepository:
      options.noteRepository ??
      (dataStore
        ? createInMemoryNoteRepository({
            records: dataStore.state.notes,
            onChange: dataStore.flush
          })
        : undefined),
    folderRepository:
      options.folderRepository ??
      (dataStore
        ? createInMemoryFolderRepository({
            records: dataStore.state.folders,
            onChange: dataStore.flush
          })
        : undefined),
    tagRepository:
      options.tagRepository ??
      (dataStore
        ? createInMemoryTagRepository({
            records: dataStore.state.tags,
            onChange: dataStore.flush
          })
        : undefined),
    tagGroupRepository:
      options.tagGroupRepository ??
      (dataStore
        ? createInMemoryTagGroupRepository({ records: dataStore.state.tagGroups, onChange: dataStore.flush })
        : undefined),
    knowledgeSpaceRepository:
      options.knowledgeSpaceRepository ??
      (dataStore
        ? createInMemoryKnowledgeSpaceRepository({
            records: dataStore.state.spaces,
            onChange: dataStore.flush
          })
        : undefined),
    contentAnnotationRepository:
      options.contentAnnotationRepository ??
      (dataStore
        ? createInMemoryContentAnnotationRepository({
            records: dataStore.state.contentAnnotations,
            onChange: dataStore.flush
          })
        : undefined),
    annotationExclusionRepository:
      options.annotationExclusionRepository ??
      (dataStore
        ? createInMemoryAnnotationExclusionRepository({
            records: dataStore.state.annotationExclusions,
            onChange: dataStore.flush
          })
        : undefined),
    annotationRevisionRepository:
      options.annotationRevisionRepository ??
      (dataStore
        ? createInMemoryAnnotationRevisionRepository({
            records: dataStore.state.annotationRevisions,
            onChange: dataStore.flush
          })
        : undefined),
    analysisScopeRepository:
      options.analysisScopeRepository ??
      (dataStore
        ? createInMemoryAnalysisScopeRepository({
            records: dataStore.state.analysisScopeSnapshots,
            onChange: dataStore.flush
          })
        : undefined),
    noteVersionRepository:
      options.noteVersionRepository ??
      (dataStore
        ? createInMemoryNoteVersionRepository({
            records: dataStore.state.noteVersions,
            onChange: dataStore.flush,
            // 已删除的本机恢复副本仍按 ID 可读，但重新保存同正文必须使用新 ID。
            canReuse: version => !dataStore.deletionFacts?.has('noteVersions', version.id)
          })
        : undefined),
    knowledgeItemRepository:
      options.knowledgeItemRepository ??
      (dataStore
        ? createInMemoryKnowledgeItemRepository({ records: dataStore.state.knowledgeItems, onChange: dataStore.flush })
        : undefined),
    knowledgeEvidenceRepository:
      options.knowledgeEvidenceRepository ??
      (dataStore
        ? createInMemoryKnowledgeEvidenceRepository({
            records: dataStore.state.knowledgeEvidence,
            onChange: dataStore.flush
          })
        : undefined),
    knowledgeArtifactProvenanceRepository:
      options.knowledgeArtifactProvenanceRepository ??
      (dataStore
        ? createInMemoryKnowledgeArtifactProvenanceRepository({
            records: dataStore.state.knowledgeArtifactProvenance,
            onChange: dataStore.flush
          })
        : undefined),
    learningObjectiveRepository:
      options.learningObjectiveRepository ??
      (dataStore
        ? createInMemoryLearningObjectiveRepository({
            records: dataStore.state.learningObjectives,
            onChange: dataStore.flush
          })
        : undefined),
    examProfileRepository:
      options.examProfileRepository ??
      (dataStore
        ? createInMemoryExamProfileRepository({ records: dataStore.state.examProfiles, onChange: dataStore.flush })
        : undefined),
    examFocusRepository:
      options.examFocusRepository ??
      (dataStore
        ? createInMemoryExamFocusRepository({ records: dataStore.state.examFocuses, onChange: dataStore.flush })
        : undefined),
    questionRepository:
      options.questionRepository ??
      (dataStore
        ? createInMemoryQuestionRepository({ records: dataStore.state.questions, onChange: dataStore.flush })
        : undefined),
    questionObjectiveRepository:
      options.questionObjectiveRepository ??
      (dataStore
        ? createInMemoryQuestionObjectiveRepository({
            records: dataStore.state.questionObjectives,
            onChange: dataStore.flush
          })
        : undefined),
    questionSourceRepository:
      options.questionSourceRepository ??
      (dataStore
        ? createInMemoryQuestionSourceRepository({
            records: dataStore.state.questionSources,
            onChange: dataStore.flush
          })
        : undefined),
    runTransaction: dataStore?.runTransaction ? operation => dataStore.runTransaction(operation) : undefined,
    getPurgeTombstone: dataStore?.getSyncJournal
      ? (collection, id) => dataStore.getSyncJournal().tombstones?.[JSON.stringify([collection, id])] ?? null
      : undefined,
    readPurgeTaskState: createLocalPurgeTaskReader(dataStore),
    getPurgeDatasetEpoch: dataStore?.getSyncJournal ? () => dataStore.getSyncJournal().epoch : undefined,
    enforceReferences: options.enforceReferences ?? true,
    noteVersionCoalescing: options.noteVersionCoalescing
  });
  const noteDeletionCoordinator = createNoteDeletionCoordinator({
    noteService: knowledge.noteService,
    noteRepository: knowledge.repositories.noteRepository,
    noteVersionRepository: knowledge.repositories.noteVersionRepository,
    contentAnnotationRepository: knowledge.repositories.contentAnnotationRepository,
    annotationExclusionRepository: knowledge.repositories.annotationExclusionRepository,
    annotationRevisionRepository: knowledge.repositories.annotationRevisionRepository,
    attachmentStore,
    removePdfAnnotations: ids => {
      if (dataStore)
        for (let i = dataStore.state.pdfAnnotations.length - 1; i >= 0; i--)
          if (ids.includes(dataStore.state.pdfAnnotations[i].noteId)) dataStore.state.pdfAnnotations.splice(i, 1);
    },
    runTransaction: dataStore?.runTransaction ? operation => dataStore.runTransaction(operation) : undefined
  });

  const extractionContext = () => ({
    repositories: knowledge.repositories,
    knowledgeItemService: knowledge.knowledgeItemService,
    aiRepository: dataStore.aiRepository
  });
  const knowledgeExtractionCommit =
    dataStore?.knowledgeExtractionCommitStore && dataStore.aiRepository
      ? createKnowledgeExtractionCommitService({
          store: dataStore.knowledgeExtractionCommitStore,
          ownerId,
          createContext: extractionContext,
          clock: options.knowledgeExtractionMock?.clock
        })
      : null;
  const knowledgeExtractionTasks =
    options.knowledgeExtractionMock && knowledgeExtractionCommit && dataStore.knowledgeExtractionTaskStore
      ? createKnowledgeExtractionTaskService({
          ...options.knowledgeExtractionMock,
          ownerId,
          store: dataStore.knowledgeExtractionTaskStore,
          createContext: extractionContext,
          commit: knowledgeExtractionCommit,
          receiptStore: dataStore.knowledgeExtractionCommitStore
        })
      : null;
  const taskStore = dataStore?.taskWorkspaceStore ?? null;
  let taskFiles = options.taskWorkspaceFiles ?? null;
  if (taskStore && !taskFiles) {
    try {
      taskFiles = createTaskWorkspaceFiles({
        uploadsDirectory: options.uploadsDir ?? resolveStoragePath('storage/uploads')
      });
    } catch {
      /* 文件能力关闭不影响普通笔记或文字工作区。 */
    }
  }
  const taskWorkspaces = createTaskWorkspaceService({
    store: taskStore,
    files: taskFiles,
    authorize: options.authorizeTaskWorkspace ?? (ctx => ctx.actor?.kind === 'user' && ctx.actor.id === ownerId)
  });
  const taskWorkspaceContext = (request, response) => {
    const deadline = Date.now() + 30_000;
    return {
      actor: { kind: 'user', id: ownerId },
      ...(taskStore?.readSnapshot(tx => tx.identity()) ?? { datasetId: null, datasetEpoch: null }),
      guard: () => !request.aborted && !(response?.destroyed && !response.writableFinished) && Date.now() < deadline
    };
  };
  const personalTodos = createPersonalTodoService({
    store: dataStore?.state && dataStore.runTransaction ? createStateBackedTodoStore(dataStore) : null
  });
  return {
    taskWorkspaces,
    taskWorkspaceContext,
    personalTodos,
    knowledgeExtractionCommit,
    knowledgeExtractionTasks,
    dataStore,
    coreOperationStore: dataStore?.coreOperationStore ?? null,
    coreOperationStoreError: dataStore?.coreOperationStoreError ?? null,
    modules: {
      knowledge
    },
    http: {
      pdf: createPdfService({
        dataStore,
        knowledge,
        uploadsDir: options.uploadsDir ?? resolveStoragePath('storage/uploads'),
        storageRootDir: options.storageRootDir ?? workspaceRoot,
        ownerId
      }),
      sync: dataStore
        ? createLocalSyncService(
            dataStore,
            knowledge.noteService,
            ownerId,
            createAttachmentTransfer({
              uploadsDir: options.uploadsDir ?? resolveStoragePath('storage/uploads'),
              storageRootDir: options.storageRootDir ?? workspaceRoot
            })
          )
        : null,
      storage: createKnowledgeBaseSnapshotService({
        dataStore,
        attachmentStore,
        ownerId,
        validateAttachmentNote: dataStore ? noteId => knowledge.noteService.getNote(noteId) : null
      }),
      knowledge: createKnowledgeHttpHandlers({
        knowledgeModule: knowledge,
        noteDeletionCoordinator,
        ownerId
      })
    }
  };
}

/** @param {{storageRootDir?: string, dataFilePath?: string, uploadsDir?: string, persistenceDriver?: 'postgres' | 'local-json', databaseUrl?: string, client?: import('./infrastructure/postgres-transaction-port.ts').PostgresTransactionHost, ownerId?: string}} options */
export function createPersistentAppContext({
  storageRootDir = workspaceRoot,
  dataFilePath = resolveStoragePath('storage/data/knowledge-base.json', storageRootDir),
  uploadsDir = resolveStoragePath(process.env.STORAGE_UPLOADS_DIR || 'storage/uploads', storageRootDir),
  persistenceDriver = createStorageConfig(process.env).persistenceDriver,
  databaseUrl = createStorageConfig(process.env).databaseUrl,
  client = null,
  ownerId
} = {}) {
  if (persistenceDriver === 'postgres') {
    return createPostgresAppContext({
      databaseUrl,
      client,
      storageRootDir,
      uploadsDir,
      ownerId
    });
  }
  const dataStore = createFileDataStore(dataFilePath);
  const context = createAppContext({ dataStore, uploadsDir, storageRootDir, ownerId });
  context.http.modelSettings = createModelSettingsService();
  context.http.aiFeatures = createAiFeatureSettings({ filePath: path.join(storageRootDir, 'ai-features.json') });
  context.http.aiBudget = dataStore.aiBudgetAuthority;
  context.ai = createOptionalAiRuntime(
    {
      modelSettings: context.http.modelSettings,
      repository: dataStore.aiRepository,
      uploadsDir,
      balanceFile: path.join(storageRootDir, 'ai-balance.json'),
      budgetSettingsFile: path.join(storageRootDir, 'ai-budget-settings.json'),
      budgetAlertsFile: path.join(storageRootDir, 'ai-budget-alerts.json'),
      accessStore: dataStore.aiAccessStore,
      conversationStore: dataStore.aiConversationStore,
      actionStore: dataStore.aiActionStore,
      coreOperationStore: context.coreOperationStore,
      knowledge: context.modules.knowledge,
      budgetAuthority: dataStore.aiBudgetAuthority,
      priceProfile: reviewedDeepSeekPriceProfile,
      // 每个提炼回合开始时读取当前开关；关闭（默认）时模型拿不到 knowledge_propose。
      knowledgeProposals: async () => (await context.http.aiFeatures.get()).knowledgeProposals,
      allowExternal: process.env.KNOWRA_AI_EGRESS_ENABLED !== '0',
      contextSources: {
        ...context.modules.knowledge.repositories,
        ownerId: resolveOwnerId(ownerId, dataStore.state.spaces),
        spaceRepository: context.modules.knowledge.repositories.knowledgeSpaceRepository
      }
    },
    {
      enabled: !dataStore.aiRuntimeError && process.env.KNOWRA_AI_ENABLED !== '0',
      unavailableReason: dataStore.aiRuntimeError ? 'AI 私有存储无效，核心资料仍可使用。' : 'AI 功能已关闭。'
    }
  );
  context.aiOwnerId = resolveOwnerId(ownerId, dataStore.state.spaces);
  context.aiLocation = 'server';
  let closing;
  context.close = () =>
    (closing ??= (async () => {
      const results = await Promise.allSettled([
        aiRuntimeLifecycle(context.ai).close(),
        context.knowledgeExtractionTasks?.close()
      ]);
      const failed = results.find(result => result.status === 'rejected');
      if (failed) throw failed.reason;
    })());
  return context;
}

export function resolveStoragePath(targetPath, storageRootDir = workspaceRoot) {
  if (path.isAbsolute(targetPath)) {
    return targetPath;
  }

  return path.resolve(storageRootDir, targetPath);
}

function resolveOwnerId(value, spaces = []) {
  const configuredOwnerId = value ?? process.env.KNOWRA_OWNER_ID;
  const ownerId = resolveSingleOwnerId({
    configuredOwnerId,
    spaces,
    fallbackOwnerId: 'demo'
  });
  assertSpacesOwnedBy(spaces, ownerId);
  return ownerId;
}

function ensureDataCollections(dataStore, collectionNames) {
  if (!dataStore?.state) return;
  for (const collectionName of collectionNames) {
    if (!Array.isArray(dataStore.state[collectionName])) {
      dataStore.state[collectionName] = [];
    }
  }
}

async function createPostgresAppContext(options) {
  const { createPostgresAppContext: createContext } = await import('./postgres-app.factory.js');
  return createContext(options);
}

export { createPostgresAppContext };
