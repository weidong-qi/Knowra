import type { IncomingMessage } from 'node:http';
import type { ResponseWriter } from '../../../http/response.ts';
import type { createKnowledgeHttpHandlers } from './knowledge-handlers.js';
import type { createPostgresKnowledgeHttpHandlers } from './postgres-async-handlers.js';

type SpaceRouteMethods = Pick<
  ReturnType<typeof createKnowledgeHttpHandlers> | ReturnType<typeof createPostgresKnowledgeHttpHandlers>,
  | 'createKnowledgeSpace'
  | 'deleteEmptySpace'
  | 'inspectEmptySpaceDeletion'
  | 'listKnowledgeSpaces'
  | 'migrateSpaceAssets'
  | 'previewSpaceMigration'
>;
interface SpaceRouteKnowledge extends SpaceRouteMethods {
  createDefaultKnowledgeSpace: (
    body: unknown
  ) =>
    | ReturnType<ReturnType<typeof createKnowledgeHttpHandlers>['createDefaultKnowledgeSpace']>
    | ReturnType<ReturnType<typeof createPostgresKnowledgeHttpHandlers>['createDefaultKnowledgeSpace']>;
}
export interface SpaceRouteContext {
  request: IncomingMessage;
  response: ResponseWriter;
  url: URL;
  knowledge: SpaceRouteKnowledge;
}

import { parseBody, toQueryObject } from '../../../http/request.ts';
import { sendJson } from '../../../http/response.ts';
import { createAppError } from '../../../errors/app-error.ts';

function decode(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    throw createAppError('ROUTE_PARAMETER_INVALID', '空间 ID 无效。', 400);
  }
}

export async function handleSpaceRoute({ request, response, url, knowledge }: SpaceRouteContext): Promise<boolean> {
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
