import type { IncomingMessage } from 'node:http';
import type { ResponseWriter } from '../../../http/response.ts';
import type { createKnowledgeHttpHandlers } from './knowledge-handlers.js';
import type { createPostgresKnowledgeHttpHandlers } from './postgres-async-handlers.js';

type FolderRouteKnowledge = Pick<
  ReturnType<typeof createKnowledgeHttpHandlers> | ReturnType<typeof createPostgresKnowledgeHttpHandlers>,
  'createFolder' | 'deleteFolder' | 'listFolderTree' | 'listFolders' | 'restoreFolder' | 'updateFolder'
>;
export interface FolderRouteContext {
  request: IncomingMessage;
  response: ResponseWriter;
  url: URL;
  knowledge: FolderRouteKnowledge;
}

import { parseBody, toQueryObject } from '../../../http/request.ts';
import { sendJson } from '../../../http/response.ts';

export async function handleFolderRoute({ request, response, url, knowledge }: FolderRouteContext): Promise<boolean> {
  if (request.method === 'POST' && url.pathname === '/api/knowledge/folders') {
    const body = await parseBody(request);
    sendJson(response, 201, {
      data: await knowledge.createFolder(body)
    });
    return true;
  }

  if (request.method === 'GET' && url.pathname === '/api/knowledge/folders') {
    sendJson(response, 200, {
      data: await knowledge.listFolders(toQueryObject(url))
    });
    return true;
  }

  if (request.method === 'GET' && url.pathname === '/api/knowledge/folders/tree') {
    sendJson(response, 200, {
      data: await knowledge.listFolderTree(toQueryObject(url))
    });
    return true;
  }

  const folderMatch = url.pathname.match(/^\/api\/knowledge\/folders\/([^/]+)$/);

  if (request.method === 'PATCH' && folderMatch) {
    const folderId = folderMatch[1];
    const body = await parseBody(request);
    sendJson(response, 200, {
      data: await knowledge.updateFolder({ id: decodeURIComponent(folderId) }, body)
    });
    return true;
  }

  const restoreMatch = url.pathname.match(/^\/api\/knowledge\/folders\/([^/]+)\/restore$/);
  if (request.method === 'POST' && restoreMatch) {
    sendJson(response, 200, { data: await knowledge.restoreFolder({ id: decodeURIComponent(restoreMatch[1]) }) });
    return true;
  }

  if (request.method === 'DELETE' && folderMatch) {
    const folderId = folderMatch[1];
    sendJson(response, 200, {
      data: await knowledge.deleteFolder({ id: decodeURIComponent(folderId) }, await parseBody(request))
    });
    return true;
  }

  return false;
}
