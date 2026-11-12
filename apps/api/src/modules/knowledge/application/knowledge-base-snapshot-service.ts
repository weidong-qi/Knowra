import { createAppError } from '../../../errors/app-error.ts';
import {
  LOCAL_DATA_SCHEMA_VERSION,
  LOCAL_SNAPSHOT_VERSION,
  createEmptyLocalState
} from '../../../infrastructure/local-data-schema.js';
import { assertNoInsecureImageUrls } from './note-content-policy.ts';
import { assertSpacesOwnedBy } from '../../../infrastructure/owner-boundary.ts';

import type { createLocalAttachmentStore } from '../../../infrastructure/local-attachment-store.ts';
import type { AttachmentRestoreBody } from '../../../infrastructure/local-attachment-types.ts';
import type { LocalAttachmentUploadInput } from '../../../infrastructure/local-attachment-upload.ts';
import type { createFileDataStore } from '../../../infrastructure/file-data-store.js';

type AttachmentStore = Pick<
  ReturnType<typeof createLocalAttachmentStore>,
  | 'verifyAttachment'
  | 'restoreAttachment'
  | 'listAttachmentCleanup'
  | 'exportAttachmentsSnapshot'
  | 'prepareAttachmentsSnapshot'
  | 'uploadAttachment'
  | 'renameAttachment'
  | 'listAttachments'
  | 'readAttachmentContent'
  | 'deleteAttachment'
  | 'inspectAttachmentDeletion'
  | 'retryAttachmentCleanup'
>;
type SnapshotStore = Pick<ReturnType<typeof createFileDataStore>, 'exportSnapshot' | 'prepareImport' | 'commitImport'>;
/** 旧 JS 快照校验器完成结构/引用检查，声明本服务实际读取的集合字段。 */
interface PreparedSnapshot {
  schemaVersion: number;
  data: {
    spaces: import('../../../infrastructure/owner-boundary.ts').OwnerBoundarySpace[];
    notes: { id: string; rawMarkdown?: unknown }[];
    attachments: AttachmentImport['records'];
  };
}
type AttachmentImport = ReturnType<AttachmentStore['prepareAttachmentsSnapshot']>;
interface SnapshotServiceDependencies {
  dataStore?: SnapshotStore | null;
  attachmentStore?: AttachmentStore | null;
  ownerId?: string;
  validateAttachmentNote?: ((noteId: string | undefined) => void) | null;
}
interface AttachmentParams {
  id: string;
}
/** 原始导入请求尚未校验，附件字段继续交给快照校验器。 */
interface SnapshotImportBody {
  attachmentFiles?: { length?: unknown } | null;
}

export function createKnowledgeBaseSnapshotService({
  dataStore,
  attachmentStore,
  ownerId = 'demo',
  validateAttachmentNote = null
}: SnapshotServiceDependencies) {
  return {
    exportKnowledgeBase,
    importKnowledgeBase,
    uploadAttachment,
    updateAttachment,
    listAttachments,
    getAttachmentContent,
    inspectAttachmentDeletion,
    deleteAttachment,
    retryAttachmentCleanup,
    verifyAttachment: (params: AttachmentParams) => {
      requireAttachmentStore();
      return attachmentStore!.verifyAttachment(params.id);
    },
    restoreAttachment: (params: AttachmentParams, body: AttachmentRestoreBody) => {
      requireAttachmentStore();
      return attachmentStore!.restoreAttachment(params.id, body);
    },
    listAttachmentCleanup: () => {
      requireAttachmentStore();
      return attachmentStore!.listAttachmentCleanup();
    }
  };

  function exportKnowledgeBase() {
    const snapshot = dataStore?.exportSnapshot?.() ?? {
      exportedAt: new Date().toISOString(),
      version: LOCAL_SNAPSHOT_VERSION,
      schemaVersion: LOCAL_DATA_SCHEMA_VERSION,
      data: createEmptyLocalState()
    };

    return {
      ...snapshot,
      attachmentFiles: attachmentStore?.exportAttachmentsSnapshot?.() ?? []
    };
  }

  function importKnowledgeBase(body: SnapshotImportBody) {
    if (!dataStore) {
      throw createAppError('STORAGE_NOT_CONFIGURED', 'Persistent storage is not configured', 503);
    }

    const preparedSnapshot = dataStore.prepareImport(body) as unknown as PreparedSnapshot;
    assertSpacesOwnedBy(preparedSnapshot.data.spaces, ownerId);
    validateImportedNoteContent(preparedSnapshot.data.notes);
    const attachmentTransaction = prepareAttachmentImport(body, preparedSnapshot);

    try {
      attachmentTransaction?.commit();
      if (attachmentTransaction) {
        preparedSnapshot.data.attachments = structuredClone(attachmentTransaction.records);
      }
      dataStore.commitImport(preparedSnapshot);
      attachmentTransaction?.finalize();
    } catch (error) {
      rollbackAttachments(attachmentTransaction, error);
      throw error;
    }

    return exportKnowledgeBase();
  }

  function prepareAttachmentImport(body: SnapshotImportBody, preparedSnapshot: PreparedSnapshot) {
    const attachmentFiles = body?.attachmentFiles ?? [];
    if (!attachmentStore?.prepareAttachmentsSnapshot) {
      if (preparedSnapshot.data.attachments.length > 0 || (attachmentFiles.length as number) > 0) {
        throw createAppError('ATTACHMENT_STORAGE_NOT_CONFIGURED', 'Attachment storage is not configured', 503);
      }
      return null;
    }

    return attachmentStore.prepareAttachmentsSnapshot(attachmentFiles, {
      expectedMetadata: preparedSnapshot.data.attachments,
      noteIds: new Set(preparedSnapshot.data.notes.map((note: { id: string }) => note.id))
    });
  }

  function uploadAttachment(body: LocalAttachmentUploadInput) {
    requireAttachmentStore();
    validateAttachmentNote?.(body?.noteId);
    return attachmentStore!.uploadAttachment(body);
  }

  function updateAttachment(params: AttachmentParams, body: { fileName?: string }) {
    requireAttachmentStore();
    return attachmentStore!.renameAttachment(params.id, body?.fileName);
  }

  function listAttachments(query: { noteId?: string } = {}) {
    return attachmentStore?.listAttachments(query) ?? [];
  }

  function getAttachmentContent(params: AttachmentParams) {
    requireAttachmentStore();
    return attachmentStore!.readAttachmentContent(params.id);
  }

  function deleteAttachment(params: AttachmentParams) {
    requireAttachmentStore();
    return attachmentStore!.deleteAttachment(params.id);
  }

  function inspectAttachmentDeletion(params: AttachmentParams) {
    requireAttachmentStore();
    return attachmentStore!.inspectAttachmentDeletion(params.id);
  }

  function retryAttachmentCleanup() {
    requireAttachmentStore();
    return attachmentStore!.retryAttachmentCleanup();
  }

  function requireAttachmentStore() {
    if (!attachmentStore) {
      throw createAppError('ATTACHMENT_STORAGE_NOT_CONFIGURED', 'Attachment storage is not configured', 503);
    }
  }
}

function validateImportedNoteContent(notes: { rawMarkdown?: unknown }[]) {
  for (const note of notes) {
    assertNoInsecureImageUrls(note.rawMarkdown);
  }
}

function rollbackAttachments(transaction: AttachmentImport | null, originalError: unknown) {
  if (!transaction) {
    return;
  }
  try {
    transaction.rollback();
  } catch (rollbackError) {
    throw createAppError(
      'STORAGE_IMPORT_ROLLBACK_FAILED',
      'Storage import failed and attachment rollback was incomplete',
      500,
      { cause: rollbackError ?? originalError }
    );
  }
}
