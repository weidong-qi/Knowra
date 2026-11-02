import fs from 'node:fs';
import type { PathLike } from 'node:fs';
import { ATTACHMENT_STATUS } from './attachment-status.ts';
import { sha256FileSync } from './local-attachment-store-utils.ts';

// 未校验、可变的最小元数据视图；不保证访问器稳定或磁盘状态不变。
export interface AttachmentIntegrityRecord {
  id?: unknown;
  size?: unknown;
  sha256?: unknown;
  status?: unknown;
  verifiedAt?: unknown;
}

export interface ReconcileAttachmentIntegrityOptions {
  now?: string | number | Date | undefined;
}

export function reconcileAttachmentIntegrity(
  attachment: AttachmentIntegrityRecord | null | undefined,
  filePath: PathLike | null | undefined,
  { now = new Date().toISOString() }: ReconcileAttachmentIntegrityOptions = {}
): boolean {
  if (!attachment?.id) {
    return false;
  }

  const previous = {
    size: attachment.size,
    sha256: attachment.sha256 ?? null,
    status: attachment.status ?? ATTACHMENT_STATUS.READY,
    verifiedAt: attachment.verifiedAt ?? null
  };

  if (!filePath || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    attachment.status = ATTACHMENT_STATUS.MISSING;
    attachment.verifiedAt = null;
    return hasChanged(attachment, previous);
  }

  const stats = fs.statSync(filePath);
  const actualSha256 = sha256FileSync(filePath);
  const expectedSha256 = normalizeSha256(attachment.sha256);
  if (expectedSha256 && (expectedSha256 !== actualSha256 || attachment.size !== stats.size)) {
    attachment.status = ATTACHMENT_STATUS.CORRUPT;
    attachment.verifiedAt = null;
    return hasChanged(attachment, previous);
  }

  attachment.size = stats.size;
  attachment.sha256 = actualSha256;
  attachment.status = ATTACHMENT_STATUS.READY;
  attachment.verifiedAt = new Date(now).toISOString();
  return hasChanged(attachment, previous);
}

export function normalizeSha256(value: unknown) {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/i.test(value)) {
    return null;
  }
  return value.toLowerCase();
}

function hasChanged(attachment: AttachmentIntegrityRecord, previous: AttachmentIntegrityRecord): boolean {
  return (
    attachment.size !== previous.size ||
    (attachment.sha256 ?? null) !== previous.sha256 ||
    attachment.status !== previous.status ||
    (attachment.verifiedAt ?? null) !== previous.verifiedAt
  );
}
