import { createAppError } from '../errors/app-error.js';
import { validateLocalSnapshot, LOCAL_DATA_SCHEMA_VERSION, LOCAL_SNAPSHOT_VERSION } from './local-data-schema.js';
import { validateAttachmentSnapshotItems } from './local-attachment-snapshot-validator.ts';
import { stageAttachmentFiles, createAttachmentDirectorySwap } from './attachment-directory-swap.ts';
import { assertNoInsecureImageUrls } from '../modules/knowledge/application/note-content-policy.js';
import { buildJsonMigrationPlan, applyJsonMigration } from './migration/json-to-postgres.ts';

/** @param {import('./postgres-storage-types.ts').PostgresSnapshotOptions} options */
export function createPostgresSnapshotService({
  client,
  repositories,
  attachmentStore,
  storageRootDir = process.cwd(),
  ownerId = 'demo',
  maintenanceGate = null,
  aiRepository = null
} = {}) {
  if (!client?.$transaction) throw new TypeError('PostgreSQL snapshot service requires a Prisma client');
  if (!repositories?.noteRepository || !attachmentStore)
    throw new TypeError('PostgreSQL snapshot service dependencies are incomplete');

  const gate = maintenanceGate ?? {
    runOperation: operation => operation(),
    runMutation: operation => operation(),
    runMaintenance: operation => operation()
  };
  return {
    exportKnowledgeBase: () => gate.runMaintenance(exportKnowledgeBase),
    importKnowledgeBase: body => gate.runMaintenance(() => importKnowledgeBase(body)),
    uploadAttachment: body => gate.runMutation(() => attachmentStore.uploadAttachment(body)),
    updateAttachment: (params, body) =>
      gate.runMutation(() => attachmentStore.renameAttachment(params.id, body?.fileName)),
    listAttachments: query => gate.runOperation(() => attachmentStore.listAttachments(query)),
    getAttachmentContent: params => gate.runOperation(() => attachmentStore.readAttachmentContent(params.id)),
    inspectAttachmentDeletion: params => gate.runOperation(() => attachmentStore.inspectAttachmentDeletion(params.id)),
    deleteAttachment: params => gate.runMutation(() => attachmentStore.deleteAttachment(params.id)),
    verifyAttachment: params => gate.runMutation(() => attachmentStore.verifyAttachment(params.id)),
    restoreAttachment: (params, body) => gate.runMutation(() => attachmentStore.restoreAttachment(params.id, body)),
    listAttachmentCleanup: () => gate.runOperation(() => attachmentStore.listAttachmentCleanup()),
    retryAttachmentCleanup: () => gate.runMutation(() => attachmentStore.retryAttachmentCleanup())
  };

  async function exportKnowledgeBase() {
    const [
      spaces,
      folders,
      tags,
      tagGroups,
      notes,
      noteVersions,
      annotations,
      knowledgeItems,
      knowledgeEvidence,
      knowledgeArtifactProvenance,
      learningObjectives,
      examProfiles,
      examFocuses,
      questions,
      attachments,
      attachmentFiles,
      annotationExclusions,
      annotationRevisions,
      analysisScopeSnapshots
    ] = await Promise.all([
      repositories.knowledgeSpaceRepository.list(),
      repositories.folderRepository.list(),
      repositories.tagRepository.list(),
      repositories.tagGroupRepository.list(),
      repositories.noteRepository.list({ includeDeleted: true }),
      repositories.noteVersionRepository.list(),
      repositories.contentAnnotationRepository.list({ includeDeleted: true }),
      repositories.knowledgeItemRepository.list({ includeArchived: true, includeDeleted: true }),
      repositories.knowledgeEvidenceRepository.list(),
      repositories.knowledgeArtifactProvenanceRepository.list(),
      repositories.learningObjectiveRepository.list({ includeArchived: true }),
      repositories.examProfileRepository.list({ includeArchived: true }),
      repositories.examFocusRepository.list({ includeArchived: true }),
      repositories.questionRepository.list({ includeArchived: true }),
      attachmentStore.listAttachments(),
      attachmentStore.exportAttachmentsSnapshot(),
      repositories.annotationExclusionRepository?.list({ includeDeleted: true }) ?? [],
      repositories.annotationRevisionRepository?.list() ?? [],
      repositories.analysisScopeRepository?.list({ includeDeleted: true }) ?? []
    ]);
    const questionIds = questions.map(question => question.id);
    const [questionObjectives, questionSources] = await Promise.all([
      repositories.questionObjectiveRepository.listByQuestionIds(questionIds),
      repositories.questionSourceRepository.list()
    ]);
    return {
      exportedAt: new Date().toISOString(),
      version: LOCAL_SNAPSHOT_VERSION,
      schemaVersion: LOCAL_DATA_SCHEMA_VERSION,
      data: {
        spaces,
        folders,
        tags,
        tagGroups,
        notes,
        noteVersions,
        knowledgeItems,
        knowledgeEvidence,
        knowledgeArtifactProvenance,
        learningObjectives,
        examProfiles,
        examFocuses,
        questions,
        questionObjectives,
        questionSources,
        attachments,
        contentAnnotations: annotations,
        pdfAnnotations: (await client.$transaction(async tx => tx.pdfAnnotation.findMany())).map(row => row.payload),
        annotationExclusions,
        annotationRevisions,
        analysisScopeSnapshots
      },
      attachmentFiles
    };
  }

  async function importKnowledgeBase(body) {
    const prepared = validateLocalSnapshot(body);
    prepared.data.notes.forEach(note => assertNoInsecureImageUrls(note.rawMarkdown));
    const transaction = prepareAttachmentSwap(body, prepared.data);
    try {
      transaction.commit();
      const state = {
        ...prepared.data,
        attachments: transaction.records
      };
      const migration = buildJsonMigrationPlan({
        input: { schemaVersion: LOCAL_DATA_SCHEMA_VERSION, data: state },
        storageRootDir,
        uploadsDir: attachmentStore.fileManager.getManagedUploadsDirectory(),
        allowMissingAttachments: false,
        ownerId
      });
      if (!migration.canApply) {
        throw createAppError('STORAGE_IMPORT_INVALID', 'PostgreSQL import preflight did not pass', 422, {
          report: migration.report
        });
      }
      // 先作废旧 AI 领取权；若后续导入失败，保守失效优于让旧任务继续写入。
      await aiRepository?.rotateEpoch();
      await applyJsonMigration({
        client,
        plan: migration.plan,
        report: migration.report,
        requireEmptyTarget: false,
        replaceExisting: true
      });
      transaction.finalize();
    } catch (error) {
      rollbackImport(transaction, error);
      throw error;
    }
    return exportKnowledgeBase();
  }

  function prepareAttachmentSwap(body, data) {
    const items = body?.attachmentFiles ?? [];
    const preparedItems = validateAttachmentSnapshotItems(items, attachmentStore.fileManager, {
      expectedMetadata: data.attachments,
      noteIds: new Set(data.notes.map(note => note.id))
    });
    const stagingDirectory = stageAttachmentFiles({
      uploadsDirectory: attachmentStore.fileManager.getManagedUploadsDirectory(),
      preparedItems
    });
    return createAttachmentDirectorySwap({
      uploadsDirectory: attachmentStore.fileManager.getManagedUploadsDirectory(),
      stagingDirectory,
      records: preparedItems.map(({ content, storageFileName, ...record }) => record)
    });
  }
}

function rollbackImport(transaction, originalError) {
  try {
    transaction?.rollback();
  } catch (rollbackError) {
    throw createAppError(
      'STORAGE_IMPORT_ROLLBACK_FAILED',
      'PostgreSQL import failed and attachment rollback was incomplete',
      500,
      { cause: rollbackError ?? originalError }
    );
  }
}
