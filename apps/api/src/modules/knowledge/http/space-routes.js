import { parseBody, toQueryObject } from '../../../http/request.ts';
import { sendJson } from '../../../http/response.ts';
import { createAppError } from '../../../errors/app-error.js';

function decode(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    throw createAppError('ROUTE_PARAMETER_INVALID', '空间 ID 无效。', 400);
  }
}

export async function handleSpaceRoute({ request, response, url, knowledge }) {
  if (request.method === 'POST' && url.pathname === '/api/knowledge/spaces/default') {
    const body = await parseBody(request);
    sendJson(response, 201, {
      data: await knowledge.createDefaultKnowledgeSpace(body)
    });
    return true;
  }

  if (request.method === 'GET' && url.pathname === '/api/knowledge/spaces') {
    sendJson(response, 200, {
      data: await knowledge.listKnowledgeSpaces(toQueryObject(url))
    });
    return true;
  }
  if (request.method === 'POST' && url.pathname === '/api/knowledge/spaces') {
    sendJson(response, 201, { data: await knowledge.createKnowledgeSpace(await parseBody(request)) });
    return true;
  }

  const preview = url.pathname.match(/^\/api\/knowledge\/spaces\/([^/]+)\/deletion-preflight$/);
  if (request.method === 'GET' && preview) {
    sendJson(response, 200, { data: await knowledge.inspectEmptySpaceDeletion({ id: decode(preview[1]) }) });
    return true;
  }
  const migrationPreview = url.pathname.match(/^\/api\/knowledge\/spaces\/([^/]+)\/migration-preview$/);
  if (request.method === 'GET' && migrationPreview) {
    sendJson(response, 200, {
      data: await knowledge.previewSpaceMigration({ id: decode(migrationPreview[1]) }, toQueryObject(url))
    });
    return true;
  }
  const migrate = url.pathname.match(/^\/api\/knowledge\/spaces\/([^/]+)\/migrate$/);
  if (request.method === 'POST' && migrate) {
    sendJson(response, 200, {
      data: await knowledge.migrateSpaceAssets({ id: decode(migrate[1]) }, await parseBody(request))
    });
    return true;
  }
  const space = url.pathname.match(/^\/api\/knowledge\/spaces\/([^/]+)$/);
  if (request.method === 'DELETE' && space) {
    sendJson(response, 200, {
      data: await knowledge.deleteEmptySpace({ id: decode(space[1]) }, await parseBody(request))
    });
    return true;
  }

  return false;
}
