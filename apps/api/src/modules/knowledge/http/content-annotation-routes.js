import { parseBody, toQueryObject } from '../../../http/request.ts';
import { sendJson } from '../../../http/response.ts';

export async function handleContentAnnotationRoute({ request, response, url, knowledge }) {
  const root = '/api/knowledge/annotations';
  if (request.method === 'POST' && url.pathname === '/api/knowledge/analysis-scopes/preview') {
    sendJson(response, 200, { data: await knowledge.previewAnalysisScope(await parseBody(request)) });
    return true;
  }
  if (request.method === 'GET' && url.pathname === '/api/knowledge/analysis-scopes') {
    sendJson(response, 200, { data: await knowledge.listAnalysisScopes(toQueryObject(url)) });
    return true;
  }
  if (request.method === 'POST' && url.pathname === '/api/knowledge/analysis-scopes') {
    sendJson(response, 201, { data: await knowledge.createAnalysisScope(await parseBody(request)) });
    return true;
  }
  const scopeAction = url.pathname.match(/^\/api\/knowledge\/analysis-scopes\/([^/]+)\/(trash|restore)$/);
  if (request.method === 'POST' && scopeAction) {
    const method = scopeAction[2] === 'trash' ? knowledge.trashAnalysisScope : knowledge.restoreDeletedAnalysisScope;
    sendJson(response, 200, {
      data: await method({ id: decodeURIComponent(scopeAction[1]) }, await parseBody(request))
    });
    return true;
  }
  const scopeMatch = url.pathname.match(/^\/api\/knowledge\/analysis-scopes\/([^/]+)$/);
  if (request.method === 'GET' && scopeMatch) {
    sendJson(response, 200, {
      data: await knowledge.getAnalysisScope({ id: decodeURIComponent(scopeMatch[1]) }, toQueryObject(url))
    });
    return true;
  }
  if (request.method === 'POST' && url.pathname === root) {
    sendJson(response, 201, { data: await knowledge.createAnnotation(await parseBody(request)) });
    return true;
  }
  if (request.method === 'GET' && url.pathname === root) {
    sendJson(response, 200, { data: await knowledge.listAnnotations(toQueryObject(url)) });
    return true;
  }
  const exclusionMatch = url.pathname.match(/^\/api\/knowledge\/annotations\/([^/]+)\/exclusions(?:\/([^/]+))?$/);
  if (exclusionMatch) {
    const id = decodeURIComponent(exclusionMatch[1]);
    const exclusionId = exclusionMatch[2] ? decodeURIComponent(exclusionMatch[2]) : null;
    if (request.method === 'POST' && !exclusionId) {
      sendJson(response, 201, { data: await knowledge.createAnnotationExclusion({ id }, await parseBody(request)) });
      return true;
    }
    if (request.method === 'DELETE' && exclusionId) {
      sendJson(response, 200, {
        data: await knowledge.deleteAnnotationExclusion({ id, exclusionId }, await parseOptionalBody(request))
      });
      return true;
    }
  }
  const match = url.pathname.match(
    /^\/api\/knowledge\/annotations\/([^/]+)(?:\/(restore|anchor|preview|knowledge-links|confirm-range))?$/
  );
  if (!match) return false;
  const [, encodedId, action] = match;
  const id = decodeURIComponent(encodedId);
  if (request.method === 'GET' && !action) {
    sendJson(response, 200, { data: await knowledge.getAnnotation({ id }) });
    return true;
  }
  if (request.method === 'GET' && action === 'preview') {
    sendJson(response, 200, { data: await knowledge.previewAnnotation({ id }) });
    return true;
  }
  if (request.method === 'GET' && action === 'knowledge-links') {
    sendJson(response, 200, { data: await knowledge.getAnnotationKnowledgeLinks({ id }) });
    return true;
  }
  if (request.method === 'PATCH' && !action) {
    sendJson(response, 200, { data: await knowledge.updateAnnotation({ id }, await parseBody(request)) });
    return true;
  }
  if (request.method === 'DELETE' && !action) {
    sendJson(response, 200, { data: await knowledge.deleteAnnotation({ id }, await parseOptionalBody(request)) });
    return true;
  }
  if (request.method === 'POST' && action === 'restore') {
    sendJson(response, 200, { data: await knowledge.restoreAnnotation({ id }, await parseOptionalBody(request)) });
    return true;
  }
  if (request.method === 'POST' && action === 'confirm-range') {
    sendJson(response, 200, { data: await knowledge.confirmAnnotationRange({ id }, await parseBody(request)) });
    return true;
  }
  if (request.method === 'PATCH' && action === 'anchor') {
    sendJson(response, 200, { data: await knowledge.updateAnnotationAnchor({ id }, await parseBody(request)) });
    return true;
  }
  return false;
}

async function parseOptionalBody(request) {
  const length = Number(request.headers['content-length'] ?? request.headers.get?.('content-length') ?? 0);
  return length > 0 ? parseBody(request) : {};
}
