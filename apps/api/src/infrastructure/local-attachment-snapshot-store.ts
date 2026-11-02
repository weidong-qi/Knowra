import fs from 'node:fs';
import { createAppError } from '../errors/app-error.ts';
import { cloneValue } from './local-attachment-store-utils.ts';
import { createAttachmentDirectorySwap, stageAttachmentFiles } from './attachment-directory-swap.ts';
import { validateAttachmentSnapshotItems } from './local-attachment-snapshot-validator.ts';
import type { AttachmentFileManager, AttachmentFileMetadata } from './local-attachment-types.ts';
import type { AttachmentSnapshotValidationOptions } from './local-attachment-snapshot-validator.ts';

export interface LocalAttachmentSnapshotStoreDependencies {
  dataStore: { readonly state: { attachments: AttachmentFileMetadata[] } };
  flush(): void;
  fileManager: Pick<
    AttachmentFileManager,
    'resolveReadableAttachmentPath' | 'getManagedUploadsDirectory' | 'buildStoragePath'
  >;
  listAttachments(): (AttachmentFileMetadata & { id: string })[];
}

export function createLocalAttachmentSnapshotStore({
  dataStore,
  flush,
  fileManager,
  listAttachments
}: LocalAttachmentSnapshotStoreDependencies) {
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

  function prepareAttachmentsSnapshot(items: unknown = [], options: AttachmentSnapshotValidationOptions = {}) {
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

  function importAttachmentsSnapshot(items: unknown = []) {
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

  function replaceAttachments(records: AttachmentFileMetadata[]) {
    dataStore.state.attachments.splice(0, dataStore.state.attachments.length, ...cloneValue(records));
  }

  return {
    exportAttachmentsSnapshot,
    prepareAttachmentsSnapshot,
    importAttachmentsSnapshot
  };
}

function rollbackOrThrow(transaction: { rollback(): void }) {
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
