import fs from 'node:fs';
import path from 'node:path';
import { ATTACHMENT_STATUS, normalizeAttachmentStatus } from './attachment-status.ts';
import { normalizeSha256 } from './attachment-record-reconciliation.ts';
import { sha256FileSync } from './local-attachment-store-utils.ts';
import type { AttachmentStatus } from './attachment-status.ts';
import type { AttachmentFileMetadata, AttachmentOperationError } from './local-attachment-types.ts';

export interface AttachmentIntegrityMetadata extends Omit<AttachmentFileMetadata, 'size'> {
  id: string;
  size?: number | string | null;
  status?: string | null;
  verifiedAt?: string | null;
}
export interface AttachmentIntegrityIssue {
  code: string;
  message: string;
  attachmentId?: string;
  fileName?: string;
  expectedSha256?: string;
  actualSha256?: string;
  expectedSize?: number;
  actualSize?: number;
  previousStatus?: string | null;
  generatedAt?: string;
}
export interface AttachmentIntegrityItem {
  attachmentId: string;
  filePath: string | null;
  expectedFileName: string;
  expectedSize: number | null;
  expectedSha256: string | null;
  storedStatus: string | null | undefined;
  actualSize: number | null;
  actualSha256: string | null;
  observedStatus: AttachmentStatus;
  errors: AttachmentIntegrityIssue[];
  warnings: AttachmentIntegrityIssue[];
}
interface IntegrityFileManager {
  getAttachmentFileName(attachment: Pick<AttachmentFileMetadata, 'id' | 'fileName'>): string;
  getAttachmentCandidatePaths(attachment: Pick<AttachmentFileMetadata, 'id' | 'fileName'>): string[];
  getManagedUploadsDirectory(): string;
}
export interface AttachmentIntegrityOptions {
  attachments?: AttachmentIntegrityMetadata[];
  fileManager?: IntegrityFileManager;
  generatedAt?: string;
}
interface AttachmentRepairFields {
  size?: number | string | null;
  sha256?: unknown;
  status?: string | null;
  verifiedAt?: string | null;
}

export function inspectAttachmentIntegrity({
  attachments = [],
  fileManager,
  generatedAt = new Date().toISOString()
}: AttachmentIntegrityOptions = {}) {
  if (!fileManager?.getAttachmentCandidatePaths) {
    throw new TypeError('Attachment integrity inspection requires a file manager');
  }

  const errors: AttachmentIntegrityIssue[] = [];
  const warnings: AttachmentIntegrityIssue[] = [];
  const items: AttachmentIntegrityItem[] = [];
  const expectedFileNames = new Set<string>();

  for (const attachment of attachments) {
    const expectedFileName = fileManager.getAttachmentFileName(attachment);
    expectedFileNames.add(expectedFileName);
    const candidatePaths = fileManager.getAttachmentCandidatePaths(attachment);
    const filePath = candidatePaths.find(isRegularFile) ?? null;
    const item = inspectAttachment(attachment, filePath, generatedAt);
    items.push(item);
    if (item.expectedFileName) expectedFileNames.add(item.expectedFileName);
    errors.push(...item.errors);
    warnings.push(...item.warnings);
  }

  const orphanFiles = listManagedFiles(fileManager.getManagedUploadsDirectory()).filter(
    fileName => !expectedFileNames.has(fileName)
  );
  orphanFiles.forEach(fileName => {
    warnings.push({
      code: 'ATTACHMENT_ORPHAN_FILE',
      message: 'Managed uploads directory contains an unreferenced file',
      fileName
    });
  });

  const counts = countStatuses(items);
  counts.orphanFiles = orphanFiles.length;
  return {
    generatedAt,
    status: errors.length ? 'degraded' : warnings.length ? 'needs-repair' : 'ready',
    canServe: errors.length === 0,
    counts,
    items,
    orphanFiles,
    errors,
    warnings
  };
}

export function buildAttachmentRepairRecord<T extends AttachmentIntegrityMetadata>(
  attachment: T,
  item: AttachmentIntegrityItem,
  { verifiedAt = new Date().toISOString() }: { verifiedAt?: string } = {}
) {
  const repaired: Omit<T, keyof AttachmentRepairFields> & AttachmentRepairFields = { ...attachment };
  if (item.observedStatus === ATTACHMENT_STATUS.READY) {
    repaired.size = item.actualSize;
    repaired.sha256 = item.actualSha256;
    repaired.status = ATTACHMENT_STATUS.READY;
    repaired.verifiedAt = verifiedAt;
  } else {
    repaired.status = item.observedStatus;
    repaired.verifiedAt = null;
  }
  return repaired;
}

function inspectAttachment(attachment: AttachmentIntegrityMetadata, filePath: string | null, generatedAt: string) {
  const expectedSize = Number.isInteger(Number(attachment.size)) ? Number(attachment.size) : null;
  const expectedSha256 = normalizeSha256(attachment.sha256);
  const storedStatus = normalizeAttachmentStatus(attachment.status);
  const base: AttachmentIntegrityItem = {
    attachmentId: attachment.id,
    filePath,
    expectedFileName: path.basename(String(attachment.storagePath ?? '')),
    expectedSize,
    expectedSha256,
    storedStatus,
    actualSize: null,
    actualSha256: null,
    observedStatus: ATTACHMENT_STATUS.MISSING,
    errors: [],
    warnings: []
  };

  if (!filePath) {
    base.errors.push({
      code: 'ATTACHMENT_FILE_MISSING',
      message: 'Attachment metadata has no readable file',
      attachmentId: attachment.id
    });
    return base;
  }

  const stats = fs.statSync(filePath);
  base.actualSize = stats.size;
  base.actualSha256 = sha256FileSync(filePath);
  if (expectedSha256 && expectedSha256 !== base.actualSha256) {
    base.observedStatus = ATTACHMENT_STATUS.CORRUPT;
    base.errors.push({
      code: 'ATTACHMENT_HASH_MISMATCH',
      message: 'Attachment hash does not match the file',
      attachmentId: attachment.id,
      expectedSha256,
      actualSha256: base.actualSha256
    });
    return base;
  }

  base.observedStatus = ATTACHMENT_STATUS.READY;
  if (expectedSize !== null && expectedSize !== stats.size) {
    base.warnings.push({
      code: 'ATTACHMENT_SIZE_MISMATCH',
      message: 'Attachment metadata size differs from the file',
      attachmentId: attachment.id,
      expectedSize,
      actualSize: stats.size
    });
  }
  if (!expectedSha256) {
    base.warnings.push({
      code: 'ATTACHMENT_HASH_MISSING',
      message: 'Attachment has no persisted SHA-256 hash',
      attachmentId: attachment.id
    });
  }
  if (storedStatus !== ATTACHMENT_STATUS.READY) {
    base.warnings.push({
      code: 'ATTACHMENT_STATUS_REPAIRED',
      message: 'Attachment status can be repaired from the readable file',
      attachmentId: attachment.id,
      previousStatus: storedStatus
    });
  }
  if (!attachment.verifiedAt) {
    base.warnings.push({
      code: 'ATTACHMENT_VERIFIED_AT_MISSING',
      message: 'Attachment has not recorded a successful integrity check',
      attachmentId: attachment.id,
      generatedAt
    });
  }
  return base;
}

function countStatuses(items: AttachmentIntegrityItem[]) {
  const counts: Record<AttachmentStatus | 'total' | 'repairable' | 'orphanFiles', number> = {
    total: items.length,
    ready: 0,
    missing: 0,
    corrupt: 0,
    pending: 0,
    failed: 0,
    repairable: 0,
    orphanFiles: 0
  };
  items.forEach(item => {
    counts[item.observedStatus] = (counts[item.observedStatus] ?? 0) + 1;
    if (
      item.observedStatus !== item.storedStatus ||
      (item.observedStatus === ATTACHMENT_STATUS.READY && item.warnings.length > 0)
    ) {
      counts.repairable += 1;
    }
  });
  return counts;
}

function isRegularFile(filePath: string) {
  try {
    return fs.statSync(filePath).isFile();
  } catch (error) {
    if ((error as AttachmentOperationError).code === 'ENOENT') return false;
    throw error;
  }
}

function listManagedFiles(directoryPath: string | null | undefined) {
  if (!directoryPath || !fs.existsSync(directoryPath)) return [];
  return fs
    .readdirSync(directoryPath, { withFileTypes: true })
    .filter(entry => entry.isFile())
    .map(entry => entry.name);
}
