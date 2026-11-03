export const MAX_ATTACHMENT_UPLOAD_BYTES = 5 * 1024 * 1024;
export const MAX_ATTACHMENT_RESTORE_BYTES = 6 * 1024 * 1024;

// 保守扫描持久化文本；路径决定实际资源，fragment 仅是展示提示。
export function attachmentIdsInText(text) {
  if (typeof text !== 'string') return [];
  const ids = new Set();
  const pattern = /\/api\/storage\/attachments\/([^/\s\"'<>?#]+)\/content(?=$|[\s\"'<>?#)\]\}.,;])/g;
  for (const match of text.matchAll(pattern)) {
    try {
      const id = decodeURIComponent(match[1]);
      if (id && id !== '.' && id !== '..' && !/[/\\\0]/.test(id)) ids.add(id);
    } catch {
      /* 非法编码不是可访问的资源。 */
    }
  }
  return [...ids];
}

export function hasAttachmentReference(value, attachmentId, seen = new Set()) {
  if (typeof value === 'string') return attachmentIdsInText(value).includes(attachmentId);
  if (!value || typeof value !== 'object' || seen.has(value)) return false;
  seen.add(value);
  if (
    value.pdfSource?.attachmentId === attachmentId ||
    value.attachmentId === attachmentId ||
    (value.sourceType === 'attachment' && value.sourceId === attachmentId)
  )
    return true;
  return Object.values(value).some(child => hasAttachmentReference(child, attachmentId, seen));
}
