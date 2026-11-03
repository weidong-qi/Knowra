import { getData } from '../api-response.js';
import { buildAttachmentReferenceUrl } from '../../../lib/sidebar/attachments.js';

export function createAttachmentApi({ requestJson }) {
  async function uploadAttachmentImage(input) {
    const attachment = getData(await requestJson('/api/storage/attachments', {
      method: 'POST',
      body: JSON.stringify(input)
    }));

    if (!attachment?.id) {
      throw new Error('Image upload response is missing attachment id');
    }

    return {
      attachment,
      contentUrl: `/api/storage/attachments/${encodeURIComponent(attachment.id)}/content`,
      referenceUrl: buildAttachmentReferenceUrl(attachment.id)
    };
  }

  async function deleteAttachment(attachmentId) {
    if (!attachmentId) {
      throw new Error('Attachment id is required');
    }

    return getData(await requestJson(`/api/storage/attachments/${encodeURIComponent(attachmentId)}`, {
      method: 'DELETE'
    }));
  }

  async function renameAttachment(attachmentId, { fileName } = {}) {
    if (!attachmentId) {
      throw new Error('Attachment id is required');
    }
    if (!String(fileName ?? '').trim()) {
      throw new Error('Attachment fileName is required');
    }

    const encodedAttachmentId = encodeURIComponent(attachmentId);
    const payload = { fileName };

    try {
      return getData(await requestJson(`/api/storage/attachments/${encodedAttachmentId}`, {
        method: 'PATCH',
        body: JSON.stringify(payload)
      }));
    } catch (error) {
      const message = String(error?.message ?? '');
      if (!/route not found/i.test(message)) {
        throw error;
      }

      return getData(await requestJson(`/api/storage/attachments/${encodedAttachmentId}/rename`, {
        method: 'POST',
        body: JSON.stringify(payload)
      }));
    }
  }

  return { uploadAttachmentImage, deleteAttachment, renameAttachment };
}
