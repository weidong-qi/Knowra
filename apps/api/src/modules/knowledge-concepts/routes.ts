import type { IncomingMessage, ServerResponse } from 'node:http';
import { parseBody } from '../../http/request.ts';
import { sendJson } from '../../http/response.ts';
import { createAppError } from '../../errors/app-error.ts';
import type { KnowledgeConceptService } from './service.ts';
export async function handleKnowledgeConceptRoute({
  request,
  response,
  url,
  service
}: {
  request: IncomingMessage;
  response: ServerResponse;
  url: URL;
  service?: KnowledgeConceptService | null;
}): Promise<boolean> {
  if (!['/api/knowledge/concepts', '/api/knowledge/concepts/commands'].includes(url.pathname)) return false;
  if (!service) throw createAppError('KNOWLEDGE_CONCEPTS_UNAVAILABLE', '当前存储暂不支持概念', 503);
  if (request.method === 'GET' && url.pathname === '/api/knowledge/concepts') {
    sendJson(response, 200, { data: await service.list() });
    return true;
  }
  if (request.method === 'POST' && url.pathname.endsWith('/commands')) {
    const body = (await parseBody(request, { limitBytes: 64 * 1024 })) as { command?: unknown } | null;
    sendJson(response, 200, { data: await service.execute(body?.command) });
    return true;
  }
  throw createAppError('METHOD_NOT_ALLOWED', '不支持的请求方法', 405);
}
