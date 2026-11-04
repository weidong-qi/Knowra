import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { writeJsonFileAtomically } from './atomic-json-file.ts';
import type { PathLike } from 'node:fs';
import type { AttachmentFileMetadata, LocalAttachmentRecord } from './local-attachment-types.ts';

interface CleanupFileManager {
  resolveManagedAttachmentPath(attachment: Pick<AttachmentFileMetadata, 'id' | 'fileName'>): string | null;
  removeAttachmentFile(attachment: Pick<AttachmentFileMetadata, 'id' | 'fileName'>): boolean;
}
type CleanupAttachment = Pick<LocalAttachmentRecord, 'id' | 'fileName'> &
  Partial<Pick<LocalAttachmentRecord, 'noteId' | 'storagePath'>>;

export interface AttachmentCleanupQueueDependencies {
  storageRootDir: string;
  fileManager: CleanupFileManager;
}
// 清理意图来自磁盘 JSON；除 id/文件名外的字段沿用旧行为，不冒充已校验的元数据。
interface RawCleanupTask {
  attachmentId?: unknown;
  fileName?: unknown;
  storagePath?: unknown;
  noteId?: unknown;
  createdAt?: unknown;
  reasonCode?: unknown;
}
// 本地调用方返回布尔值，PG 调用方返回记录或 null；队列只判断真值，不读取返回结构。
type MetadataPresence<Metadata> = (id: string) => Metadata | Promise<Metadata>;

// 先持久化意图，再提交业务删除。事务失败留下的任务只会看到仍存在的元数据，不能误删文件。
export function createAttachmentCleanupQueue({ storageRootDir, fileManager }: AttachmentCleanupQueueDependencies) {
  const directory = path.join(path.resolve(storageRootDir), 'storage', 'temp', 'attachment-cleanup');
  fs.mkdirSync(directory, { recursive: true });
  const taskPath = (attachment: Pick<LocalAttachmentRecord, 'id'>) =>
    path.join(directory, `${createHash('sha256').update(attachment.id).digest('hex')}.json`);

  function enqueue(attachment: CleanupAttachment) {
    const managedPath = fileManager.resolveManagedAttachmentPath(attachment);
    if (!managedPath) throw new Error('Attachment cleanup path is not managed');
    const task = {
      attachmentId: attachment.id,
      fileName: attachment.fileName,
      storagePath: attachment.storagePath,
      noteId: attachment.noteId,
      createdAt: new Date().toISOString()
    };
    writeJsonFileAtomically(taskPath(attachment), task);
    return task;
  }

  function finish<Attachment extends Pick<LocalAttachmentRecord, 'id' | 'fileName'>>(
    attachment: Attachment
  ): 'complete' | 'pending-retry' {
    try {
      const removed = fileManager.removeAttachmentFile(attachment);
      if (
        !removed &&
        (fs.existsSync as (path: PathLike | null) => boolean)(fileManager.resolveManagedAttachmentPath(attachment))
      )
        throw new Error('Managed file cleanup was not completed');
      fs.rmSync(taskPath(attachment), { force: true });
      return 'complete';
    } catch (error) {
      try {
        const file = taskPath(attachment);
        const task = JSON.parse(fs.readFileSync(file, 'utf8')) as RawCleanupTask;
        writeJsonFileAtomically(file, { ...task, reasonCode: 'ATTACHMENT_CLEANUP_FAILED' });
      } catch {
        /* 原任务仍保留；不暴露磁盘路径。 */
      }
      return 'pending-retry';
    }
  }

  async function retry<Metadata>(isMetadataPresent: MetadataPresence<Metadata>) {
    let completed = 0;
    let pending = 0;
    for (const name of fs.readdirSync(directory).filter(name => /^[a-f0-9]{64}\.json$/.test(name))) {
      let task: RawCleanupTask;
      try {
        task = JSON.parse(fs.readFileSync(path.join(directory, name), 'utf8'));
      } catch {
        pending++;
        continue;
      }
      if (typeof task?.attachmentId !== 'string' || typeof task?.fileName !== 'string') {
        pending++;
        continue;
      }
      if (await isMetadataPresent(task.attachmentId)) continue;
      if (finish({ id: task.attachmentId, fileName: task.fileName, storagePath: task.storagePath }) === 'complete')
        completed++;
      else pending++;
    }
    return { completed, pending };
  }

  async function list<Metadata>(isMetadataPresent: MetadataPresence<Metadata>) {
    const items = [];
    for (const name of fs.readdirSync(directory).filter(name => /^[a-f0-9]{64}\.json$/.test(name))) {
      try {
        const task = JSON.parse(fs.readFileSync(path.join(directory, name), 'utf8')) as RawCleanupTask;
        if (typeof task.attachmentId !== 'string' || typeof task.fileName !== 'string') throw new Error('invalid task');
        if (await isMetadataPresent(task.attachmentId)) continue;
        items.push({
          attachmentId: task.attachmentId,
          fileName: task.fileName,
          noteId: task.noteId ?? null,
          createdAt: task.createdAt,
          cleanup: 'pending-retry',
          reasonCode: task.reasonCode ?? 'ATTACHMENT_CLEANUP_PENDING'
        });
      } catch {
        items.push({
          attachmentId: null,
          fileName: '无法读取的清理任务',
          cleanup: 'pending-retry',
          reasonCode: 'ATTACHMENT_CLEANUP_TASK_INVALID'
        });
      }
    }
    return { items, pending: items.length };
  }

  return { enqueue, finish, retry, list };
}
