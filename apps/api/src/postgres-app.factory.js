import { buildNoteData, mapNote } from './modules/knowledge/infrastructure/postgres/mappers.ts';
import { buildJsonMigrationPlan, applyJsonMigration } from './infrastructure/migration/json-to-postgres.ts';
import { createPdfService } from './modules/pdf/service.ts';
import { createTaskWorkspaceService } from './modules/task-workspaces/service.ts';
import { createPostgresPurgeTaskReader } from './infrastructure/asset-purge-task-state.ts';
import { createPostgresActionStore } from './modules/ai/postgres-action-store.ts';
import { createAttachmentTransfer } from './modules/sync/attachment-transfer.ts';
import { createPostgresCoreOperationStore } from './infrastructure/postgres-core-operation-store.ts';
import path from 'node:path';
import { createPostgresSyncRuntime, readPostgresPdfSnapshot } from './modules/sync/postgres-provider.ts';
import { createPersonalTodoService } from './modules/personal-todos/service.ts';
import { createPostgresTodoStore } from './modules/personal-todos/postgres-store.ts';
import { createPrismaRuntime } from './infrastructure/prisma-client.js';
import { createPostgresAttachmentStore } from './infrastructure/postgres-attachment-store.ts';
import { loadPostgresAttachmentReferenceState } from './infrastructure/attachment-deletion-preflight.ts';
import { createPostgresSnapshotService } from './infrastructure/postgres-snapshot-service.ts';
import { createPostgresKnowledgeModule } from './modules/knowledge/postgres-async-module.js';
import { createPostgresKnowledgeHttpHandlers } from './modules/knowledge/http/postgres-async-handlers.ts';
import { createPostgresNoteRepository } from './modules/knowledge/infrastructure/postgres/note-repository.ts';
import { createPostgresPdfAnnotationRepository } from './modules/pdf/repository.ts';
import { createPostgresFolderRepository } from './modules/knowledge/infrastructure/postgres/folder-repository.ts';
import { createPostgresTagRepository } from './modules/knowledge/infrastructure/postgres/tag-repository.ts';
import { createPostgresTagGroupRepository } from './modules/knowledge/infrastructure/postgres/tag-group-repository.ts';
import { createPostgresKnowledgeSpaceRepository } from './modules/knowledge/infrastructure/postgres/knowledge-space-repository.ts';
import { createPostgresContentAnnotationRepository } from './modules/knowledge/infrastructure/postgres/content-annotation-repository.ts';
import { createPostgresAttachmentRepository } from './modules/knowledge/infrastructure/postgres/attachment-repository.ts';
import { createPostgresNoteVersionRepository } from './modules/knowledge/infrastructure/postgres/note-version-repository.ts';
import { createPostgresKnowledgeItemRepository } from './modules/knowledge/infrastructure/postgres/knowledge-item-repository.ts';
import { createPostgresKnowledgeEvidenceRepository } from './modules/knowledge/infrastructure/postgres/knowledge-evidence-repository.ts';
import { createPostgresKnowledgeArtifactProvenanceRepository } from './modules/knowledge/infrastructure/postgres/knowledge-artifact-provenance-repository.ts';
import { migratePostgresKnowledgeArtifactProvenance } from './infrastructure/migration/postgres-knowledge-artifact-provenance.ts';
import { createPostgresLearningObjectiveRepository } from './modules/knowledge/infrastructure/postgres/learning-objective-repository.ts';
import { createPostgresExamProfileRepository } from './modules/knowledge/infrastructure/postgres/exam-profile-repository.ts';
import { createPostgresExamFocusRepository } from './modules/knowledge/infrastructure/postgres/exam-focus-repository.ts';
import { createPostgresQuestionRepository } from './modules/knowledge/infrastructure/postgres/question-repository.ts';
import { createPostgresQuestionObjectiveRepository } from './modules/knowledge/infrastructure/postgres/question-objective-repository.ts';
import { createPostgresQuestionSourceRepository } from './modules/knowledge/infrastructure/postgres/question-source-repository.ts';
import {
  createPostgresAnalysisScopeRepository,
  createPostgresAnnotationExclusionRepository,
  createPostgresAnnotationRevisionRepository
} from './modules/knowledge/infrastructure/postgres/annotation-support-repositories.ts';
import { createAsyncNoteDeletionCoordinator } from './modules/knowledge/application/postgres-async/note-deletion-coordinator.ts';
import { withPostgresErrors } from './infrastructure/postgres-errors.ts';
import { notFoundError } from './modules/knowledge/application/knowledge-errors.ts';
import { assertPostgresOwnerBoundary } from './infrastructure/owner-boundary.ts';
import { createMaintenanceGate, wrapHandlersWithMaintenanceGate } from './infrastructure/maintenance-gate.ts';
import {
  createPostgresAdvisoryLock,
  wrapHandlersWithPostgresAdvisoryLock
} from './infrastructure/postgres-advisory-lock.ts';
import { createModelSettingsService } from './modules/ai/model-settings.ts';
import { createOptionalAiRuntime } from './modules/ai/runtime.js';
import { createAiFeatureSettings } from './modules/ai/feature-settings.ts';
import { aiRuntimeLifecycle } from './modules/ai/runtime-lifecycle.ts';
import { reviewedDeepSeekPriceProfile } from './modules/ai/reviewed-price-profile.ts';
import { createPostgresAiRepository } from './modules/ai/postgres-record-repository.ts';
import { createKnowledgeExtractionCommitService } from './modules/ai/knowledge-extraction-commit.ts';
import { createKnowledgeExtractionTaskService } from './modules/ai/knowledge-extraction-task-service.ts';
import { createPostgresKnowledgeExtractionTaskStore } from './modules/ai/postgres-knowledge-extraction-task-store.ts';
import {
  createPostgresKnowledgeExtractionCommitStore,
  createPostgresKnowledgeExtractionContext
} from './modules/ai/postgres-knowledge-extraction-commit-store.ts';
import { createPostgresAiAccessStore } from './modules/ai/postgres-access-store.ts';
import { createPostgresAiConversationStore } from './modules/ai/postgres-conversation-store.ts';
import { createPostgresBudgetAuthority } from './modules/ai/postgres-budget-authority.ts';

export async function createPostgresAppContext({
  databaseUrl = process.env.DATABASE_URL,
  client = null,
  storageRootDir = process.cwd(),
  uploadsDir = path.join(storageRootDir, process.env.STORAGE_UPLOADS_DIR || 'storage/uploads'),
  legacyUploadsDirs = [],
  ownerId = process.env.KNOWRA_OWNER_ID || 'demo',
  knowledgeExtractionMock = null
} = {}) {
  const runtime = await createPrismaRuntime({ databaseUrl, client });
  await runtime.connect();
  let db = runtime.client;
  const normalizedOwnerId = String(ownerId).trim() || 'demo';
  try {
    await assertPostgresOwnerBoundary(db, normalizedOwnerId);
    await ensureOwner(db, normalizedOwnerId);
  } catch (error) {
    await runtime.disconnect();
    throw error;
  }
  const syncRuntime = createPostgresSyncRuntime(db, normalizedOwnerId);
  db = syncRuntime.client;
  const maintenanceGate = createMaintenanceGate();
  try {
    await maintenanceGate.runMaintenance(() => migratePostgresKnowledgeArtifactProvenance(db, normalizedOwnerId));
  } catch (error) {
    await runtime.disconnect();
    throw error;
  }
  const advisoryLock = createPostgresAdvisoryLock(db);
  const aiBudget = createPostgresBudgetAuthority(db);

  const repositories = {
    pdfAnnotationRepository: createPostgresPdfAnnotationRepository({ db }),
    noteRepository: createPostgresNoteRepository({ db }),
    folderRepository: createPostgresFolderRepository({ db }),
    tagRepository: createPostgresTagRepository({ db }),
    tagGroupRepository: createPostgresTagGroupRepository({ db }),
    knowledgeSpaceRepository: createPostgresKnowledgeSpaceRepository({ db }),
    contentAnnotationRepository: createPostgresContentAnnotationRepository({ db }),
    annotationExclusionRepository: createPostgresAnnotationExclusionRepository({ db }),
    annotationRevisionRepository: createPostgresAnnotationRevisionRepository({ db }),
    analysisScopeRepository: createPostgresAnalysisScopeRepository({ db }),
    attachmentRepository: createPostgresAttachmentRepository({ db }),
    noteVersionRepository: createPostgresNoteVersionRepository({ db }),
    knowledgeItemRepository: createPostgresKnowledgeItemRepository({ db }),
    knowledgeEvidenceRepository: createPostgresKnowledgeEvidenceRepository({ db }),
    knowledgeArtifactProvenanceRepository: createPostgresKnowledgeArtifactProvenanceRepository({ db }),
    learningObjectiveRepository: createPostgresLearningObjectiveRepository({ db }),
    examProfileRepository: createPostgresExamProfileRepository({ db }),
    examFocusRepository: createPostgresExamFocusRepository({ db }),
    questionRepository: createPostgresQuestionRepository({ db }),
    questionObjectiveRepository: createPostgresQuestionObjectiveRepository({ db }),
    questionSourceRepository: createPostgresQuestionSourceRepository({ db })
  };
  const knowledge = createPostgresKnowledgeModule({
    ...repositories,
    client: db,
    readPurgeTaskState: createPostgresPurgeTaskReader(db, normalizedOwnerId),
    getPurgeDatasetEpoch: async () =>
      (await db.syncJournal.findUnique({ where: { ownerId: normalizedOwnerId } }))?.payload?.epoch,
    getPurgeTombstone: async (collection, id) => {
      const journal = await db.syncJournal.findUnique({ where: { ownerId: normalizedOwnerId } });
      return journal?.payload?.tombstones?.[JSON.stringify([collection, id])] ?? null;
    }
  });
  const attachmentStore = createPostgresAttachmentStore({
    attachmentRepository: repositories.attachmentRepository,
    uploadsDir,
    storageRootDir,
    legacyUploadsDirs,
    loadReferenceState: () => loadPostgresAttachmentReferenceState(db),
    runTransaction: operation => db.$transaction(operation),
    validateAttachmentNote: async noteId => {
      const note = await repositories.noteRepository.findById(noteId);
      if (!note || note.deleted) throw notFoundError('NOTE_NOT_FOUND', 'Note not found');
      const space = await repositories.knowledgeSpaceRepository.findById(note.spaceId);
      if (!space || space.userId !== normalizedOwnerId) {
        throw notFoundError('NOTE_NOT_FOUND', 'Note not found');
      }
    }
  });
  await attachmentStore.recoverAttachmentRestores();
  await attachmentStore.retryAttachmentCleanup();
  const noteDeletionCoordinator = createAsyncNoteDeletionCoordinator({
    noteService: knowledge.noteService,
    noteRepository: repositories.noteRepository,
    attachmentStore,
    runTransaction: operation => db.$transaction(operation)
  });

  const knowledgeHandlers = createPostgresKnowledgeHttpHandlers({
    knowledgeModule: knowledge,
    noteDeletionCoordinator,
    ownerId: normalizedOwnerId
  });

  const modelSettings = createModelSettingsService();
  const aiFeatures = createAiFeatureSettings({ filePath: path.join(storageRootDir, 'ai-features.json') });
  const aiRepository = createPostgresAiRepository({ client: db, ownerId: normalizedOwnerId });
  const aiAccessStore = createPostgresAiAccessStore({
    client: db,
    repository: aiRepository,
    ownerId: normalizedOwnerId
  });
  const aiConversationStore = createPostgresAiConversationStore({
    client: db,
    repository: aiRepository,
    ownerId: normalizedOwnerId
  });
  const ai = createOptionalAiRuntime({
    modelSettings,
    repository: aiRepository,
    accessStore: aiAccessStore,
    uploadsDir,
    balanceFile: path.join(storageRootDir, 'ai-balance.json'),
    budgetSettingsFile: path.join(storageRootDir, 'ai-budget-settings.json'),
    budgetAlertsFile: path.join(storageRootDir, 'ai-budget-alerts.json'),
    conversationStore: aiConversationStore,
    actionStore: createPostgresActionStore({ client: db, repository: aiRepository, ownerId: normalizedOwnerId }),
    coreOperationStore: createPostgresCoreOperationStore({ client: db, ownerId: normalizedOwnerId }),
    knowledge: { ...knowledge, repositories },
    asyncDomain: true,
    maintenanceGate,
    budgetAuthority: aiBudget,
    priceProfile: reviewedDeepSeekPriceProfile,
    allowExternal: process.env.KNOWRA_AI_EGRESS_ENABLED !== '0',
    knowledgeProposals: async () => (await aiFeatures.get()).knowledgeProposals,
    contextSources: {
      ...repositories,
      spaceRepository: repositories.knowledgeSpaceRepository,
      ownerId: normalizedOwnerId
    }
  });
  const extractionContext = tx => createPostgresKnowledgeExtractionContext(tx, normalizedOwnerId);
  const extractionReceipts = createPostgresKnowledgeExtractionCommitStore({ client: db, ownerId: normalizedOwnerId });
  const knowledgeExtractionCommit = createKnowledgeExtractionCommitService({
    ownerId: normalizedOwnerId,
    store: extractionReceipts,
    createContext: extractionContext,
    clock: knowledgeExtractionMock?.clock
  });
  const knowledgeExtractionTasks = knowledgeExtractionMock
    ? createKnowledgeExtractionTaskService({
        ...knowledgeExtractionMock,
        ownerId: normalizedOwnerId,
        maintenanceGate,
        createContext: extractionContext,
        commit: knowledgeExtractionCommit,
        receiptStore: extractionReceipts,
        store: createPostgresKnowledgeExtractionTaskStore({ client: db, ownerId: normalizedOwnerId })
      })
    : null;
  let closing;
  const context = {
    // V1 不把本地域隐式回退到 JSON，也不扩充 PostgreSQL 的普通笔记协议。
    taskWorkspaces: createTaskWorkspaceService({ store: null }),
    taskWorkspaceContext: () => ({ actor: { kind: 'user', id: normalizedOwnerId } }),
    personalTodos: createPersonalTodoService({ store: createPostgresTodoStore(db) }),
    knowledgeExtractionCommit,
    knowledgeExtractionTasks,
    driver: 'postgres',
    coreOperationStore: createPostgresCoreOperationStore({ client: db, ownerId: normalizedOwnerId }),
    prisma: db,
    close: () =>
      (closing ??= (async () => {
        const results = await Promise.allSettled([
          aiRuntimeLifecycle(context.ai).close(),
          context.knowledgeExtractionTasks?.close()
        ]);
        const failed = results.find(result => result.status === 'rejected');
        if (failed) throw failed.reason;
        await runtime.disconnect();
      })()),
    modules: { knowledge },
    ai,
    aiOwnerId: normalizedOwnerId,
    aiLocation: 'server',
    repositories,
    http: {
      pdf: createPdfService({
        postgres: {
          buildNoteData,
          mapNote,
          readSnapshot: readPostgresPdfSnapshot,
          buildMigrationPlan: buildJsonMigrationPlan,
          applyMigration: input => applyJsonMigration({ ...input, client: db })
        },
        db,
        knowledge,
        uploadsDir,
        storageRootDir,
        ownerId: normalizedOwnerId,
        maintenanceGate,
        beforeImport: () => aiRepository.rotateEpoch()
      }),
      modelSettings,
      aiFeatures,
      aiBudget,
      sync: wrapHandlersWithMaintenanceGate(
        syncRuntime.service(knowledge.noteService, createAttachmentTransfer({ uploadsDir, storageRootDir })),
        maintenanceGate,
        {
          getAccess: name =>
            ['push', 'pushBatch', 'uploadBlob', 'uploadBlobStream', 'bootstrap'].includes(name) ? 'mutation' : 'read'
        }
      ),
      storage: createPostgresSnapshotService({
        client: db,
        repositories,
        attachmentStore,
        storageRootDir,
        ownerId: normalizedOwnerId,
        maintenanceGate,
        aiRepository
      }),
      knowledge: wrapHandlersWithMaintenanceGate(
        wrapHandlersWithPostgresAdvisoryLock(knowledgeHandlers, advisoryLock),
        maintenanceGate
      )
    }
  };
  return context;
}

async function ensureOwner(db, ownerId) {
  await withPostgresErrors(() =>
    db.user.upsert({
      where: { id: ownerId },
      create: {
        id: ownerId,
        email: null,
        passwordHash: null,
        nickname: null,
        status: 'active'
      },
      update: { status: 'active' }
    })
  );
}
