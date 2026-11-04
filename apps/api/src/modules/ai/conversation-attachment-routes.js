import { parseBody } from '../../http/request.ts';
import { sendBinary, sendJson } from '../../http/response.ts';
import { AppError, createAppError } from '../../errors/app-error.js';

const root = '/api/ai/conversations/';
const publicAttachment = record => {
  const { segments, ownerId, datasetId, datasetEpoch, spaceId, uploadKey, ...result } = record;
  return result;
};

/** 文档只返回附件信息；图片原字节仅供显式本地预览，不解析或发送模型。 */
export async function handleConversationAttachmentRoute({ request, response, url, attachments }) {
  if (!url.pathname.startsWith(root)) return false;
  const parts = url.pathname.slice(root.length).split('/');
  if (parts[1] !== 'attachments') return false;
  if (!attachments) throw createAppError('AI_ATTACHMENT_UNAVAILABLE', '对话附件服务不可用。', 503);
  response.setHeader('Cache-Control', 'no-store');
  try {
    const [conversationId, , attachmentId, operation] = parts.map(decodeURIComponent);
    if (!conversationId || parts.length > 4 || parts.some(part => !part)) {
      throw createAppError('AI_REQUEST_INVALID', '附件路径无效。', 422);
    }
    if (request.method === 'GET' && parts.length === 2) {
      const rows = await attachments.list(conversationId);
      sendJson(response, 200, { data: { attachments: rows.map(publicAttachment) } });
      return true;
    }
    if (request.method === 'GET' && parts.length === 4 && ['preview', 'content'].includes(operation)) {
      const result = await attachments.readVerified({ conversationId, attachmentId });
      if (operation === 'content') {
        if (!['image/png', 'image/jpeg'].includes(result.record.mimeType)) {
          throw createAppError('AI_ATTACHMENT_PREVIEW_UNSUPPORTED', '此附件不能作为图片预览。', 422);
        }
        sendBinary(response, 200, result.bytes, result.record.mimeType, result.record.fileName);
      } else {
        sendJson(response, 200, {
          data: { attachment: publicAttachment(result.record), segments: [], imageMetadata: null }
        });
      }
      return true;
    }
    if ((request.method === 'POST' && parts.length === 2) || (request.method === 'DELETE' && parts.length === 3)) {
      if (request.headers['x-knowra-ai-conversation'] !== '1') {
        throw createAppError('AI_REQUEST_REJECTED', '附件修改请求无效。', 403);
      }
      const input = await parseBody(request, { limitBytes: request.method === 'POST' ? 7 * 1024 * 1024 + 2048 : 1024 });
      if (!input || Array.isArray(input) || typeof input !== 'object')
        throw createAppError('AI_REQUEST_INVALID', '附件请求无效。', 422);
      let record;
      if (request.method === 'POST') {
        if (
          Object.keys(input).some(key => !['uploadKey', 'fileName', 'mimeType', 'contentBase64'].includes(key)) ||
          typeof (/** @type {Record<string, unknown>} */ (input).contentBase64) !== 'string' ||
          !(/** @type {{contentBase64: string}} */ (input).contentBase64.length) ||
          /** @type {{contentBase64: string}} */ (input).contentBase64.length > Math.ceil(5242880 / 3) * 4 ||
          /** @type {{contentBase64: string}} */ (input).contentBase64.length % 4 !== 0 ||
          /[^A-Za-z0-9+/=]/.test(/** @type {{contentBase64: string}} */ (input).contentBase64)
        ) {
          throw createAppError('AI_REQUEST_INVALID', '附件内容或字段无效。', 422);
        }
        const bytes = Buffer.from(/** @type {{contentBase64: string}} */ (input).contentBase64, 'base64');
        if (bytes.toString('base64') !== /** @type {{contentBase64: string}} */ (input).contentBase64)
          throw createAppError('AI_REQUEST_INVALID', '附件编码无效。', 422);
        record = await attachments.upload({
          conversationId,
          uploadKey: /** @type {Record<string, unknown>} */ (input).uploadKey,
          fileName: /** @type {Record<string, unknown>} */ (input).fileName,
          mimeType: /** @type {Record<string, unknown>} */ (input).mimeType,
          bytes
        });
      } else {
        if (
          Object.keys(input).some(key => key !== 'expectedRevision') ||
          !Number.isSafeInteger(/** @type {Record<string, unknown>} */ (input).expectedRevision) ||
          /** @type {number} */ (/** @type {Record<string, unknown>} */ (input).expectedRevision) < 1
        ) {
          throw createAppError('AI_REQUEST_INVALID', '附件版本无效。', 422);
        }
        record = await attachments.remove({
          conversationId,
          attachmentId,
          expectedRevision: /** @type {Record<string, unknown>} */ (input).expectedRevision
        });
      }
      sendJson(response, request.method === 'POST' ? 201 : 200, { data: { attachment: publicAttachment(record) } });
      return true;
    }
    throw createAppError('AI_REQUEST_INVALID', '不支持的附件操作。', 422);
  } catch (error) {
    if (error instanceof AppError) throw error;
    if (error instanceof URIError) throw createAppError('AI_REQUEST_INVALID', '附件路径编码无效。', 422);
    if (error.code?.startsWith('AI_')) {
      const status = ['AI_ATTACHMENT_NOT_FOUND', 'AI_CONVERSATION_NOT_FOUND'].includes(error.code)
        ? 404
        : ['AI_DATASET_STALE', 'AI_IDEMPOTENCY_CONFLICT', 'AI_ATTACHMENT_CONFLICT', 'AI_ATTACHMENT_REMOVED'].includes(
              error.code
            )
          ? 409
          : ['AI_SCOPE_FORBIDDEN'].includes(error.code)
            ? 403
            : ['AI_ATTACHMENT_UNAVAILABLE', 'AI_RUNTIME_CLOSED'].includes(error.code)
              ? 503
              : 422;
      throw createAppError(error.code, error.message, status);
    }
    throw error;
  }
}
