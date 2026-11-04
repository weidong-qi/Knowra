import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createAppError } from '../errors/app-error.ts';
import type { AttachmentOperationError } from './local-attachment-types.ts';

export interface StageAttachmentFilesOptions {
  uploadsDirectory: string;
  preparedItems: { storageFileName: string; content: Uint8Array }[];
}
export interface AttachmentDirectorySwapOptions<RecordType> {
  uploadsDirectory: string;
  stagingDirectory: string;
  records: RecordType[];
}
interface RestoreAfterCommitFailureOptions {
  uploadsDirectory: string;
  stagingDirectory: string;
  backupDirectory: string;
  error: AttachmentOperationError;
}

export function stageAttachmentFiles({ uploadsDirectory, preparedItems }: StageAttachmentFilesOptions) {
  const stagingDirectory = createStagingDirectory(uploadsDirectory);

  try {
    for (const item of preparedItems) {
      fs.writeFileSync(path.join(stagingDirectory, item.storageFileName), item.content);
    }
    return stagingDirectory;
  } catch (error) {
    cleanupDirectory(stagingDirectory);
    throw createAppError('STORAGE_ATTACHMENT_STAGE_FAILED', 'Failed to stage imported attachment files', 500, {
      cause: error
    });
  }
}

export function createAttachmentDirectorySwap<RecordType>({
  uploadsDirectory,
  stagingDirectory,
  records
}: AttachmentDirectorySwapOptions<RecordType>) {
  const backupDirectory = `${uploadsDirectory}.backup-${randomUUID()}`;
  let status = 'staged';

  return {
    records,
    commit() {
      if (status !== 'staged') {
        return;
      }
      try {
        fs.renameSync(uploadsDirectory, backupDirectory);
        fs.renameSync(stagingDirectory, uploadsDirectory);
        status = 'committed';
      } catch (error) {
        restoreAfterCommitFailure({
          uploadsDirectory,
          stagingDirectory,
          backupDirectory,
          error: error as AttachmentOperationError
        });
        status = 'failed';
        throw createAppError('STORAGE_ATTACHMENT_COMMIT_FAILED', 'Failed to replace attachment files', 500, {
          cause: error
        });
      }
    },
    rollback() {
      if (status === 'staged') {
        removeDirectory(stagingDirectory);
        status = 'rolled-back';
        return;
      }
      if (status !== 'committed') {
        return;
      }
      rollbackDirectorySwap(uploadsDirectory, backupDirectory);
      status = 'rolled-back';
    },
    finalize() {
      if (status === 'staged') {
        removeDirectory(stagingDirectory);
      } else if (status === 'committed') {
        cleanupBackup(backupDirectory);
      }
      status = 'finalized';
    }
  };
}

function createStagingDirectory(uploadsDirectory: string) {
  const parentDirectory = path.dirname(uploadsDirectory);
  const baseName = path.basename(uploadsDirectory);
  fs.mkdirSync(parentDirectory, { recursive: true });
  return fs.mkdtempSync(path.join(parentDirectory, `.${baseName}.import-`));
}

function restoreAfterCommitFailure({
  uploadsDirectory,
  stagingDirectory,
  backupDirectory,
  error
}: RestoreAfterCommitFailureOptions) {
  if (fs.existsSync(backupDirectory) && !fs.existsSync(uploadsDirectory)) {
    try {
      fs.renameSync(backupDirectory, uploadsDirectory);
    } catch (restoreError) {
      error.restoreError = restoreError as Error;
    }
  }
  cleanupDirectory(stagingDirectory);
}

function rollbackDirectorySwap(uploadsDirectory: string, backupDirectory: string) {
  const importedDirectory = `${uploadsDirectory}.failed-${randomUUID()}`;
  try {
    fs.renameSync(uploadsDirectory, importedDirectory);
    fs.renameSync(backupDirectory, uploadsDirectory);
  } catch (error) {
    restoreImportedDirectory(uploadsDirectory, importedDirectory);
    throw createAppError(
      'STORAGE_IMPORT_ROLLBACK_FAILED',
      'Failed to restore attachment files after import failure',
      500,
      { cause: error }
    );
  }
  cleanupDirectory(importedDirectory);
}

function restoreImportedDirectory(uploadsDirectory: string, importedDirectory: string) {
  if (!fs.existsSync(uploadsDirectory) && fs.existsSync(importedDirectory)) {
    fs.renameSync(importedDirectory, uploadsDirectory);
  }
}

function cleanupBackup(backupDirectory: string) {
  try {
    removeDirectory(backupDirectory);
  } catch (error) {
    console.error('Attachment import backup cleanup failed:', (error as AttachmentOperationError)?.message);
  }
}

function removeDirectory(directoryPath: string) {
  if (!fs.existsSync(directoryPath)) {
    return;
  }
  fs.rmSync(directoryPath, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 50
  });
}

function cleanupDirectory(directoryPath: string) {
  try {
    removeDirectory(directoryPath);
  } catch (error) {
    console.error(
      `Attachment directory cleanup failed for ${path.basename(directoryPath)}:`,
      (error as AttachmentOperationError)?.message
    );
  }
}
