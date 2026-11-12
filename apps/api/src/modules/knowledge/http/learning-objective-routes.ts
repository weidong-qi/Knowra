import type { HttpInput } from './handler-input-types.ts';
import type { IncomingMessage } from 'node:http';
import type { ResponseWriter } from '../../../http/response.ts';
import type { createKnowledgeHttpHandlers } from './knowledge-handlers.ts';
import type { createPostgresKnowledgeHttpHandlers } from './postgres-async-handlers.ts';

type LearningObjectiveRouteKnowledge = Pick<
  ReturnType<typeof createKnowledgeHttpHandlers> | ReturnType<typeof createPostgresKnowledgeHttpHandlers>,
  | 'archiveLearningObjective'
  | 'confirmLearningObjective'
  | 'createLearningObjective'
  | 'getLearningObjective'
  | 'inspectTrainingAssetPurge'
  | 'listLearningObjectives'
  | 'listWorkspaceLearningObjectives'
  | 'permanentlyDeleteTrainingAsset'
  | 'requestLearningObjectiveRevision'
  | 'restoreDeletedTrainingAsset'
  | 'restoreLearningObjective'
  | 'trashTrainingAsset'
  | 'updateLearningObjective'
>;
export interface LearningObjectiveRouteContext {
  request: IncomingMessage;
  response: ResponseWriter;
  url: URL;
  knowledge: LearningObjectiveRouteKnowledge;
}

import { parseBody, toQueryObject } from '../../../http/request.ts';
import { sendJson } from '../../../http/response.ts';

function decode(value: string) {
  return decodeURIComponent(value);
}

export async function handleLearningObjectiveRoute({
  request,
  response,
  url,
  knowledge
}: LearningObjectiveRouteContext): Promise<boolean> {
  const nested = url.pathname.match(/^\/api\/knowledge\/items\/([^/]+)\/learning-objectives$/);
  if (nested) {
    const knowledgeItemId = decode(nested[1]);
    if (request.method === 'GET') {
      sendJson(response, 200, {
        data: await knowledge.listLearningObjectives({ ...toQueryObject(url), knowledgeItemId })
      });
      return true;
    }
    if (request.method === 'POST') {
      sendJson(response, 201, {
        data: await knowledge.createLearningObjective({
          ...((await parseBody(request)) as Record<string, unknown>),
          knowledgeItemId
        } as HttpInput)
      });
      return true;
    }
  }

  const root = '/api/knowledge/learning-objectives';
  if (request.method === 'GET' && url.pathname === root) {
    const query = toQueryObject(url);
    const data =
      query.view === 'workspace'
        ? await knowledge.listWorkspaceLearningObjectives(query)
        : await knowledge.listLearningObjectives(query);
    sendJson(response, 200, { data });
    return true;
  }
  if (request.method === 'POST' && url.pathname === root) {
    sendJson(response, 201, {
      data: await knowledge.createLearningObjective((await parseBody(request)) as HttpInput)
    });
    return true;
  }
  const lifecycle = url.pathname.match(
    /^\/api\/knowledge\/learning-objectives\/([^/]+)\/(purge-preview|trash|restore-deleted|purge)$/
  );
  if (lifecycle) {
    const params = { type: 'learningObjective', id: decode(lifecycle[1]) };
    if (request.method === 'GET' && lifecycle[2] === 'purge-preview')
      sendJson(response, 200, {
        data: await knowledge.inspectTrainingAssetPurge(
          params as Parameters<typeof knowledge.inspectTrainingAssetPurge>[0]
        )
      });
    else if (request.method === 'POST' && lifecycle[2] === 'trash')
      sendJson(response, 200, {
        data: await knowledge.trashTrainingAsset(params as Parameters<typeof knowledge.trashTrainingAsset>[0])
      });
    else if (request.method === 'POST' && lifecycle[2] === 'restore-deleted')
      sendJson(response, 200, {
        data: await knowledge.restoreDeletedTrainingAsset(
          params as Parameters<typeof knowledge.restoreDeletedTrainingAsset>[0]
        )
      });
    else if (request.method === 'POST' && lifecycle[2] === 'purge')
      sendJson(response, 200, {
        data: await knowledge.permanentlyDeleteTrainingAsset(
          params as Parameters<typeof knowledge.permanentlyDeleteTrainingAsset>[0],
          (await parseBody(request)) as HttpInput
        )
      });
    else return false;
    return true;
  }
  const action = url.pathname.match(
    /^\/api\/knowledge\/learning-objectives\/([^/]+)\/(confirm|request-revision|archive|restore)$/
  );
  if (action) {
    const params = { id: decode(action[1]) };
    const body =
      request.method === 'POST' && ['confirm', 'request-revision'].includes(action[2]) ? await parseBody(request) : {};
    if (request.method === 'POST' && action[2] === 'confirm')
      sendJson(response, 200, {
        data: await knowledge.confirmLearningObjective(
          params as Parameters<typeof knowledge.confirmLearningObjective>[0],
          body as HttpInput
        )
      });
    else if (request.method === 'POST' && action[2] === 'request-revision')
      sendJson(response, 200, {
        data: await knowledge.requestLearningObjectiveRevision(
          params as Parameters<typeof knowledge.requestLearningObjectiveRevision>[0],
          body as Parameters<LearningObjectiveRouteKnowledge['requestLearningObjectiveRevision']>[1]
        )
      });
    else if (request.method === 'POST' && action[2] === 'archive')
      sendJson(response, 200, {
        data: await knowledge.archiveLearningObjective(
          params as Parameters<typeof knowledge.archiveLearningObjective>[0]
        )
      });
    else if (request.method === 'POST' && action[2] === 'restore')
      sendJson(response, 200, {
        data: await knowledge.restoreLearningObjective(
          params as Parameters<typeof knowledge.restoreLearningObjective>[0]
        )
      });
    else return false;
    return true;
  }
  const detail = url.pathname.match(/^\/api\/knowledge\/learning-objectives\/([^/]+)$/);
  if (!detail) return false;
  const params = { id: decode(detail[1]) };
  if (request.method === 'GET')
    sendJson(response, 200, {
      data: await knowledge.getLearningObjective(params as Parameters<typeof knowledge.getLearningObjective>[0])
    });
  else if (request.method === 'PATCH')
    sendJson(response, 200, {
      data: await knowledge.updateLearningObjective(
        params as Parameters<typeof knowledge.updateLearningObjective>[0],
        (await parseBody(request)) as HttpInput
      )
    });
  else return false;
  return true;
}
