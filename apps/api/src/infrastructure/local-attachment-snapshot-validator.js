import { createAppError } from '../errors/app-error.js';
import { ATTACHMENT_STATUS } from './attachment-status.ts';
import { sanitizeFileName, sha256Buffer } from './local-attachment-store-utils.ts';

const SAFE_ATTACHMENT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/**
 * @param items
 * @param fileManager
 * @param {{expectedMetadata?: {id: string, noteId: string, fileName: string}[], noteIds?: Set<string>}} options */
export function validateAttachmentSnapshotItems(items, fileManager, { expectedMetadata, noteIds } = {}) {
  if (!Array.isArray(items)) {
    invalidAttachmentSnapshot('Attachment snapshot must be an array');
  }

  const ids = new Set();
  const preparedItems = items.map((item, index) => {
    const prepared = prepareSnapshotItem(item, index, fileManager);
    if (ids.has(prepared.id)) {
      invalidAttachmentSnapshot(`Attachment snapshot contains duplicate id: ${prepared.id}`);
    }
    if (noteIds && !noteIds.has(prepared.noteId)) {
      invalidAttachmentSnapshot(`Attachment ${prepared.id} references an unknown note`);
    }
    ids.add(prepared.id);
    return prepared;
  });

  if (expectedMetadata !== undefined) {
    validateExpectedMetadata(preparedItems, expectedMetadata);
  }
  return preparedItems;
}

function prepareSnapshotItem(item, index, fileManager) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) {
    invalidAttachmentSnapshot(`attachmentFiles[${index}] must be an object`);
  }
  if (typeof item.id !== 'string' || !SAFE_ATTACHMENT_ID_PATTERN.test(item.id)) {
    invalidAttachmentSnapshot(`attachmentFiles[${index}].id is invalid`);
  }
  if (typeof item.noteId !== 'string' || !item.noteId.trim()) {
    invalidAttachmentSnapshot(`attachmentFiles[${index}].noteId is required`);
  }
  if (typeof item.fileName !== 'string' || !item.fileName.trim()) {
    invalidAttachmentSnapshot(`attachmentFiles[${index}].fileName is required`);
  }

  const content = decodeBase64(item.contentBase64, index);
  const fileName = sanitizeFileName(item.fileName);
  const contentSha256 = sha256Buffer(content);
  if (item.sha256 && item.sha256.toLowerCase() !== contentSha256) {
    invalidAttachmentSnapshot(`attachmentFiles[${index}].sha256 does not match content`);
  }
  return {
    id: item.id,
    noteId: item.noteId,
    fileName,
    mimeType: item.mimeType || 'application/octet-stream',
    size: content.byteLength,
    sha256: contentSha256,
    status: ATTACHMENT_STATUS.READY,
    storagePath: fileManager.buildStoragePath(item.id, fileName),
    verifiedAt: item.verifiedAt || new Date().toISOString(),
    createdAt: item.createdAt || new Date().toISOString(),
    storageFileName: `${item.id}-${fileName}`,
    content
  };
}

function validateExpectedMetadata(preparedItems, expectedMetadata) {
  if (!Array.isArray(expectedMetadata)) {
    invalidAttachmentSnapshot('attachments metadata must be an array');
  }

  const expectedById = new Map(expectedMetadata.map(item => [item?.id, item]));
  if (expectedById.size !== preparedItems.length) {
    invalidAttachmentSnapshot('attachments metadata and attachmentFiles must contain the same ids');
  }

  for (const prepared of preparedItems) {
    const expected = expectedById.get(prepared.id);
    if (!expected || expected.noteId !== prepared.noteId || sanitizeFileName(expected.fileName) !== prepared.fileName) {
      invalidAttachmentSnapshot(`Attachment metadata does not match file payload: ${prepared.id}`);
    }
  }
}

function decodeBase64(value, index) {
  if (
    typeof value !== 'string' ||
    value.length % 4 !== 0 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)
  ) {
    invalidAttachmentSnapshot(`attachmentFiles[${index}].contentBase64 is invalid`);
  }

  const content = Buffer.from(value, 'base64');
  if (content.toString('base64') !== value) {
    invalidAttachmentSnapshot(`attachmentFiles[${index}].contentBase64 is invalid`);
  }
  return content;
}

function invalidAttachmentSnapshot(message) {
  throw createAppError('STORAGE_ATTACHMENT_SNAPSHOT_INVALID', message, 422);
}
