import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { taskAttachmentStorageKey } from '../modules/task-workspaces/storage-validation.ts';
import { fail, uuid } from '../modules/task-workspaces/contract.ts';
import { verifyTaskImage, TASK_IMAGE_MAX_BYTES } from './task-workspace-image.js';
const digest = bytes => createHash('sha256').update(bytes).digest('hex');

function secureDirectory(root, segments, create = false) {
  let candidate = root;
  for (const segment of ['', ...segments]) {
    if (segment) candidate = path.join(candidate, segment);
    if (create && !fs.existsSync(candidate)) fs.mkdirSync(candidate, { mode: 0o700 });
    const stat = fs.lstatSync(candidate);
    if (!stat.isDirectory() || stat.isSymbolicLink()) fail('FORBIDDEN');
  }
  return candidate;
}
function readFile(file) {
  const expected = fs.lstatSync(file);
  if (!expected.isFile() || expected.isSymbolicLink() || expected.nlink !== 1 || expected.size > TASK_IMAGE_MAX_BYTES)
    fail('FORBIDDEN');
  const fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0) | (fs.constants.O_NONBLOCK ?? 0));
  try {
    const matches = stat =>
      stat.isFile() &&
      stat.nlink === 1 &&
      stat.dev === expected.dev &&
      stat.ino === expected.ino &&
      stat.size === expected.size &&
      stat.mtimeMs === expected.mtimeMs;
    if (!matches(fs.fstatSync(fd))) fail('FORBIDDEN');
    const bytes = fs.readFileSync(fd);
    if (!matches(fs.fstatSync(fd)) || !matches(fs.lstatSync(file))) fail('FORBIDDEN');
    return bytes;
  } finally {
    fs.closeSync(fd);
  }
}

export function createTaskWorkspaceFiles({ uploadsDirectory }) {
  const configuredRoot = path.resolve(uploadsDirectory);
  fs.mkdirSync(configuredRoot, { recursive: true, mode: 0o700 });
  secureDirectory(configuredRoot, []);
  // 宿主配置路径可含macOS /var这类系统别名；固定真实root后拒绝域内链接。
  const root = fs.realpathSync(configuredRoot);
  return {
    async stage({ workspaceId, documentId, attachmentId, fileName, mimeType, bytes }) {
      uuid(workspaceId);
      uuid(documentId);
      uuid(attachmentId);
      if (
        typeof fileName !== 'string' ||
        !fileName.trim() ||
        fileName.length > 255 ||
        /[\\/]|[^\x20-\x7e\u0080-\uffff]/.test(fileName)
      )
        fail();
      const copy = Buffer.isBuffer(bytes) ? Buffer.from(bytes) : bytes;
      const verified = await verifyTaskImage(copy, mimeType);
      const storageKey = taskAttachmentStorageKey(workspaceId, documentId, attachmentId);
      const segments = storageKey.split('/');
      const file = path.join(secureDirectory(root, segments.slice(0, -1), true), segments.at(-1));
      let fd,
        created = false;
      try {
        fd = fs.openSync(file, 'wx', 0o600);
        created = true;
        fs.writeFileSync(fd, copy);
        fs.fsyncSync(fd);
        if (process.platform !== 'win32') {
          const directoryFd = fs.openSync(path.dirname(file), 'r');
          try {
            fs.fsyncSync(directoryFd);
          } finally {
            fs.closeSync(directoryFd);
          }
        }
      } catch (error) {
        if (created) fs.rmSync(file, { force: true });
        if (error.code === 'EEXIST') fail('CONFLICT');
        throw error;
      } finally {
        if (fd !== undefined) fs.closeSync(fd);
      }
      const stat = fs.lstatSync(file);
      let committed = false,
        discarded = false;
      return {
        metadata: { fileName, ...verified, storageKey },
        commit() {
          if (discarded) fail('CONFLICT');
          committed = true;
        },
        discard() {
          if (committed || discarded) return;
          discarded = true;
          if (!fs.existsSync(file)) return;
          const current = fs.lstatSync(file);
          if (current.dev === stat.dev && current.ino === stat.ino) fs.unlinkSync(file);
        }
      };
    },
    async read(attachment) {
      try {
        if (attachment?.status !== 'ready' || typeof attachment.storageKey !== 'string') fail('FORBIDDEN');
        const segments = attachment.storageKey.split('/');
        if (segments.length !== 4 || segments[0] !== 'task-workspaces') fail('FORBIDDEN');
        uuid(segments[1]);
        uuid(segments[2]);
        uuid(attachment.id);
        if (segments[2] !== attachment.documentId || segments[3] !== `${attachment.id}.bin`) fail('FORBIDDEN');
        const directory = secureDirectory(root, segments.slice(0, -1));
        const bytes = readFile(path.join(directory, segments[3]));
        if (bytes.length !== attachment.size || digest(bytes) !== attachment.sha256) fail('FORBIDDEN');
        const verified = await verifyTaskImage(bytes, attachment.mimeType);
        if (
          (attachment.width !== undefined && attachment.width !== verified.width) ||
          (attachment.height !== undefined && attachment.height !== verified.height)
        )
          fail('FORBIDDEN');
        return { bytes, mimeType: verified.mimeType, width: verified.width, height: verified.height };
      } catch (error) {
        if (error.code?.startsWith('TASK_WORKSPACE_')) throw error;
        fail('FORBIDDEN');
      }
    }
  };
}
