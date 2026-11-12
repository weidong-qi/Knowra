import type { PostgresSnapshotOptions } from './postgres-storage-types.ts';
import type { AttachmentRestoreBody, AttachmentFileMetadata } from './local-attachment-types.ts';
import type { LocalAttachmentUploadInput } from './local-attachment-upload.ts';
/** 原始 JSON 导入体，快照校验器负责结构和引用验证。 */
interface SnapshotBody {
  attachmentFiles?: unknown;
}
interface SnapshotGate {
  runOperation<T>(operation: () => T | PromiseLike<T>): T | PromiseLike<T>;
  runMutation<T>(operation: () => T | PromiseLike<T>): T | PromiseLike<T>;
  runMaintenance<T>(operation: () => T | PromiseLike<T>): T | PromiseLike<T>;
}
interface PreparedSnapshotData {
  notes: { id: string; rawMarkdown?: unknown }[];
  attachments: AttachmentFileMetadata[];
}
import { createAppError } from '../errors/app-error.ts';
import { validateLocalSnapshot, LOCAL_DATA_SCHEMA_VERSION, LOCAL_SNAPSHOT_VERSION } from './local-data-schema.ts';
import { validateAttachmentSnapshotItems } from './local-attachment-snapshot-validator.ts';
import { stageAttachmentFiles, createAttachmentDirectorySwap } from './attachment-directory-swap.ts';
import { assertNoInsecureImageUrls } from '../modules/knowledge/application/note-content-policy.ts';
import { buildJsonMigrationPlan, applyJsonMigration } from './migration/json-to-postgres.ts';

export function createPostgresSnapshotService({
  client,
  repositories,
  attachmentStore,
  storageRootDir = process.cwd(),
  ownerId = 'demo',
  maintenanceGate = null,
  aiRepository = null
}: PostgresSnapshotOptions = {}) {
  if (!client?.$transaction) throw new TypeError('PostgreSQL snapshot service requires a Prisma client');
  if (!repositories?.noteRepository || !attachmentStore)
    throw new TypeError('PostgreSQL snapshot service dependencies are incomplete');

  const gate: SnapshotGate = maintenanceGate ?? {
    runOperation: operation => operation(),
    runMutation: operation => operation(),
    runMaintenance: operation => operation()
  };
  return {
    exportKnowledgeBase: () => gate.runMaintenance(exportKnowledgeBase),
    importKnowledgeBase: (body: SnapshotBody) => gate.runMaintenance(() => importKnowledgeBase(body)),
    uploadAttachment: (body: LocalAttachmentUploadInput) =>
      gate.runMutation(() => attachmentStore!.uploadAttachment(body)),
    updateAttachment: (params: { id: string }, body: { fileName?: string }) =>
      gate.runMutation(() => attachmentStore!.renameAttachment(params.id, body?.fileName)),
    listAttachments: (query: { noteId?: string }) => gate.runOperation(() => attachmentStore!.listAttachments(query)),
    getAttachmentContent: (params: { id: string }) =>
      gate.runOperation(() => attachmentStore!.readAttachmentContent(params.id)),
    inspectAttachmentDeletion: (params: { id: string }) =>
      gate.runOperation(() => attachmentStore!.inspectAttachmentDeletion(params.id)),
    deleteAttachment: (params: { id: string }) => gate.runMutation(() => attachmentStore!.deleteAttachment(params.id)),
    verifyAttachment: (params: { id: string }) => gate.runMutation(() => attachmentStore!.verifyAttachment(params.id)),
    restoreAttachment: (params: { id: string }, body: AttachmentRestoreBody) =>
      gate.runMutation(() => attachmentStore!.restoreAttachment(params.id, body)),
    listAttachmentCleanup: () => gate.runOperation(() => attachmentStore!.listAttachmentCleanup()),
    retryAttachmentCleanup: () => gate.runMutation(() => attachmentStore!.retryAttachmentCleanup())
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
      repositories!.knowledgeSpaceRepository.list(),
      repositories!.folderRepository.list(),
      repositories!.tagRepository.list(),
      repositories!.tagGroupRepository.list(),
      repositories!.noteRepository.list({ includeDeleted: true }),
      repositories!.noteVersionRepository.list(),
      repositories!.contentAnnotationRepository.list({ includeDeleted: true }),
      repositories!.knowledgeItemRepository.list({ includeArchived: true, includeDeleted: true }),
      repositories!.knowledgeEvidenceRepository.list(),
      repositories!.knowledgeArtifactProvenanceRepository.list(),
      repositories!.learningObjectiveRepository.list({ includeArchived: true }),
      repositories!.examProfileRepository.list({ includeArchived: true }),
      repositories!.examFocusRepository.list({ includeArchived: true }),
      repositories!.questionRepository.list({ includeArchived: true }),
      attachmentStore!.listAttachments(),
      attachmentStore!.exportAttachmentsSnapshot(),
      repositories!.annotationExclusionRepository?.list({ includeDeleted: true }) ?? [],
      repositories!.annotationRevisionRepository?.list() ?? [],
      repositories!.analysisScopeRepository?.list({ includeDeleted: true }) ?? []
    ]);
    const questionIds = questions.map(question => question.id);
    const [questionObjectives, questionSources] = await Promise.all([
      repositories!.questionObjectiveRepository.listByQuestionIds(questionIds),
      repositories!.questionSourceRepository.list()
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
        pdfAnnotations: (await client!.$transaction(async tx => tx.pdfAnnotation.findMany())).map(row => row.payload),
        annotationExclusions,
        annotationRevisions,
        analysisScopeSnapshots,
        ...(await client!.$transaction(async tx => ({
          knowledgeConcepts: (await tx.knowledgeConcept.findMany()).map(row => row.data),
          knowledgeConceptLinks: (await tx.knowledgeConceptLink.findMany()).map(row => row.data),
          knowledgeConceptRelations: (await tx.knowledgeConceptRelation.findMany()).map(row => row.data)
        })))
      },
      attachmentFiles
    };
  }

  async function importKnowledgeBase(body: SnapshotBody) {
    const prepared = validateLocalSnapshot(body) as unknown as { schemaVersion: number; data: PreparedSnapshotData };
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
        uploadsDir: attachmentStore!.fileManager.getManagedUploadsDirectory(),
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

  function prepareAttachmentSwap(body: SnapshotBody, data: PreparedSnapshotData) {
    const items = body?.attachmentFiles ?? [];
    const preparedItems = validateAttachmentSnapshotItems(items, attachmentStore!.fileManager, {
      expectedMetadata: data.attachments,
      noteIds: new Set(data.notes.map(note => note.id))
    });
    const stagingDirectory = stageAttachmentFiles({
      uploadsDirectory: attachmentStore!.fileManager.getManagedUploadsDirectory(),
      preparedItems
    });
    return createAttachmentDirectorySwap({
      uploadsDirectory: attachmentStore!.fileManager.getManagedUploadsDirectory(),
      stagingDirectory,
      records: preparedItems.map(({ content, storageFileName, ...record }) => record)
    });
  }
}

function rollbackImport(transaction: { rollback(): void } | undefined, originalError: unknown) {
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
