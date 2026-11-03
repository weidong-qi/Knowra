import fs from 'node:fs';
import { createAppError } from '../errors/app-error.js';
import { cloneValue } from './local-attachment-store-utils.ts';
import { createAttachmentDirectorySwap, stageAttachmentFiles } from './attachment-directory-swap.ts';
import { validateAttachmentSnapshotItems } from './local-attachment-snapshot-validator.js';

export function createLocalAttachmentSnapshotStore({ dataStore, flush, fileManager, listAttachments }) {
  function exportAttachmentsSnapshot() {
    return listAttachments().map(attachment => {
      const readablePath = fileManager.resolveReadableAttachmentPath(attachment);
      if (!readablePath) {
        throw createAppError('ATTACHMENT_FILE_MISSING', `Attachment file missing: ${attachment.id}`, 404);
      }

      return {
        ...cloneValue(attachment),
        contentBase64: fs.readFileSync(readablePath).toString('base64')
      };
    });
  }

  function prepareAttachmentsSnapshot(items = [], options = {}) {
    const preparedItems = validateAttachmentSnapshotItems(items, fileManager, options);
    const uploadsDirectory = fileManager.getManagedUploadsDirectory();
    const stagingDirectory = stageAttachmentFiles({
      uploadsDirectory,
      preparedItems
    });

    return createAttachmentDirectorySwap({
      uploadsDirectory,
      stagingDirectory,
      records: preparedItems.map(({ content, storageFileName, ...record }) => record)
    });
  }

  function importAttachmentsSnapshot(items = []) {
    const previousRecords = cloneValue(dataStore.state.attachments);
    const transaction = prepareAttachmentsSnapshot(items);

    try {
      transaction.commit();
      replaceAttachments(transaction.records);
      flush();
      transaction.finalize();
      return transaction.records;
    } catch (error) {
      replaceAttachments(previousRecords);
      rollbackOrThrow(transaction);
      throw error;
    }
  }

  function replaceAttachments(records) {
    dataStore.state.attachments.splice(0, dataStore.state.attachments.length, ...cloneValue(records));
  }

  return {
    exportAttachmentsSnapshot,
    prepareAttachmentsSnapshot,
    importAttachmentsSnapshot
  };
}

function rollbackOrThrow(transaction) {
  try {
    transaction.rollback();
  } catch (rollbackError) {
    throw createAppError(
      'STORAGE_IMPORT_ROLLBACK_FAILED',
      'Storage import failed and attachment rollback was incomplete',
      500,
      { cause: rollbackError }
    );
  }
}
