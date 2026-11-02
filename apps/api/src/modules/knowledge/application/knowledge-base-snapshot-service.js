import { createAppError } from '../../../errors/app-error.js';
import {
  LOCAL_DATA_SCHEMA_VERSION,
  LOCAL_SNAPSHOT_VERSION,
  createEmptyLocalState
} from '../../../infrastructure/local-data-schema.js';
import { assertNoInsecureImageUrls } from './note-content-policy.js';
import { assertSpacesOwnedBy } from '../../../infrastructure/owner-boundary.ts';

export function createKnowledgeBaseSnapshotService({
  dataStore,
  attachmentStore,
  ownerId = 'demo',
  validateAttachmentNote = null
}) {
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
    verifyAttachment: params => {
      requireAttachmentStore();
      return attachmentStore.verifyAttachment(params.id);
    },
    restoreAttachment: (params, body) => {
      requireAttachmentStore();
      return attachmentStore.restoreAttachment(params.id, body);
    },
    listAttachmentCleanup: () => {
      requireAttachmentStore();
      return attachmentStore.listAttachmentCleanup();
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

  function importKnowledgeBase(body) {
    if (!dataStore) {
      throw createAppError('STORAGE_NOT_CONFIGURED', 'Persistent storage is not configured', 503);
    }

    const preparedSnapshot = dataStore.prepareImport(body);
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

  function prepareAttachmentImport(body, preparedSnapshot) {
    const attachmentFiles = body?.attachmentFiles ?? [];
    if (!attachmentStore?.prepareAttachmentsSnapshot) {
      if (preparedSnapshot.data.attachments.length > 0 || attachmentFiles.length > 0) {
        throw createAppError('ATTACHMENT_STORAGE_NOT_CONFIGURED', 'Attachment storage is not configured', 503);
      }
      return null;
    }

    return attachmentStore.prepareAttachmentsSnapshot(attachmentFiles, {
      expectedMetadata: preparedSnapshot.data.attachments,
      noteIds: new Set(preparedSnapshot.data.notes.map(note => note.id))
    });
  }

  function uploadAttachment(body) {
    requireAttachmentStore();
    validateAttachmentNote?.(body?.noteId);
    return attachmentStore.uploadAttachment(body);
  }

  function updateAttachment(params, body) {
    requireAttachmentStore();
    return attachmentStore.renameAttachment(params.id, body?.fileName);
  }

  function listAttachments(query = {}) {
    return attachmentStore?.listAttachments(query) ?? [];
  }

  function getAttachmentContent(params) {
    requireAttachmentStore();
    return attachmentStore.readAttachmentContent(params.id);
  }

  function deleteAttachment(params) {
    requireAttachmentStore();
    return attachmentStore.deleteAttachment(params.id);
  }

  function inspectAttachmentDeletion(params) {
    requireAttachmentStore();
    return attachmentStore.inspectAttachmentDeletion(params.id);
  }

  function retryAttachmentCleanup() {
    requireAttachmentStore();
    return attachmentStore.retryAttachmentCleanup();
  }

  function requireAttachmentStore() {
    if (!attachmentStore) {
      throw createAppError('ATTACHMENT_STORAGE_NOT_CONFIGURED', 'Attachment storage is not configured', 503);
    }
  }
}

function validateImportedNoteContent(notes) {
  for (const note of notes) {
    assertNoInsecureImageUrls(note.rawMarkdown);
  }
}

function rollbackAttachments(transaction, originalError) {
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
