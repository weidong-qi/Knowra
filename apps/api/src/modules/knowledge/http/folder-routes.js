import { parseBody, toQueryObject } from '../../../http/request.ts';
import { sendJson } from '../../../http/response.ts';

export async function handleFolderRoute({ request, response, url, knowledge }) {
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
