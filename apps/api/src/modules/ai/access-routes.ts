import type { IncomingMessage, ServerResponse } from 'node:http';
import type { createAiAccessService } from './access-service.ts';
type AiAccessRoutePort = Pick<
  ReturnType<typeof createAiAccessService>,
  'createPolicy' | 'listPolicies' | 'narrowPolicy'
>;
interface AiAccessRouteContext {
  request: IncomingMessage;
  response: Pick<ServerResponse, 'setHeader' | 'writeHead' | 'end'>;
  url: URL;
  access?: AiAccessRoutePort | null;
}

import { parseBody } from '../../http/request.ts';
import { sendJson } from '../../http/response.ts';
import { AppError, createAppError } from '../../errors/app-error.ts';

/** 用户设置入口；actor/owner 只由服务端注入，模型执行桥不暴露本路由。 */
export async function handleAiAccessRoute({ request, response, url, access }: AiAccessRouteContext): Promise<boolean> {
  const root = '/api/ai/access-policies';
  if (url.pathname !== root && !url.pathname.startsWith(`${root}/`)) return false;
  response.setHeader('Cache-Control', 'no-store');
  if (!access) throw createAppError('AI_ASSISTANT_UNAVAILABLE', 'AI 授权服务不可用。', 503);
  if (request.headers['x-knowra-ai-access'] !== '1') {
    throw createAppError('AI_REQUEST_REJECTED', '授权设置请求无效。', 403);
  }
  try {
    if (request.method === 'GET' && url.pathname === root) {
      sendJson(response, 200, { data: await access.listPolicies(url.searchParams.get('spaceId')) });
      return true;
    }
    if (request.method === 'POST' && url.pathname === root) {
      sendJson(response, 201, {
        data: await access.createPolicy(
          (await parseBody(request, { limitBytes: 8192 })) as Parameters<AiAccessRoutePort['createPolicy']>[0]
        )
      });
      return true;
    }
    const match = url.pathname.match(/^\/api\/ai\/access-policies\/([^/]+)$/);
    if (request.method === 'PATCH' && match) {
      sendJson(response, 200, {
        data: await access.narrowPolicy(
          decodeURIComponent(match[1]),
          (await parseBody(request, { limitBytes: 8192 })) as Parameters<AiAccessRoutePort['narrowPolicy']>[1]
        )
      });
      return true;
    }
  } catch (error) {
    if (error instanceof AppError) throw error;
    if ((error as AppError).code?.startsWith('AI_')) {
      const status =
        (error as AppError).code === 'AI_RECORD_NOT_FOUND'
          ? 404
          : ['AI_RECORD_CONFLICT', 'AI_ACCESS_REVOKED', 'AI_DATASET_STALE', 'AI_SCOPE_EXCEEDED'].includes(
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
