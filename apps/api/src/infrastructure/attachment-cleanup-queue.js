import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { writeJsonFileAtomically } from './atomic-json-file.ts';

// 先持久化意图，再提交业务删除。事务失败留下的任务只会看到仍存在的元数据，不能误删文件。
export function createAttachmentCleanupQueue({ storageRootDir, fileManager }) {
  const directory = path.join(path.resolve(storageRootDir), 'storage', 'temp', 'attachment-cleanup');
  fs.mkdirSync(directory, { recursive: true });
  const taskPath = attachment =>
    path.join(directory, `${createHash('sha256').update(attachment.id).digest('hex')}.json`);

  function enqueue(attachment) {
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

  function finish(attachment) {
    try {
      const removed = fileManager.removeAttachmentFile(attachment);
      if (!removed && fs.existsSync(fileManager.resolveManagedAttachmentPath(attachment)))
        throw new Error('Managed file cleanup was not completed');
      fs.rmSync(taskPath(attachment), { force: true });
      return 'complete';
    } catch (error) {
      try {
        const file = taskPath(attachment);
        const task = JSON.parse(fs.readFileSync(file, 'utf8'));
        writeJsonFileAtomically(file, { ...task, reasonCode: 'ATTACHMENT_CLEANUP_FAILED' });
      } catch {
        /* 原任务仍保留；不暴露磁盘路径。 */
      }
      return 'pending-retry';
    }
  }

  async function retry(isMetadataPresent) {
    let completed = 0;
    let pending = 0;
    for (const name of fs.readdirSync(directory).filter(name => /^[a-f0-9]{64}\.json$/.test(name))) {
      let task;
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

  async function list(isMetadataPresent) {
    const items = [];
    for (const name of fs.readdirSync(directory).filter(name => /^[a-f0-9]{64}\.json$/.test(name))) {
      try {
        const task = JSON.parse(fs.readFileSync(path.join(directory, name), 'utf8'));
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
