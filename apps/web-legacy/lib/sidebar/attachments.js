export function buildAttachmentContentUrl(attachmentId) {
  if (!attachmentId) {
    return '';
  }

  return `/api/storage/attachments/${encodeURIComponent(attachmentId)}/content`;
}

export function buildAttachmentReferenceUrl(attachmentId) {
  const contentUrl = buildAttachmentContentUrl(attachmentId);
  if (!contentUrl) {
    return '';
  }

  return `${contentUrl}#attachment=${encodeURIComponent(attachmentId)}`;
}

export function extractAttachmentIdFromUrl(url = '') {
  const value = String(url ?? '').trim();
  if (!value) {
    return '';
  }

  const fromPath = extractAttachmentIdFromPath(value);
  if (!fromPath) {
    return '';
  }

  const hashFragment = extractAttachmentIdFromHash(value);
  return hashFragment || fromPath;
}

export function collectReferencedAttachmentIds(markdown = '') {
  const matches = String(markdown ?? '').matchAll(/\/api\/storage\/attachments\/[^\s)"'>]+\/content(?:#[^\s)"'>]*)?/g);
  const ids = new Set();

  for (const match of matches) {
    const attachmentId = extractAttachmentIdFromUrl(match?.[0] ?? '');
    if (!attachmentId) {
      continue;
    }
    ids.add(attachmentId);
  }

  return ids;
}

export function isAttachmentReferencedInMarkdown(attachment, markdown = '') {
  const attachmentId = attachment?.id;
  if (!attachmentId) {
    return false;
  }

  return collectReferencedAttachmentIds(markdown).has(attachmentId);
}

export function decorateAttachmentsForDisplay(attachments = [], markdown = '') {
  const referencedAttachmentIds = collectReferencedAttachmentIds(markdown);

  return attachments.map((attachment) => ({
    ...attachment,
    contentUrl: buildAttachmentContentUrl(attachment?.id),
    referenceUrl: buildAttachmentReferenceUrl(attachment?.id),
    isReferenced: referencedAttachmentIds.has(attachment?.id)
  }));
}

export function removeAttachmentReferencesFromMarkdown(markdown = '', attachmentId = '') {
  const normalizedAttachmentId = String(attachmentId ?? '').trim();
  if (!normalizedAttachmentId) {
    return String(markdown ?? '');
  }

  return String(markdown ?? '')
    .replaceAll(
      buildAttachmentMarkdownPattern('image', normalizedAttachmentId),
      ''
    )
    .replaceAll(
      buildAttachmentMarkdownPattern('link', normalizedAttachmentId),
      ''
    )
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^\n+/, '')
    .trimEnd();
}

function extractAttachmentIdFromPath(url) {
  const matched = String(url)
    .match(/\/api\/storage\/attachments\/([^/?#]+)\/content(?:$|[?#])/);

  if (!matched?.[1]) {
    return '';
  }

  try {
    return decodeURIComponent(matched[1]);
  } catch {
    return matched[1];
  }
}

function extractAttachmentIdFromHash(url) {
  const hashIndex = String(url).indexOf('#');
  if (hashIndex === -1) {
    return '';
  }

  const hash = String(url).slice(hashIndex + 1);
  const params = new URLSearchParams(hash);
  return params.get('attachment') ?? '';
}

function buildAttachmentMarkdownPattern(kind, attachmentId) {
  const encodedId = encodeURIComponent(attachmentId);
  const pathPattern = `/api/storage/attachments/${escapeRegExp(encodedId)}/content(?:#attachment=${escapeRegExp(encodedId)})?`;
  if (kind === 'image') {
    return new RegExp(`!\\[[^\\]]*\\]\\(${pathPattern}\\)`, 'g');
  }

  return new RegExp(`\\[[^\\]]*\\]\\(${pathPattern}\\)`, 'g');
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
