import { parseBody } from '../../http/request.ts';
import { sendJson } from '../../http/response.ts';
import { createAppError } from '../../errors/app-error.ts';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { PersonalTodoService } from './service.ts';

/** GET /api/todos 返回全部未删除待办；POST /api/todos/commands 执行一条命令并返回变更记录。 */
export async function handlePersonalTodoRoute({
  request,
  response,
  url,
  service
}: {
  request: IncomingMessage;
  response: ServerResponse;
  url: URL;
  service: PersonalTodoService | null | undefined;
}): Promise<boolean> {
  if (url.pathname !== '/api/todos' && url.pathname !== '/api/todos/commands') return false;
  if (!service) throw createAppError('PERSONAL_TODOS_UNAVAILABLE', '当前存储暂不支持个人待办', 503);
  if (url.pathname === '/api/todos' && request.method === 'GET') {
    sendJson(response, 200, { data: { todos: await service.list() } });
    return true;
  }
  if (url.pathname === '/api/todos/commands' && request.method === 'POST') {
    const body = (await parseBody(request, { limitBytes: 64 * 1024 })) as { command?: unknown } | null;
    sendJson(response, 200, { data: await service.execute(body?.command) });
    return true;
  }
  throw createAppError('METHOD_NOT_ALLOWED', '不支持的请求方法', 405);
}
