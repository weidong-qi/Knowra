import { apiClient, ApiRequestError } from '@study-accelerator/web-core';
import type { ConversationAttachment, ConversationAttachmentApi, ConversationAttachmentPreview } from './ConversationAttachmentPicker';

const path = (id: string, attachmentId?: string) => `/api/ai/conversations/${encodeURIComponent(id)}/attachments${attachmentId ? `/${encodeURIComponent(attachmentId)}` : ''}`;
const headers = { 'X-Knowra-AI-Conversation': '1' };
const data = async <T>(url: string, options?: Parameters<typeof apiClient.requestJson>[1]) =>
  (await apiClient.requestJson<{ data: T }>(url, options)).data;

export const conversationAttachmentApi: ConversationAttachmentApi = {
  list: async id => (await data<{ attachments: ConversationAttachment[] }>(path(id))).attachments,
  upload: async (id, input) => (await data<{ attachment: ConversationAttachment }>(path(id), {
    method: 'POST', headers, body: JSON.stringify(input)
  })).attachment,
  preview: async (id, attachmentId) => {
    const detail = await data<ConversationAttachmentPreview>(`${path(id, attachmentId)}/preview`);
    // This batch exposes attachment information only, including for older stored records.
    return { ...detail, segments: [], imageMetadata: null };
  },
  content: async (id, attachmentId) => {
    const response = await fetch(`${path(id, attachmentId)}/content`, { cache: 'no-store', credentials: 'same-origin' });
    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      throw new ApiRequestError(payload?.error?.message ?? '图片预览失败。', { status: response.status, code: payload?.error?.code ?? null });
    }
    const blob = await response.blob();
    if (!['image/png', 'image/jpeg'].includes(blob.type)) throw new Error('图片预览返回了不支持的格式。');
    return blob;
  },
  remove: async (id, attachmentId, expectedRevision) => (await data<{ attachment: ConversationAttachment }>(path(id, attachmentId), {
    method: 'DELETE', headers, body: JSON.stringify({ expectedRevision })
  })).attachment
};
