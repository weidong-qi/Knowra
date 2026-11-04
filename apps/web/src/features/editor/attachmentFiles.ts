import { hasAttachmentReference, MAX_ATTACHMENT_RESTORE_BYTES } from '@study-accelerator/web-core';
import type { Attachment, UploadAttachmentInput } from '@study-accelerator/web-core';

export const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;
export const INLINE_IMAGE_ACCEPT = '.avif,.gif,.jpeg,.jpg,.png,.webp';

const INLINE_IMAGE_MIME_TYPES = new Set([
  'image/avif',
  'image/gif',
  'image/jpeg',
  'image/png',
  'image/webp'
]);

export function buildAttachmentContentUrl(attachmentId: string): string {
  return `/api/storage/attachments/${encodeURIComponent(attachmentId)}/content`;
}

export function buildAttachmentReferenceUrl(attachmentId: string): string {
  return `${buildAttachmentContentUrl(attachmentId)}#attachment=${encodeURIComponent(attachmentId)}`;
}

export function isAttachmentReferenced(markdown: string, attachmentId: string): boolean {
  return hasAttachmentReference(markdown, attachmentId);
}

export function formatAttachmentSize(bytes: number): string {
  const value = Number.isFinite(bytes) ? Math.max(0, bytes) : 0;
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(value < 10 * 1024 ? 1 : 0)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

export function attachmentImageAlt(attachment: Attachment): string {
  return attachment.fileName.replace(/[\[\]]/g, '').trim() || '笔记图片';
}

export function isInlineImageAttachment(attachment: Attachment): boolean {
  return INLINE_IMAGE_MIME_TYPES.has(String(attachment.mimeType || '').toLowerCase());
}

export function assertInlineImageFile(file: File): void {
  if (!INLINE_IMAGE_MIME_TYPES.has(file.type.toLowerCase())) {
    throw new Error('正文图片仅支持 PNG、JPEG、GIF、WebP 或 AVIF 格式');
  }
}

export async function readAttachmentFile(noteId: string, file: File): Promise<UploadAttachmentInput> {
  if (!noteId) throw new Error('请先打开一篇笔记');
  if (!(file instanceof File)) throw new Error('请选择要上传的文件');
  if (file.size > MAX_ATTACHMENT_BYTES) throw new Error('单个附件不能超过 5 MB');
  if (file.size === 0) throw new Error('不能上传空文件');
  return {
    noteId,
    fileName: file.name || 'attachment',
    mimeType: file.type || 'application/octet-stream',
    contentBase64: await fileToBase64(file)
  };
}

export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result !== 'string') {
        reject(new Error('文件读取失败'));
        return;
      }
      const separator = reader.result.indexOf(',');
      resolve(separator >= 0 ? reader.result.slice(separator + 1) : reader.result);
    };
    reader.onerror = () => reject(reader.error ?? new Error('文件读取失败'));
    reader.readAsDataURL(file);
  });
}

export async function readRestoreFile(attachment: Attachment, file: File): Promise<string> {
  if (!/^[a-f0-9]{64}$/i.test(attachment.sha256 ?? '')) throw new Error('缺少可信原哈希，不能恢复原附件');
  if (file.size > MAX_ATTACHMENT_RESTORE_BYTES) throw new Error('原文件恢复不能超过 6 MB');
  if (file.size !== attachment.size) throw new Error('所选文件大小与原附件不一致');
  return fileToBase64(file);
}
