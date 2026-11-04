import { parseBody, toQueryObject } from '../../../http/request.ts';
import { sendJson } from '../../../http/response.ts';

function decode(value) {
  return decodeURIComponent(value);
}

export async function handleLearningObjectiveRoute({ request, response, url, knowledge }) {
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
          .../** @type {Record<string, unknown>} */ (await parseBody(request)),
          knowledgeItemId
        })
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
    sendJson(response, 201, { data: await knowledge.createLearningObjective(await parseBody(request)) });
    return true;
  }
  const lifecycle = url.pathname.match(
    /^\/api\/knowledge\/learning-objectives\/([^/]+)\/(purge-preview|trash|restore-deleted|purge)$/
  );
  if (lifecycle) {
    const params = { type: 'learningObjective', id: decode(lifecycle[1]) };
    if (request.method === 'GET' && lifecycle[2] === 'purge-preview')
      sendJson(response, 200, { data: await knowledge.inspectTrainingAssetPurge(params) });
    else if (request.method === 'POST' && lifecycle[2] === 'trash')
      sendJson(response, 200, { data: await knowledge.trashTrainingAsset(params) });
    else if (request.method === 'POST' && lifecycle[2] === 'restore-deleted')
      sendJson(response, 200, { data: await knowledge.restoreDeletedTrainingAsset(params) });
    else if (request.method === 'POST' && lifecycle[2] === 'purge')
      sendJson(response, 200, {
        data: await knowledge.permanentlyDeleteTrainingAsset(params, await parseBody(request))
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
      sendJson(response, 200, { data: await knowledge.confirmLearningObjective(params, body) });
    else if (request.method === 'POST' && action[2] === 'request-revision')
      sendJson(response, 200, { data: await knowledge.requestLearningObjectiveRevision(params, body) });
    else if (request.method === 'POST' && action[2] === 'archive')
      sendJson(response, 200, { data: await knowledge.archiveLearningObjective(params) });
    else if (request.method === 'POST' && action[2] === 'restore')
      sendJson(response, 200, { data: await knowledge.restoreLearningObjective(params) });
    else return false;
    return true;
  }
  const detail = url.pathname.match(/^\/api\/knowledge\/learning-objectives\/([^/]+)$/);
  if (!detail) return false;
  const params = { id: decode(detail[1]) };
  if (request.method === 'GET') sendJson(response, 200, { data: await knowledge.getLearningObjective(params) });
  else if (request.method === 'PATCH')
    sendJson(response, 200, { data: await knowledge.updateLearningObjective(params, await parseBody(request)) });
  else return false;
  return true;
}
