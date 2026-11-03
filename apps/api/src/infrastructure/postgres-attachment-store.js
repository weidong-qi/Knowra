import {
  inspectAttachmentFile,
  assertReadableStatus,
  throwFileHealth,
  prepareAttachmentRestore,
  assertSameAttachment,
  recoverAttachmentRestores
} from './attachment-recovery.js';
import { decodeAttachmentBytes } from './attachment-recovery.js';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { createAppError } from '../errors/app-error.js';
import { createLocalAttachmentFileManager } from './local-attachment-file-manager.js';
import { ATTACHMENT_STATUS } from './attachment-status.ts';
import { createAttachmentCleanupQueue } from './attachment-cleanup-queue.js';
import { inspectAttachmentDeletion } from './attachment-deletion-preflight.js';
import {
  createAttachmentId,
  moveFileSafely,
  sanitizeFileName,
  scheduleFileCleanup,
  sha256Buffer,
  writeFileAtomicallyAsync
} from './local-attachment-store-utils.js';

/** @param {import('./postgres-storage-types.ts').PostgresAttachmentStoreOptions} options */
export function createPostgresAttachmentStore({
  attachmentRepository,
  uploadsDir = path.join('storage', 'uploads'),
  storageRootDir = process.cwd(),
  legacyUploadsDirs = [],
  validateAttachmentNote = null,
  loadReferenceState = null,
  runTransaction = null
} = {}) {
  if (!attachmentRepository) throw new TypeError('PostgreSQL attachment store requires a repository');
  const fileManager = createLocalAttachmentFileManager({
    uploadsDir,
    storageRootDir,
    legacyUploadsDirs
  });
  const cleanupQueue = createAttachmentCleanupQueue({ storageRootDir, fileManager });

  async function uploadAttachment({ noteId, fileName, mimeType = 'application/octet-stream', contentBase64 }) {
    if (!noteId?.trim()) throw new Error('Attachment noteId is required');
    await validateAttachmentNote?.(noteId);
    if (!fileName?.trim()) throw new Error('Attachment fileName is required');
    if (!contentBase64?.trim()) throw new Error('Attachment contentBase64 is required');
    const id = createAttachmentId();
    const safeName = sanitizeFileName(fileName);
    const buffer = decodeAttachmentBytes(contentBase64);
    const contentSha256 = sha256Buffer(buffer);
    const storagePath = fileManager.buildStoragePath(id, safeName);
    const absoluteFilePath = fileManager.resolveManagedAbsolutePath(id, safeName);
    const attachment = {
      id,
      noteId,
      fileName: safeName,
      mimeType,
      size: buffer.byteLength,
      sha256: contentSha256,
      status: /** @type {import('./attachment-status.ts').AttachmentStatus} */ (ATTACHMENT_STATUS.PENDING),
      storagePath,
      verifiedAt: null,
      createdAt: new Date().toISOString()
    };

    await attachmentRepository.save(attachment);
    try {
      await writeFileAtomicallyAsync(absoluteFilePath, buffer);
    } catch (error) {
      attachment.status = ATTACHMENT_STATUS.FAILED;
      try {
        await attachmentRepository.save(attachment);
      } catch (statusError) {
        error.statusPersistError = statusError;
      }
      throw error;
    }

    attachment.status = ATTACHMENT_STATUS.READY;
    attachment.verifiedAt = new Date().toISOString();
    try {
      return await attachmentRepository.save(attachment);
    } catch (error) {
      attachment.status = ATTACHMENT_STATUS.PENDING;
      attachment.verifiedAt = null;
      let pendingRecordRestored = false;
      try {
        await attachmentRepository.save(attachment);
        pendingRecordRestored = true;
      } catch (statusError) {
        error.statusPersistError = statusError;
      }
      if (!pendingRecordRestored) {
        let currentRecord;
        try {
          currentRecord = await attachmentRepository.findById(attachment.id);
        } catch (lookupError) {
          error.recordLookupError = lookupError;
        }
        if (currentRecord === null) {
          await removeFileOrSchedule(attachment, fileManager, error);
        }
      }
      throw error;
    }
  }

  async function listAttachments(query = {}) {
    return attachmentRepository.list(query);
  }

  async function getAttachment(attachmentId) {
    return attachmentRepository.findById(attachmentId);
  }

  async function getRequiredAttachment(attachmentId) {
    const attachment = await getAttachment(attachmentId);
    if (!attachment) throw createAppError('ATTACHMENT_NOT_FOUND', 'Attachment not found', 404);
    return attachment;
  }

  async function saveHealth(original, health) {
    const save = async () => {
      const current = await getAttachment(original.id);
      assertSameAttachment(current, original);
      return attachmentRepository.save({ ...current, ...health });
    };
    return runTransaction ? runTransaction(save) : save();
  }

  async function verifyAttachment(id) {
    const attachment = await getRequiredAttachment(id);
    const { content, ...health } = inspectAttachmentFile(attachment, fileManager);
    if (attachment.status === health.status && attachment.verifiedAt === health.verifiedAt) return attachment;
    return saveHealth(attachment, health);
  }

  async function readAttachmentContent(id) {
    const attachment = await getRequiredAttachment(id);
    assertReadableStatus(attachment);
    const health = inspectAttachmentFile(attachment, fileManager);
    if (health.status !== 'ready') {
      await saveHealth(attachment, { status: health.status, verifiedAt: null });
      throwFileHealth(health.status);
    }
    return { attachment, content: health.content };
  }

  async function restoreAttachment(id, body) {
    if (!runTransaction) throw createAppError('ATTACHMENT_RESTORE_UNAVAILABLE', '附件事务保护暂不可用。', 503);
    const original = await getRequiredAttachment(id);
    const transaction = prepareAttachmentRestore(original, body, fileManager);
    try {
      assertSameAttachment(await getAttachment(id), original);
      transaction.commit();
      const updated = await saveHealth(original, { status: 'ready', verifiedAt: new Date().toISOString() });
      transaction.finalize();
      return updated;
    } catch (error) {
      const current = await getAttachment(id).catch(() => null);
      if (current && current.fileName === original.fileName && current.storagePath === original.storagePath)
        transaction.rollback();
      // 并发删除／重命名时保留恢复材料，不改写新的文件路径。
      throw error;
    }
  }

  async function renameAttachment(attachmentId, fileName) {
    const attachment = await getRequiredAttachment(attachmentId);
    if (!String(fileName ?? '').trim()) throw new Error('Attachment fileName is required');
    const nextSafeName = sanitizeFileName(fileName);
    const currentReadablePath = fileManager.resolveReadableAttachmentPath(attachment);
    const nextAbsolutePath = fileManager.resolveManagedAbsolutePath(attachment.id, nextSafeName);
    const nextStoragePath = fileManager.buildStoragePath(attachment.id, nextSafeName);
    const previous = { fileName: attachment.fileName, storagePath: attachment.storagePath, size: attachment.size };
    const fileMoved = Boolean(
      currentReadablePath && path.normalize(currentReadablePath) !== path.normalize(nextAbsolutePath)
    );
    if (fileMoved) moveFileSafely(currentReadablePath, nextAbsolutePath);
    const updated = {
      ...attachment,
      fileName: nextSafeName,
      storagePath: nextStoragePath,
      size: attachment.size
    };
    try {
      return await attachmentRepository.save(updated);
    } catch (error) {
      if (fileMoved && fs.existsSync(nextAbsolutePath) && currentReadablePath) {
        moveFileSafely(nextAbsolutePath, currentReadablePath);
      }
      Object.assign(attachment, previous);
      throw error;
    }
  }

  async function deleteAttachment(attachmentId) {
    if (!runTransaction) {
      throw createAppError('ATTACHMENT_PREFLIGHT_UNAVAILABLE', '附件事务保护暂不可用，已阻止删除。', 503);
    }
    const queued = await getRequiredAttachment(attachmentId);
    cleanupQueue.enqueue(queued);
    const deleted = await runTransaction(async () => {
      const current = await getRequiredAttachment(attachmentId);
      if (current.storagePath !== queued.storagePath || current.fileName !== queued.fileName) {
        throw createAppError('ATTACHMENT_DELETE_PREVIEW_STALE', '附件已变化，请重新检查后删除。', 409);
      }
      const preflight = await inspectDeletion(attachmentId);
      if (preflight.references.length) {
        throw createAppError('ATTACHMENT_REFERENCED', '保留的资产仍引用此附件，不能删除。', 409);
      }
      return attachmentRepository.delete(attachmentId);
    });
    return { ...deleted, cleanup: cleanupQueue.finish(deleted) };
  }

  async function inspectDeletion(attachmentId) {
    await getRequiredAttachment(attachmentId);
    if (!loadReferenceState) {
      throw createAppError('ATTACHMENT_PREFLIGHT_UNAVAILABLE', '附件引用检查暂不可用，已阻止删除。', 503);
    }
    return inspectAttachmentDeletion(attachmentId, await loadReferenceState());
  }

  async function detachAttachmentsForNotes(noteIds) {
    return attachmentRepository.deleteByNoteIds(noteIds);
  }

  async function removeDetachedAttachmentFiles(attachments) {
    return attachments.map(attachment => ({ id: attachment.id, cleanup: cleanupQueue.finish(attachment) }));
  }

  async function exportAttachmentsSnapshot() {
    const attachments = await listAttachments();
    const result = [];
    for (const attachment of attachments) {
      const readablePath = fileManager.resolveReadableAttachmentPath(attachment);
      if (!readablePath)
        throw createAppError('ATTACHMENT_FILE_MISSING', `Attachment file missing: ${attachment.id}`, 404);
      result.push({ ...attachment, contentBase64: (await fsp.readFile(readablePath)).toString('base64') });
    }
    return result;
  }

  return {
    uploadAttachment,
    listAttachments,
    getAttachment,
    readAttachmentContent,
    verifyAttachment,
    restoreAttachment,
    recoverAttachmentRestores: () => recoverAttachmentRestores(fileManager, getAttachment, verifyAttachment),
    renameAttachment,
    deleteAttachment,
    inspectAttachmentDeletion: inspectDeletion,
    detachAttachmentsForNotes,
    prepareAttachmentCleanup: attachments => attachments.forEach(attachment => cleanupQueue.enqueue(attachment)),
    removeDetachedAttachmentFiles,
    listAttachmentCleanup: () => cleanupQueue.list(id => attachmentRepository.findById(id)),
    retryAttachmentCleanup: () => cleanupQueue.retry(id => attachmentRepository.findById(id)),
    exportAttachmentsSnapshot,
    fileManager
  };
}

async function removeFileOrSchedule(attachment, fileManager, originalError) {
  try {
    fileManager.removeAttachmentFile(attachment);
  } catch (cleanupError) {
    scheduleFileCleanup(fileManager.resolveManagedAttachmentPath(attachment));
    originalError.cleanupError = cleanupError;
  }
}
