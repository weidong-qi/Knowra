import fs from 'node:fs';
import path from 'node:path';
import { ATTACHMENT_STATUS, normalizeAttachmentStatus } from './attachment-status.ts';
import { normalizeSha256 } from './attachment-record-reconciliation.ts';
import { sha256FileSync } from './local-attachment-store-utils.js';

/** @param {{attachments?: {id: string, storagePath?: string, size?: number, sha256?: string, status?: string, verifiedAt?: string}[], fileManager?: ReturnType<typeof import('./local-attachment-file-manager.js').createLocalAttachmentFileManager>, generatedAt?: string}} options */
export function inspectAttachmentIntegrity({
  attachments = [],
  fileManager,
  generatedAt = new Date().toISOString()
} = {}) {
  if (!fileManager?.getAttachmentCandidatePaths) {
    throw new TypeError('Attachment integrity inspection requires a file manager');
  }

  const errors = [];
  const warnings = [];
  const items = [];
  const expectedFileNames = new Set();

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

export function buildAttachmentRepairRecord(attachment, item, { verifiedAt = new Date().toISOString() } = {}) {
  const repaired = { ...attachment };
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

function inspectAttachment(attachment, filePath, generatedAt) {
  const expectedSize = Number.isInteger(Number(attachment.size)) ? Number(attachment.size) : null;
  const expectedSha256 = normalizeSha256(attachment.sha256);
  const storedStatus = normalizeAttachmentStatus(attachment.status);
  const base = {
    attachmentId: attachment.id,
    filePath,
    expectedFileName: path.basename(String(attachment.storagePath ?? '')),
    expectedSize,
    expectedSha256,
    storedStatus,
    actualSize: null,
    actualSha256: null,
    observedStatus: /** @type {import('./attachment-status.ts').AttachmentStatus} */ (ATTACHMENT_STATUS.MISSING),
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

function countStatuses(items) {
  const counts = {
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

function isRegularFile(filePath) {
  try {
    return fs.statSync(filePath).isFile();
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

function listManagedFiles(directoryPath) {
  if (!directoryPath || !fs.existsSync(directoryPath)) return [];
  return fs
    .readdirSync(directoryPath, { withFileTypes: true })
    .filter(entry => entry.isFile())
    .map(entry => entry.name);
}
