import type { Attachment } from '@study-accelerator/web-core';
import { buildAttachmentContentUrl } from './attachmentFiles';

export async function fetchAttachmentBlob(id: string): Promise<Blob> {
  const response = await fetch(buildAttachmentContentUrl(id), { credentials: 'same-origin' });
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(payload?.error?.message ?? `附件读取失败（${response.status}）`);
  }
  return response.blob();
}

export async function downloadAttachment(attachment: Attachment): Promise<string | null> {
  if (window.knowraDesktop?.downloadAttachment) return window.knowraDesktop.downloadAttachment(attachment.id);
  const blob = await fetchAttachmentBlob(attachment.id);
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = attachment.fileName;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  return null;
}
