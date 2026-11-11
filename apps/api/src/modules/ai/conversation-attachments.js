import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { createAppError } from '../../errors/app-error.js';

export const CONVERSATION_ATTACHMENT_LIMITS = Object.freeze({
  maxFileBytes: 5 * 1024 * 1024,
  maxActiveFiles: 20,
  maxConversationBytes: 25 * 1024 * 1024
});
const mimeTypes = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain',
  'text/markdown',
  'image/png',
  'image/jpeg'
]);
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const hasUnsafeFileNameCharacter = fileName =>
  Array.from(fileName).some(character => {
    const code = character.charCodeAt(0);
    return character === '/' || character === '\\' || code < 32 || code === 127;
  });
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const fail = (code, message, status = 409) => {
  throw createAppError(code, message, status);
};
const sameBoundary = (record, scope) =>
  record &&
  ['ownerId', 'datasetId', 'datasetEpoch', 'spaceId', 'conversationId'].every(key => record[key] === scope[key]);
const removed = row => row.storageStatus === 'removed' || row.removedAt !== null;
export function createConversationAttachmentService({
  conversationStore: store,
  uploadsDir,
  ownerId,
  assertConversation = null
}) {
  if (!store || typeof uploadsDir !== 'string' || !uploadsDir || typeof ownerId !== 'string' || !ownerId)
    throw new TypeError('会话附件服务需要存储、上传目录和归属。');
  const baseDir = path.resolve(uploadsDir),
    attachmentDir = path.join(baseDir, 'ai-conversations');
  let accepting = true,
    closed = false,
    closing = null;
  const operations = new Set(),
    activeTemps = new Set();
  const checkOpen = () => {
    if (closed) fail('AI_ATTACHMENT_CLOSED', '附件服务已关闭。', 503);
  };
  const io = async operation => {
    checkOpen();
    return operation();
  };
  /** @template Result @param {() => Result | PromiseLike<Result>} operation @returns {Promise<Result>} */
  const run = operation => {
    if (!accepting) return Promise.reject(createAppError('AI_ATTACHMENT_CLOSED', '附件服务已关闭。', 503));
    const pending = Promise.resolve().then(operation);
    operations.add(pending);
    pending.then(
      () => operations.delete(pending),
      () => operations.delete(pending)
    );
    return pending;
  };
  async function owned(conversationId, attachmentId = null) {
    checkOpen();
    if (assertConversation) {
      const allowed = await assertConversation(conversationId);
      if (allowed?.readOnly) fail('AI_DATASET_STALE', '历史会话附件只供查看。');
    }
    const identity = await store.identity(),
      conversation = await store.getConversation(conversationId);
    if (!conversation || conversation.ownerId !== ownerId)
      fail('AI_ATTACHMENT_SCOPE_FORBIDDEN', '无权访问该会话附件。', 403);
    if (conversation.archivedAt) fail('AI_ATTACHMENT_SCOPE_FORBIDDEN', '会话已归档，附件不可操作。', 403);
    if (conversation.datasetId !== identity.datasetId || conversation.datasetEpoch !== identity.datasetEpoch)
      fail('AI_DATASET_STALE', '资料集已切换或恢复，旧会话附件不可读取。');
    const scope = { ownerId, ...identity, spaceId: conversation.spaceId, conversationId };
    if (!attachmentId) return scope;
    if (!uuid.test(attachmentId)) fail('AI_ATTACHMENT_NOT_FOUND', '附件不存在。', 404);
    const record = await store.getAttachment(attachmentId);
    if (!sameBoundary(record, scope)) fail('AI_ATTACHMENT_SCOPE_FORBIDDEN', '无权访问该会话附件。', 403);
    return record;
  }
  async function directory(create = false) {
    let cursor = path.parse(attachmentDir).root;
    for (const component of attachmentDir.slice(cursor.length).split(path.sep).filter(Boolean)) {
      cursor = path.join(cursor, component);
      let stat;
      try {
        stat = await io(() => fs.promises.lstat(cursor));
      } catch (error) {
        if (error.code !== 'ENOENT' || !create) throw error;
        try {
          await io(() => fs.promises.mkdir(cursor, { mode: 0o700 }));
        } catch (mkdirError) {
          if (mkdirError.code !== 'EEXIST') throw mkdirError;
        }
        stat = await io(() => fs.promises.lstat(cursor));
      }
      if (!stat.isDirectory() || stat.isSymbolicLink())
        fail('AI_ATTACHMENT_STORAGE_INVALID', '附件目录不是安全的普通目录。', 503);
    }
    return attachmentDir;
  }
  // 清理失败仍覆盖上传失败；即使清理失败，也不再将临时文件标记为活跃。
  async function cleanupTemporaryUpload(temporary) {
    try {
      await directory();
      await io(() => fs.promises.unlink(temporary));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    } finally {
      activeTemps.delete(temporary);
    }
  }
  async function filePath(record, create = false) {
    if (!uuid.test(record.attachmentId)) fail('AI_ATTACHMENT_STORAGE_INVALID', '附件存储标识无效。', 503);
    return path.join(await directory(create), `${record.attachmentId}.bin`);
  }
  async function bytesFor(record) {
    const target = await filePath(record);
    let handle;
    try {
      handle = await io(() => fs.promises.open(target, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW));
      const before = await io(() => handle.stat());
      if (!before.isFile() || before.size !== record.size || before.size > CONVERSATION_ATTACHMENT_LIMITS.maxFileBytes)
        fail('AI_ATTACHMENT_STORAGE_INVALID', '附件文件类型或大小与记录不一致。', 503);
      const bounded = Buffer.alloc(record.size + 1);
      let offset = 0;
      while (offset < bounded.length) {
        const read = await io(() => handle.read(bounded, offset, bounded.length - offset, null));
        if (!read.bytesRead) break;
        offset += read.bytesRead;
        if (offset > record.size) fail('AI_ATTACHMENT_STORAGE_INVALID', '附件读取期间大小超出原记录。', 503);
      }
      const bytes = bounded.subarray(0, offset),
        after = await io(() => handle.stat());
      if (
        bytes.length !== record.size ||
        sha256(bytes) !== record.sha256 ||
        before.size !== after.size ||
        before.mtimeMs !== after.mtimeMs
      )
        fail('AI_ATTACHMENT_STORAGE_INVALID', '附件完整性校验失败。', 503);
      await directory();
      return bytes;
    } catch (error) {
      if (['ELOOP', 'EISDIR', 'ENOTDIR'].includes(error.code))
        fail('AI_ATTACHMENT_STORAGE_INVALID', '附件存储路径无效。', 503);
      throw error;
    } finally {
      if (handle) await handle.close();
    }
  }
  async function update(record, patch) {
    checkOpen();
    return store.updateAttachment({
      ownerId,
      attachmentId: record.attachmentId,
      expectedRevision: record.revision,
      patch
    });
  }
  async function current(record) {
    return owned(record.conversationId, record.attachmentId);
  }
  async function cleanup(record) {
    if (!removed(record)) fail('AI_ATTACHMENT_CONFLICT', '只允许清理已删除的附件。');
    try {
      const target = await filePath(record),
        stat = await io(() => fs.promises.lstat(target));
      if (!stat.isFile() || stat.isSymbolicLink())
        fail('AI_ATTACHMENT_STORAGE_INVALID', '待清理附件不是普通文件。', 503);
      await io(() => fs.promises.unlink(target));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    const latest = await current(record);
    if (latest.cleanupStatus === 'complete') return latest;
    try {
      return await update(latest, { cleanupStatus: 'complete' });
    } catch (error) {
      if (error.code !== 'AI_ATTACHMENT_CONFLICT') throw error;
      return current(latest);
    }
  }
  async function updateIfUnchanged(record, patch) {
    const latest = await current(record);
    if (removed(latest) || latest.revision !== record.revision) return latest;
    try {
      return await update(record, patch);
    } catch (error) {
      if (error.code !== 'AI_ATTACHMENT_CONFLICT') throw error;
      return current(record);
    }
  }
  async function cleanTemporaryFiles(records) {
    let dir;
    try {
      const safeDir = await directory();
      dir = await io(() => fs.promises.opendir(safeDir));
    } catch (error) {
      if (error.code === 'ENOENT') return;
      throw error;
    }
    const allowed = new Map(records.map(record => [record.attachmentId, record]));
    let inspected = 0,
      cleaned = 0;
    for await (const entry of dir) {
      if (++inspected > 1000 || cleaned >= 100) break;
      const match = /^([a-f0-9-]{36})\.([a-f0-9-]{36})\.pending$/i.exec(entry.name);
      if (!match || !uuid.test(match[1]) || !uuid.test(match[2]) || !allowed.has(match[1])) continue;
      const target = path.join(attachmentDir, entry.name);
      if (activeTemps.has(target)) continue;
      const stat = await io(() => fs.promises.lstat(target));
      if (!stat.isFile() || stat.isSymbolicLink() || Date.now() - stat.mtimeMs < 3600000) continue;
      await current(allowed.get(match[1]));
      await directory();
      try {
        await io(() => fs.promises.unlink(target));
        cleaned++;
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
    }
  }
  const service = {
    upload: input =>
      run(async () => {
        const bytes = Buffer.isBuffer(input?.bytes) ? Buffer.from(input.bytes) : null;
        if (
          !bytes ||
          bytes.length < 1 ||
          bytes.length > CONVERSATION_ATTACHMENT_LIMITS.maxFileBytes ||
          !mimeTypes.has(input.mimeType) ||
          typeof input.fileName !== 'string' ||
          !input.fileName.trim() ||
          input.fileName.length > 180 ||
          hasUnsafeFileNameCharacter(input.fileName) ||
          typeof input.uploadKey !== 'string' ||
          !/^[a-zA-Z0-9-]{8,80}$/.test(input.uploadKey)
        )
          fail('AI_ATTACHMENT_UPLOAD_INVALID', '附件类型或大小无效，单件最大 5MB。', 422);
        await owned(input.conversationId);
        checkOpen();
        let record = await store.stageAttachment({
          ownerId,
          conversationId: input.conversationId,
          uploadKey: input.uploadKey,
          fileName: input.fileName,
          mimeType: input.mimeType,
          size: bytes.length,
          sha256: sha256(bytes)
        });
        if (removed(record)) return record;
        if (record.storageStatus === 'ready') {
          await bytesFor(record);
          return record;
        }
        const target = await filePath(record, true);
        const temporary = path.join(path.dirname(target), `${record.attachmentId}.${randomUUID()}.pending`);
        let handle;
        activeTemps.add(temporary);
        try {
          handle = await io(() =>
            fs.promises.open(
              temporary,
              fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW,
              0o600
            )
          );
          await io(() => handle.writeFile(bytes));
          await io(() => handle.sync());
          await handle.close();
          handle = null;
          await directory();
          try {
            await io(() => fs.promises.link(temporary, target));
          } catch (error) {
            if (error.code !== 'EEXIST') throw error;
          }
          // 硬链接只发布完整已 fsync 的文件；绝不覆盖其他服务实例已发布的目标。
          let directoryHandle;
          try {
            directoryHandle = await io(() =>
              fs.promises.open(path.dirname(target), fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW)
            );
            await io(() => directoryHandle.sync());
          } catch (error) {
            if (!['EINVAL', 'ENOTSUP', 'EPERM', 'EISDIR'].includes(error.code)) throw error;
          } finally {
            if (directoryHandle) await directoryHandle.close();
          }
        } finally {
          if (handle) await handle.close();
          await cleanupTemporaryUpload(temporary);
        }
        await bytesFor(record);
        const latest = await current(record);
        if (removed(latest)) {
          await cleanup(latest);
          return current(latest);
        }
        if (latest.revision !== record.revision) return latest;
        record = await updateIfUnchanged(record, {
          storageStatus: 'ready',
          parseStatus: 'not_parsed',
          errorCode: 'AI_ATTACHMENT_NOT_PARSED'
        });
        if (removed(record)) {
          await cleanup(record);
          return current(record);
        }
        return record;
      }),
    list: conversationId =>
      run(async () => {
        const scope = await owned(conversationId);
        return (await store.listAttachments(conversationId)).filter(row => sameBoundary(row, scope));
      }),
    readVerified: input =>
      run(async () => {
        const record = await owned(input?.conversationId, input?.attachmentId);
        if (removed(record)) fail('AI_ATTACHMENT_REMOVED', '附件已删除。', 410);
        if (record.storageStatus !== 'ready') fail('AI_ATTACHMENT_NOT_READY', '附件文件尚未就绪。');
        const bytes = await bytesFor(record),
          latest = await current(record);
        if (removed(latest) || latest.revision !== record.revision)
          fail('AI_ATTACHMENT_CONFLICT', '读取期间附件已变化。');
        return { record, bytes, segments: record.segments };
      }),
    remove: input =>
      run(async () => {
        let record = await owned(input?.conversationId, input?.attachmentId);
        if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 1)
          fail('AI_ATTACHMENT_REQUEST_INVALID', '删除附件需要当前版本。', 422);
        if (!removed(record)) {
          if (record.revision !== input.expectedRevision) fail('AI_ATTACHMENT_CONFLICT', '附件已变化，请刷新后删除。');
          record = await update(record, {
            storageStatus: 'removed',
            parseStatus: 'failed',
            errorCode: 'AI_ATTACHMENT_REMOVED',
            removedAt: new Date().toISOString(),
            cleanupStatus: 'pending',
            segments: [],
            parsedTextHash: null,
            imageMetadata: null,
            parserVersion: null
          });
        }
        return record.cleanupStatus === 'complete' ? record : cleanup(record);
      }),
    recover: () =>
      run(async () => {
        const identity = await store.identity(),
          recovered = [],
          eligible = [];
        for (const original of await store.listAttachments()) {
          if (
            original.ownerId !== ownerId ||
            original.datasetId !== identity.datasetId ||
            original.datasetEpoch !== identity.datasetEpoch
          )
            continue;
          let record;
          try {
            record = await current(original);
          } catch (error) {
            if (
              [
                'AI_DATASET_STALE',
                'AI_ATTACHMENT_SCOPE_FORBIDDEN',
                'AI_SCOPE_FORBIDDEN',
                'AI_CONVERSATION_NOT_FOUND'
              ].includes(error.code)
            )
              continue;
            throw error;
          }
          eligible.push(record);
          if (removed(record)) {
            if (record.cleanupStatus !== 'complete') recovered.push(await cleanup(record));
            continue;
          }
          try {
            await bytesFor(record);
          } catch (error) {
            if (error.code !== 'ENOENT' && error.code !== 'AI_ATTACHMENT_STORAGE_INVALID') throw error;
            recovered.push(
              await updateIfUnchanged(record, {
                storageStatus: 'missing',
                parseStatus: 'failed',
                errorCode: error.code === 'ENOENT' ? 'AI_ATTACHMENT_FILE_MISSING' : 'AI_ATTACHMENT_STORAGE_INVALID',
                segments: [],
                parsedTextHash: null,
                imageMetadata: null,
                parserVersion: null
              })
            );
            continue;
          }
          if (record.storageStatus !== 'ready')
            record = await updateIfUnchanged(record, {
              storageStatus: 'ready',
              parseStatus: 'not_parsed',
              errorCode: 'AI_ATTACHMENT_NOT_PARSED'
            });
          if (removed(record)) {
            recovered.push(record);
            continue;
          }
          recovered.push(record);
        }
        await cleanTemporaryFiles(eligible);
        return recovered;
      }),
    close() {
      if (!closing) {
        accepting = false;
        closing = Promise.allSettled([...operations]).then(() => {
          closed = true;
        });
      }
      return closing;
    }
  };
  return service;
}
