import type { HttpInput } from './handler-input-types.ts';
import type { IncomingMessage } from 'node:http';
import type { ResponseWriter } from '../../../http/response.ts';
import type { createKnowledgeHttpHandlers } from './knowledge-handlers.ts';
import type { createPostgresKnowledgeHttpHandlers } from './postgres-async-handlers.ts';
type KnowledgeItemRouteKnowledge = Pick<
  ReturnType<typeof createKnowledgeHttpHandlers> | ReturnType<typeof createPostgresKnowledgeHttpHandlers>,
  | 'archiveKnowledgeItem'
  | 'confirmKnowledgeItem'
  | 'createKnowledgeEvidence'
  | 'createKnowledgeItem'
  | 'getKnowledgeItem'
  | 'getKnowledgeProvenance'
  | 'inspectKnowledgePurge'
  | 'listKnowledgeEvidence'
  | 'listKnowledgeItems'
  | 'listWorkspaceKnowledgeItems'
  | 'markKnowledgeItemNeedsRevision'
  | 'permanentlyDeleteKnowledgeItem'
  | 'readoptKnowledgeEvidence'
  | 'restoreDeletedKnowledgeItem'
  | 'restoreKnowledgeItem'
  | 'retireKnowledgeEvidence'
  | 'trashKnowledgeItem'
  | 'updateKnowledgeItem'
>;
export interface KnowledgeItemRouteContext {
  request: IncomingMessage;
  response: ResponseWriter;
  url: URL;
  knowledge: KnowledgeItemRouteKnowledge;
}

import { parseBody, toQueryObject } from '../../../http/request.ts';
import { sendJson } from '../../../http/response.ts';
import { createAppError } from '../../../errors/app-error.ts';

function decode(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    throw createAppError('ROUTE_PARAMETER_INVALID', 'Route parameter is invalid', 400);
  }
}

async function parseKnowledgeInput(request: IncomingMessage) {
  const body = await parseBody(request);
  if ((body as { sourceMode?: unknown } | null | undefined)?.sourceMode === 'ai') {
    throw createAppError(
      'KNOWLEDGE_ITEM_AI_SOURCE_RESERVED',
      'AI 来源只能由经过校验的提炼结果接纳，不能手动声明。',
      422
    );
  }
  return body;
}

export async function handleKnowledgeItemRoute({
  request,
  response,
  url,
  knowledge
}: KnowledgeItemRouteContext): Promise<boolean> {
  const root = '/api/knowledge/items';
  if (request.method === 'GET' && url.pathname === root) {
    const query = toQueryObject(url);
    const data =
      query.view === 'workspace'
        ? await knowledge.listWorkspaceKnowledgeItems(query)
        : await knowledge.listKnowledgeItems(query);
    sendJson(response, 200, { data });
    return true;
  }
  if (request.method === 'POST' && url.pathname === root) {
    sendJson(response, 201, {
      data: await knowledge.createKnowledgeItem((await parseKnowledgeInput(request)) as HttpInput)
    });
    return true;
  }

  const evidenceActionMatch = url.pathname.match(
    /^\/api\/knowledge\/items\/([^/]+)\/evidence\/([^/]+)\/(retire|readopt)$/
  );
  if (evidenceActionMatch && request.method === 'POST') {
    sendJson(response, 200, {
      data: await (
        evidenceActionMatch[3] === 'retire' ? knowledge.retireKnowledgeEvidence : knowledge.readoptKnowledgeEvidence
      )(
        {
          id: decode(evidenceActionMatch[1]),
          evidenceId: decode(evidenceActionMatch[2])
        },
        (await parseBody(request)) as HttpInput
      )
    });
    return true;
  }

  const actionMatch = url.pathname.match(
    /^\/api\/knowledge\/items\/([^/]+)\/(confirm|needs-revision|archive|restore|trash|restore-deleted|purge-preview|permanent|evidence|provenance)$/
  );
  if (actionMatch) {
    const id = decode(actionMatch[1]);
    const action = actionMatch[2];
    if (action === 'provenance' && request.method === 'GET') {
      sendJson(response, 200, { data: await knowledge.getKnowledgeProvenance({ id }) });
      return true;
    }
    if (action === 'purge-preview' && request.method === 'GET') {
      sendJson(response, 200, { data: await knowledge.inspectKnowledgePurge({ id }) });
      return true;
    }
    if (action === 'permanent' && request.method === 'DELETE') {
      sendJson(response, 200, {
        data: await knowledge.permanentlyDeleteKnowledgeItem({ id }, (await parseBody(request)) as HttpInput)
      });
      return true;
    }
    if (action === 'evidence' && request.method === 'GET') {
      sendJson(response, 200, { data: await knowledge.listKnowledgeEvidence({ id }) });
      return true;
    }
    if (action === 'evidence' && request.method === 'POST') {
      sendJson(response, 201, {
        data: await knowledge.createKnowledgeEvidence({ id }, (await parseBody(request)) as HttpInput)
      });
      return true;
    }
    if (request.method === 'POST' && action === 'confirm') {
      sendJson(response, 200, {
        data: await knowledge.confirmKnowledgeItem({ id }, (await parseBody(request)) as HttpInput)
      });
      return true;
    }
    if (request.method === 'POST' && action === 'needs-revision') {
      sendJson(response, 200, {
        data: await knowledge.markKnowledgeItemNeedsRevision({ id }, (await parseBody(request)) as HttpInput)
      });
      return true;
    }
    if (request.method === 'POST' && action === 'archive') {
      sendJson(response, 200, {
        data: await knowledge.archiveKnowledgeItem({ id }, (await parseBody(request)) as HttpInput)
      });
      return true;
    }
    if (request.method === 'POST' && action === 'restore') {
      sendJson(response, 200, {
        data: await knowledge.restoreKnowledgeItem({ id }, (await parseBody(request)) as HttpInput)
      });
      return true;
    }
    if (request.method === 'POST' && action === 'trash') {
      sendJson(response, 200, {
        data: await knowledge.trashKnowledgeItem({ id }, (await parseBody(request)) as HttpInput)
      });
      return true;
    }
    if (request.method === 'POST' && action === 'restore-deleted') {
      sendJson(response, 200, {
        data: await knowledge.restoreDeletedKnowledgeItem({ id }, (await parseBody(request)) as HttpInput)
      });
      return true;
    }
    return false;
  }

  const detailMatch = url.pathname.match(/^\/api\/knowledge\/items\/([^/]+)$/);
  if (!detailMatch) return false;
  const id = decode(detailMatch[1]);
  if (request.method === 'GET') {
    sendJson(response, 200, { data: await knowledge.getKnowledgeItem({ id }) });
    return true;
  }
  if (request.method === 'PATCH') {
    sendJson(response, 200, {
      data: await knowledge.updateKnowledgeItem({ id }, (await parseKnowledgeInput(request)) as HttpInput)
    });
    return true;
  }
  return false;
}
