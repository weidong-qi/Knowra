import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { MAX_ATTACHMENT_UPLOAD_BYTES, MAX_ATTACHMENT_RESTORE_BYTES } from '@study-accelerator/shared/attachments';
import { createAppError } from '../errors/app-error.ts';
import { normalizeSha256 } from './attachment-record-reconciliation.ts';
import { sha256Buffer, writeFileAtomically } from './local-attachment-store-utils.ts';
import type {
  AttachmentFileHealth,
  AttachmentFileManager,
  AttachmentOperationError,
  AttachmentRestoreBody,
  AttachmentRestoreIntent,
  LocalAttachmentRecord
} from './local-attachment-types.ts';

type AttachmentInspectionFileManager = Pick<AttachmentFileManager, 'resolveReadableAttachmentPath'>;
type AttachmentRestoreFileManager = Pick<
  AttachmentFileManager,
  'resolveManagedAbsolutePath' | 'getManagedUploadsDirectory'
>;
type AttachmentLookup = (
  id: string | undefined
) => LocalAttachmentRecord | null | undefined | Promise<LocalAttachmentRecord | null | undefined>;

export function decodeAttachmentBytes(contentBase64: unknown, limit = MAX_ATTACHMENT_UPLOAD_BYTES, allowEmpty = false) {
  if (typeof contentBase64 !== 'string' || contentBase64.length > Math.ceil(limit / 3) * 4) {
    throw createAppError('ATTACHMENT_TOO_LARGE', '附件超过允许的大小。', 413);
  }
  if (contentBase64.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(contentBase64)) {
    throw createAppError('ATTACHMENT_CONTENT_INVALID', '附件内容编码无效。', 422);
  }
  const content = Buffer.from(contentBase64, 'base64');
  if (content.length > limit) throw createAppError('ATTACHMENT_TOO_LARGE', '附件超过允许的大小。', 413);
  if ((!allowEmpty && !content.length) || content.toString('base64') !== contentBase64) {
    throw createAppError('ATTACHMENT_CONTENT_INVALID', '附件内容为空或编码无效。', 422);
  }
  return content;
}

export function attachmentIdentity(attachment: LocalAttachmentRecord) {
  return JSON.stringify([
    attachment.id,
    attachment.noteId,
    attachment.fileName,
    attachment.storagePath,
    attachment.sha256,
    attachment.size
  ]);
}

export function assertSameAttachment(
  current: LocalAttachmentRecord | null | undefined,
  expected: LocalAttachmentRecord
): asserts current is LocalAttachmentRecord {
  if (!current || attachmentIdentity(current) !== attachmentIdentity(expected)) {
    throw createAppError('ATTACHMENT_CHANGED', '附件已删除或发生变化，请刷新后重试。', 409);
  }
}

// 读取前保存期望值；文件定位工具不得把实测大小写回有可信哈希的记录。
export function inspectAttachmentFile(
  attachment: LocalAttachmentRecord,
  fileManager: AttachmentInspectionFileManager
): AttachmentFileHealth {
  const expected = normalizeSha256(attachment.sha256);
  const readablePath = fileManager.resolveReadableAttachmentPath({ ...attachment });
  if (!readablePath) return { status: 'missing', verifiedAt: null };
  let content;
  try {
    content = fs.readFileSync(readablePath);
  } catch (error) {
    if ((error as AttachmentOperationError).code === 'ENOENT') return { status: 'missing', verifiedAt: null };
    throw error;
  }
  if (!expected) return { status: 'failed', verifiedAt: null };
  if (content.length !== attachment.size || sha256Buffer(content) !== expected)
    return { status: 'corrupt', verifiedAt: null };
  return {
    status: 'ready',
    verifiedAt:
      attachment.status === 'ready' && attachment.verifiedAt ? attachment.verifiedAt : new Date().toISOString(),
    content
  };
}

export function assertReadableStatus(attachment: Pick<LocalAttachmentRecord, 'status'>) {
  if (attachment.status === 'corrupt')
    throw createAppError('ATTACHMENT_FILE_CORRUPT', '附件文件损坏，请核验或恢复原文件。', 409);
  if (!['ready', 'missing'].includes(attachment.status!))
    throw createAppError('ATTACHMENT_NOT_READY', '附件尚不可用，请先核验。', 409);
}

export function throwFileHealth(status: AttachmentFileHealth['status']): never {
  if (status === 'missing') throw createAppError('ATTACHMENT_FILE_MISSING', '附件文件缺失，请恢复原文件。', 404);
  if (status === 'corrupt') throw createAppError('ATTACHMENT_FILE_CORRUPT', '附件文件损坏，请恢复原文件。', 409);
  throw createAppError('ATTACHMENT_UNVERIFIABLE', '附件缺少可信原哈希，无法核验。', 422);
}

// 原内容永不覆盖：损坏副本作为恢复材料保留，成功提交后才移除本次临时备份。
export function prepareAttachmentRestore(
  attachment: LocalAttachmentRecord,
  body: AttachmentRestoreBody | null | undefined,
  fileManager: AttachmentRestoreFileManager
) {
  const expected = normalizeSha256(attachment.sha256);
  if (!expected)
    throw createAppError('ATTACHMENT_RESTORE_UNVERIFIABLE', '缺少可信原哈希，请作为新附件上传，不能覆盖原附件。', 422);
  const content = decodeAttachmentBytes(body?.contentBase64, MAX_ATTACHMENT_RESTORE_BYTES, attachment.size === 0);
  if (content.length !== attachment.size || sha256Buffer(content) !== expected) {
    throw createAppError('ATTACHMENT_RESTORE_MISMATCH', '所选文件与原附件不一致，请选择原文件。', 422);
  }
  const destination = fileManager.resolveManagedAbsolutePath(attachment.id, attachment.fileName);
  const prefix = path.join(fileManager.getManagedUploadsDirectory(), `.restore-${randomUUID()}`);
  const staged = `${prefix}.tmp`;
  const backup = `${prefix}.bak`;
  const intent = `${prefix}.json`;
  writeFileAtomically(staged, content);
  try {
    if (fs.existsSync(destination)) fs.linkSync(destination, backup);
    writeFileAtomically(
      intent,
      Buffer.from(
        JSON.stringify({ attachment: { ...attachment }, staged: path.basename(staged), backup: path.basename(backup) })
      )
    );
  } catch (error) {
    fs.rmSync(staged, { force: true });
    fs.rmSync(backup, { force: true });
    throw error;
  }
  let committed = false;
  return {
    commit() {
      fileManager.resolveManagedAbsolutePath(attachment.id, attachment.fileName);
      fs.renameSync(staged, destination);
      committed = true;
      const directory = fs.openSync(path.dirname(destination), 'r');
      try {
        fs.fsyncSync(directory);
      } finally {
        fs.closeSync(directory);
      }
    },
    finalize() {
      try {
        fs.rmSync(backup, { force: true });
        fs.rmSync(intent, { force: true });
      } catch {
        /* 文件与元数据已提交，临时材料由重启核验清理。 */
      }
    },
    rollback() {
      if (committed) {
        if (fs.existsSync(backup)) fs.renameSync(backup, destination);
        else fs.rmSync(destination, { force: true });
      }
      fs.rmSync(staged, { force: true });
      fs.rmSync(backup, { force: true });
      fs.rmSync(intent, { force: true });
    }
  };
}

// 崩溃后仅继续已获授权、身份及原文件哈希仍匹配的恢复。
// 其他材料保留供运维诊断，不让旧 ID 重新出现。
export async function recoverAttachmentRestores<VerifyResult>(
  fileManager: AttachmentInspectionFileManager & AttachmentRestoreFileManager,
  getAttachment: AttachmentLookup,
  verifyAttachment?: (id: string) => VerifyResult | Promise<VerifyResult>
) {
  const directory = fileManager.getManagedUploadsDirectory();
  for (const name of fs.readdirSync(directory).filter(name => /^\.restore-[a-f0-9-]+\.json$/.test(name))) {
    try {
      const intent = JSON.parse(fs.readFileSync(path.join(directory, name), 'utf8')) as AttachmentRestoreIntent;
      const current = await getAttachment(intent.attachment?.id);
      assertSameAttachment(current, intent.attachment);
      if (inspectAttachmentFile(current, fileManager).status !== 'ready') {
        if (typeof intent.staged !== 'string' || !/^\.restore-[a-f0-9-]+\.tmp$/.test(intent.staged)) continue;
        const staged = path.join(directory, intent.staged);
        const stat = fs.lstatSync(staged);
        if (!stat.isFile() || stat.isSymbolicLink()) continue;
        const bytes = fs.readFileSync(staged);
        if (bytes.length !== current.size || sha256Buffer(bytes) !== normalizeSha256(current.sha256)) continue;
        assertSameAttachment(await getAttachment(current.id), intent.attachment);
        fs.renameSync(staged, fileManager.resolveManagedAbsolutePath(current.id, current.fileName));
      }
      await verifyAttachment?.(current.id);
      for (const candidate of [intent.staged, intent.backup]) {
        if (typeof candidate === 'string' && /^\.restore-[a-f0-9-]+\.(tmp|bak)$/.test(candidate))
          fs.rmSync(path.join(directory, candidate), { force: true });
      }
      fs.rmSync(path.join(directory, name));
    } catch {
      /* 保留不能自动确认的恢复材料。 */
    }
  }
}
