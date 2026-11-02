import { createAttachmentId, sanitizeFileName } from '../../infrastructure/local-attachment-store-utils.js';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { createLocalAttachmentFileManager } from '../../infrastructure/local-attachment-file-manager.js';
import { syncError } from './journal.ts';

export const MAX_SYNC_ATTACHMENT_BYTES = 6 * 1024 * 1024;
const digest = bytes => createHash('sha256').update(bytes).digest('hex');

/** 文件先完整校验并持久化，元数据随后在业务事务中发布。重复请求不覆盖已有文件。 */
export function createAttachmentTransfer({ uploadsDir, storageRootDir, allowRepair = false }) {
  const manager = createLocalAttachmentFileManager({ uploadsDir, storageRootDir });
  function inspect(record) {
    if (
      !record ||
      typeof record.id !== 'string' ||
      !/^[a-f0-9]{64}$/.test(record.sha256 ?? '') ||
      !Number.isSafeInteger(record.size) ||
      record.size < 0 ||
      record.size > MAX_SYNC_ATTACHMENT_BYTES
    )
      throw syncError('SYNC_ATTACHMENT_INVALID', '附件大小或哈希无效。', 422);
    if (
      typeof record.fileName !== 'string' ||
      !record.fileName ||
      record.fileName !== sanitizeFileName(record.fileName)
    )
      throw syncError('SYNC_ATTACHMENT_INVALID', '附件文件名无效。', 422);
    const destination = manager.resolveManagedAbsolutePath(record.id, record.fileName);
    return { destination, storagePath: manager.buildStoragePath(record.id, record.fileName) };
  }
  function cachePath(record) {
    const directory = path.join(uploadsDir, '.sync-cache');
    if (fs.existsSync(directory) && fs.lstatSync(directory).isSymbolicLink())
      throw new Error('附件缓存目录不能是符号链接。');
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    const file = path.join(directory, record.sha256);
    if (fs.existsSync(file) && !fs.lstatSync(file).isFile()) throw new Error('附件缓存不是普通文件。');
    return file;
  }
  function verify(record) {
    const { destination, storagePath } = inspect(record);
    let content;
    try {
      content = fs.readFileSync(destination);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      throw syncError('ATTACHMENT_NOT_READY', '附件文件尚未传输完成。');
    }
    if (content.length !== record.size || digest(content) !== record.sha256)
      throw syncError('ATTACHMENT_HASH_MISMATCH', '附件完整性校验失败。', 422);
    return { id: record.id, fileName: record.fileName, sha256: record.sha256, size: record.size, storagePath };
  }
  const transfer = {
    verify,
    // 新归属必须使用新 ID；先落盘，再由调用方的业务事务发布元数据。
    prepareCopy(attachment, noteId) {
      const copy = {
        ...attachment,
        id: createAttachmentId(),
        noteId,
        status: 'ready',
        verifiedAt: new Date().toISOString()
      };
      const { destination, storagePath } = inspect(copy);
      if (fs.existsSync(destination)) throw new Error('附件副本目标已存在，请重试。');
      copy.storagePath = storagePath;
      const rollback = () => manager.removeAttachmentFile(copy);
      try {
        const content = transfer.read(attachment);
        transfer.put({ attachment: copy, contentBase64: content.toString('base64') });
        return { attachment: copy, rollback };
      } catch (error) {
        try {
          rollback();
        } catch (rollbackError) {
          error.rollbackError = rollbackError;
        }
        throw error;
      }
    },
    put({ attachment, contentBase64 }) {
      const { destination } = inspect(attachment);
      if (typeof contentBase64 !== 'string' || contentBase64.length > Math.ceil(MAX_SYNC_ATTACHMENT_BYTES / 3) * 4)
        throw syncError('SYNC_ATTACHMENT_INVALID', '附件传输内容过大。', 413);
      const content = Buffer.from(contentBase64, 'base64');
      if (content.length !== attachment.size || digest(content) !== attachment.sha256)
        throw syncError('ATTACHMENT_HASH_MISMATCH', '附件传输校验失败，请重试。', 422);
      if (allowRepair && fs.existsSync(destination)) {
        try {
          verify(attachment);
        } catch {
          fs.renameSync(destination, path.join(uploadsDir, `.sync-corrupt-${randomUUID()}`));
        }
      }
      if (!fs.existsSync(destination)) {
        const temporary = path.join(uploadsDir, `.sync-${randomUUID()}.tmp`);
        let fd;
        try {
          fd = fs.openSync(temporary, 'wx', 0o600);
          fs.writeFileSync(fd, content);
          fs.fsyncSync(fd);
          fs.closeSync(fd);
          fd = undefined;
          try {
            fs.linkSync(temporary, destination);
          } catch (error) {
            if (error.code !== 'EEXIST') throw error;
          }
          const directory = fs.openSync(uploadsDir, 'r');
          try {
            fs.fsyncSync(directory);
          } finally {
            fs.closeSync(directory);
          }
        } finally {
          if (fd !== undefined) fs.closeSync(fd);
          fs.rmSync(temporary, { force: true });
        }
      }
      return verify(attachment);
    },
    read(attachment) {
      const { destination } = inspect(attachment);
      const cached = cachePath(attachment);
      if (fs.existsSync(destination)) {
        verify(attachment);
        if (allowRepair && fs.existsSync(cached) && digest(fs.readFileSync(cached)) !== attachment.sha256)
          fs.renameSync(cached, path.join(uploadsDir, `.sync-corrupt-${randomUUID()}`));
        try {
          fs.linkSync(destination, cached);
        } catch (error) {
          if (error.code !== 'EEXIST') throw error;
        }
      }
      const bytes = fs.readFileSync(fs.existsSync(destination) ? destination : cached);
      if (bytes.length !== attachment.size || digest(bytes) !== attachment.sha256)
        throw syncError('ATTACHMENT_HASH_MISMATCH', '附件缓存校验失败。', 422);
      return bytes;
    }
  };
  return transfer;
}
