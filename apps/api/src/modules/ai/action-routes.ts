import type { IncomingMessage, ServerResponse } from 'node:http';
import type { createNoteActionService } from './action-service.js';
import type { createActionInboxMethods } from './action-inbox.js';
type ActionRoutePort = Pick<
  ReturnType<typeof createNoteActionService> & ReturnType<typeof createActionInboxMethods>,
  | 'apply'
  | 'approve'
  | 'cancel'
  | 'draft'
  | 'get'
  | 'list'
  | 'listInbox'
  | 'plan'
  | 'repreview'
  | 'revise'
  | 'undoPreview'
>;
interface ActionRouteContext {
  request: IncomingMessage;
  response: Pick<ServerResponse, 'setHeader' | 'writeHead' | 'end'>;
  url: URL;
  actions?: ActionRoutePort | null;
}

import { parseBody } from '../../http/request.ts';
import { sendJson } from '../../http/response.ts';
import { createAppError } from '../../errors/app-error.ts';

export async function handleActionRoute({ request, response, url, actions }: ActionRouteContext): Promise<boolean> {
  if (url.pathname === '/api/ai/inbox' && request.method === 'GET') {
    if (!actions) throw createAppError('AI_ACTION_UNAVAILABLE', '成果收件箱不可用。', 503);
    response.setHeader('Cache-Control', 'no-store');
    sendJson(response, 200, { data: await actions.listInbox(url.searchParams.get('spaceId')) });
    return true;
  }
  const root = '/api/ai/actions';
  if (url.pathname !== root && !url.pathname.startsWith(`${root}/`)) return false;
  if (!actions) throw createAppError('AI_ACTION_UNAVAILABLE', '笔记写入服务不可用，核心资料仍可编辑。', 503);
  response.setHeader('Cache-Control', 'no-store');
  const parts = url.pathname.slice(root.length).split('/').filter(Boolean).map(decodeURIComponent);
  if (request.method === 'GET') {
    if (!parts.length) {
      sendJson(response, 200, { data: await actions.list(url.searchParams.get('spaceId')) });
      return true;
    }
    if (parts.length === 1) {
      sendJson(response, 200, { data: await actions.get(parts[0]) });
      return true;
    }
  }
  if (request.method === 'POST') {
    if (request.headers['x-knowra-ai-action'] !== '1')
      throw createAppError('AI_REQUEST_REJECTED', '需要受信用户写入请求。', 403);
    const input = await parseBody(request, { limitBytes: 500000 });
    let result;
    if (!parts.length) result = await actions.plan(input);
    else if (parts.length === 1 && parts[0] === 'drafts') result = await actions.draft(input);
    else if (parts.length === 2) {
      const [id, operation] = parts;
      if (operation === 'approve') result = await actions.approve(id, input);
      else if (operation === 'apply') result = await actions.apply(id);
      else if (operation === 'cancel' || operation === 'reject')
        result = await actions.cancel(id, operation === 'reject');
      else if (operation === 'repreview') result = await actions.repreview(id, input);
      else if (operation === 'revise') result = await actions.revise(id, input);
      else if (operation === 'undo-preview') result = await actions.undoPreview(id, input);
    }
    if (result) {
      sendJson(response, 200, { data: result });
      return true;
    }
  }
  return false;
}
