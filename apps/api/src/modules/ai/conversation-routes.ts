import type { IncomingMessage, ServerResponse } from 'node:http';
import type { createAiConversationService } from './conversation-service.js';
type ConversationRoutePort = Pick<
  ReturnType<typeof createAiConversationService>,
  | 'cancel'
  | 'create'
  | 'get'
  | 'legacyGet'
  | 'legacyList'
  | 'list'
  | 'messages'
  | 'resume'
  | 'retry'
  | 'submit'
  | 'turn'
>;
interface ConversationRouteContext {
  request: IncomingMessage;
  response: Pick<ServerResponse, 'setHeader' | 'writeHead' | 'end'>;
  url: URL;
  conversation?: ConversationRoutePort | null;
}

import { parseBody } from '../../http/request.ts';
import { sendJson } from '../../http/response.ts';
import { AppError, createAppError } from '../../errors/app-error.ts';

export async function handleConversationRoute({
  request,
  response,
  url,
  conversation
}: ConversationRouteContext): Promise<boolean> {
  const root = '/api/ai/conversations';
  if (url.pathname !== root && !url.pathname.startsWith(`${root}/`)) return false;
  if (!conversation) throw createAppError('AI_CONVERSATION_UNAVAILABLE', '会话服务不可用。', 503);
  response.setHeader('Cache-Control', 'no-store');
  const parts = url.pathname.slice(root.length).split('/').filter(Boolean).map(decodeURIComponent);
  try {
    if (request.method === 'GET') {
      if (!parts.length) {
        sendJson(response, 200, { data: await conversation.list(url.searchParams.get('spaceId')) });
        return true;
      }
      if (parts[0] === 'legacy-jobs' && parts.length === 1) {
        sendJson(response, 200, { data: await conversation.legacyList(url.searchParams.get('spaceId')) });
        return true;
      }
      if (parts[0] === 'legacy-jobs' && parts.length === 2) {
        sendJson(response, 200, { data: await conversation.legacyGet(parts[1]) });
        return true;
      }
      if (parts.length === 1) {
        sendJson(response, 200, { data: await conversation.get(parts[0]) });
        return true;
      }
      if (parts.length === 2 && parts[1] === 'messages') {
        sendJson(response, 200, {
          data: await conversation.messages(
            parts[0],
            Number(url.searchParams.get('afterSequence') ?? 0),
            Number(url.searchParams.get('limit') ?? 50)
          )
        });
        return true;
      }
      if (parts.length === 3 && parts[1] === 'turns') {
        sendJson(response, 200, { data: await conversation.turn(parts[0], parts[2]) });
        return true;
      }
    }
    if (request.method === 'POST') {
      if (request.headers['x-knowra-ai-conversation'] !== '1') {
        throw createAppError('AI_REQUEST_REJECTED', '会话请求无效。', 403);
      }
      if (!parts.length) {
        sendJson(response, 201, { data: await conversation.create(await parseBody(request, { limitBytes: 2048 })) });
        return true;
      }
      if (parts.length === 2 && parts[1] === 'messages') {
        sendJson(response, 202, {
          data: await conversation.submit(parts[0], await parseBody(request, { limitBytes: 125000 }))
        });
        return true;
      }
      if (parts.length === 4 && parts[1] === 'turns' && parts[3] === 'cancel') {
        sendJson(response, 200, { data: await conversation.cancel(parts[0], parts[2]) });
        return true;
      }
      if (parts.length === 4 && parts[1] === 'turns' && parts[3] === 'resume') {
        sendJson(response, 202, { data: await conversation.resume(parts[0], parts[2]) });
        return true;
      }
      if (parts.length === 4 && parts[1] === 'turns' && parts[3] === 'retry') {
        sendJson(response, 202, { data: await conversation.retry(parts[0], parts[2]) });
        return true;
      }
    }
  } catch (error) {
    if (error instanceof AppError) throw error;
    if ((error as AppError).code?.startsWith('AI_')) {
      const status = ['AI_CONVERSATION_NOT_FOUND', 'AI_TURN_NOT_FOUND', 'AI_JOB_NOT_FOUND'].includes(
        (error as AppError).code
      )
        ? 404
        : ['AI_IDEMPOTENCY_CONFLICT', 'AI_TURN_ACTIVE', 'AI_TURN_CONFLICT', 'AI_DATASET_STALE'].includes(
              (error as AppError).code
            )
          ? 409
          : (error as AppError).code === 'AI_SCOPE_FORBIDDEN'
            ? 403
            : 422;
      throw createAppError((error as AppError).code, (error as AppError).message, status);
    }
    throw error;
  }
  return false;
}
