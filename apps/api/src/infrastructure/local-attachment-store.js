import {
  inspectAttachmentFile,
  assertReadableStatus,
  throwFileHealth,
  prepareAttachmentRestore,
  assertSameAttachment,
  recoverAttachmentRestores
} from './attachment-recovery.ts';
import fs from 'node:fs';
import path from 'node:path';
import { createAppError } from '../errors/app-error.ts';
import { createLocalAttachmentFileManager } from './local-attachment-file-manager.ts';
import { createLocalAttachmentDeletionManager } from './local-attachment-deletion.ts';
import { createLocalAttachmentSnapshotStore } from './local-attachment-snapshot-store.ts';
import { ATTACHMENT_STATUS } from './attachment-status.ts';
import { createAttachmentCleanupQueue } from './attachment-cleanup-queue.ts';
import { reconcileAttachmentIntegrity } from './attachment-record-reconciliation.ts';
import { createLocalAttachmentUpload } from './local-attachment-upload.ts';
import { moveFileSafely, sanitizeFileName } from './local-attachment-store-utils.ts';

export function createLocalAttachmentStore({
  dataStore,
  uploadsDir = path.join('storage', 'uploads'),
  storageRootDir = process.cwd(),
  legacyUploadsDirs = []
}) {
  if (!dataStore) {
    throw new Error('Attachment store requires a data store');
  }

  const fileManager = createLocalAttachmentFileManager({
    uploadsDir,
    storageRootDir,
    legacyUploadsDirs
  });
  const cleanupQueue = createAttachmentCleanupQueue({ storageRootDir, fileManager });

  function flush() {
    dataStore.flush();
  }

  function reconcileStoredAttachments() {
    let changed = false;

    dataStore.state.attachments.forEach(attachment => {
      const recordReconciled = fileManager.reconcileAttachmentRecord(attachment);
      const readablePath = fileManager
        .getAttachmentCandidatePaths(attachment)
        .find(candidatePath => fs.existsSync(candidatePath));
      const integrityReconciled = reconcileAttachmentIntegrity(attachment, readablePath);
      if (recordReconciled || integrityReconciled) {
        changed = true;
      }
    });

    if (changed) {
      flush();
    }
  }

  reconcileStoredAttachments();

  /** @param {{noteId?: string}} query */
  function listAttachments({ noteId } = {}) {
    return dataStore.state.attachments
      .filter(attachment => (noteId ? attachment.noteId === noteId : true))
      .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime());
  }

  function getAttachment(attachmentId) {
    return dataStore.state.attachments.find(attachment => attachment.id === attachmentId) ?? null;
  }

  function requiredAttachment(id) {
    const attachment = getAttachment(id);
    if (!attachment) throw createAppError('ATTACHMENT_NOT_FOUND', '附件不存在。', 404);
    return attachment;
  }

  function verifyAttachment(id) {
    const attachment = requiredAttachment(id);
    const previous = { ...attachment };
    const { content, ...health } = inspectAttachmentFile(attachment, fileManager);
    if (attachment.status !== health.status || attachment.verifiedAt !== health.verifiedAt) {
      Object.assign(attachment, health);
      try {
        flush();
      } catch (error) {
        Object.assign(attachment, previous);
        throw error;
      }
    }
    return requiredAttachment(id);
  }

  function readAttachmentContent(id) {
    const attachment = requiredAttachment(id);
    assertReadableStatus(attachment);
    const health = inspectAttachmentFile(attachment, fileManager);
    if (health.status !== 'ready') {
      verifyAttachment(id);
      throwFileHealth(health.status);
    }
    return { attachment, content: health.content };
  }

  function restoreAttachment(id, body) {
    const original = { ...requiredAttachment(id) };
    const transaction = prepareAttachmentRestore(original, body, fileManager);
    try {
      assertSameAttachment(getAttachment(id), original);
      transaction.commit();
      const current = requiredAttachment(id);
      Object.assign(current, { status: 'ready', verifiedAt: new Date().toISOString() });
      try {
        flush();
      } catch (error) {
        Object.assign(current, original);
        throw error;
      }
      transaction.finalize();
      return requiredAttachment(id);
    } catch (error) {
      transaction.rollback();
      throw error;
    }
  }

  function renameAttachment(attachmentId, fileName) {
    const attachment = getAttachment(attachmentId);
    if (!attachment) {
      throw createAppError('ATTACHMENT_NOT_FOUND', 'Attachment not found', 404);
    }

    if (!String(fileName ?? '').trim()) {
      throw new Error('Attachment fileName is required');
    }

    const nextSafeName = sanitizeFileName(fileName);
    const currentReadablePath = fileManager.resolveReadableAttachmentPath(attachment);
    const nextAbsolutePath = fileManager.resolveManagedAbsolutePath(attachment.id, nextSafeName);
    const nextStoragePath = fileManager.buildStoragePath(attachment.id, nextSafeName);
    const previousFileName = attachment.fileName;
    const previousStoragePath = attachment.storagePath;
    const previousSize = attachment.size;
    const previousSha256 = attachment.sha256 ?? null;
    const previousStatus = attachment.status ?? ATTACHMENT_STATUS.READY;
    const previousVerifiedAt = attachment.verifiedAt ?? null;
    const fileMoved = Boolean(
      currentReadablePath && path.normalize(currentReadablePath) !== path.normalize(nextAbsolutePath)
    );

    if (fileMoved) {
      moveFileSafely(currentReadablePath, nextAbsolutePath);
    }

    attachment.fileName = nextSafeName;
    attachment.storagePath = nextStoragePath;
    if (!attachment.sha256 && fs.existsSync(nextAbsolutePath)) {
      attachment.size = fs.statSync(nextAbsolutePath).size;
    }
    reconcileAttachmentIntegrity(attachment, nextAbsolutePath);
    try {
      flush();
    } catch (error) {
      attachment.fileName = previousFileName;
      attachment.storagePath = previousStoragePath;
      attachment.size = previousSize;
      attachment.sha256 = previousSha256;
      attachment.status = previousStatus;
      attachment.verifiedAt = previousVerifiedAt;
      if (fileMoved && fs.existsSync(nextAbsolutePath)) {
        try {
          moveFileSafely(nextAbsolutePath, currentReadablePath);
        } catch (rollbackError) {
          error.rollbackError = rollbackError;
        }
      }
      throw error;
    }
    return attachment;
  }

  const snapshotStore = createLocalAttachmentSnapshotStore({
    dataStore,
    flush,
    fileManager,
    listAttachments
  });
  const deletionManager = createLocalAttachmentDeletionManager({
    dataStore,
    fileManager,
    flush,
    cleanupQueue
  });
  void recoverAttachmentRestores(fileManager, getAttachment, verifyAttachment);
  void cleanupQueue.retry(id => Boolean(getAttachment(id)));

  return {
    uploadAttachment: createLocalAttachmentUpload({
      dataStore,
      fileManager,
      flush
    }),
    listAttachments,
    getAttachment,
    readAttachmentContent,
    verifyAttachment,
    restoreAttachment,
    renameAttachment,
    ...deletionManager,
    listAttachmentCleanup: () => cleanupQueue.list(id => Boolean(getAttachment(id))),
    retryAttachmentCleanup: () => cleanupQueue.retry(id => Boolean(getAttachment(id))),
    ...snapshotStore
  };
}
