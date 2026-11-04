import { parseBody, toQueryObject } from '../../../http/request.ts';
import { sendJson } from '../../../http/response.ts';

export async function handleTagRoute({ request, response, url, knowledge }) {
  if (request.method === 'POST' && url.pathname === '/api/knowledge/tags/merge') {
    const body = await parseBody(request);
    sendJson(response, 200, { data: await knowledge.mergeTags(body) });
    return true;
  }

  if (request.method === 'POST' && url.pathname === '/api/knowledge/tags/reorder') {
    const body = await parseBody(request);
    sendJson(response, 200, { data: await knowledge.reorderTags(body) });
    return true;
  }

  if (request.method === 'GET' && url.pathname === '/api/knowledge/tag-groups') {
    sendJson(response, 200, { data: await knowledge.listTagGroups(toQueryObject(url)) });
    return true;
  }

  if (request.method === 'POST' && url.pathname === '/api/knowledge/tag-groups') {
    const body = await parseBody(request);
    sendJson(response, 201, { data: await knowledge.createTagGroup(body) });
    return true;
  }

  const groupMatch = url.pathname.match(/^\/api\/knowledge\/tag-groups\/([^/]+)$/);
  if (request.method === 'PATCH' && groupMatch) {
    const body = await parseBody(request);
    sendJson(response, 200, { data: await knowledge.updateTagGroup({ id: decodeURIComponent(groupMatch[1]) }, body) });
    return true;
  }
  if (request.method === 'DELETE' && groupMatch) {
    sendJson(response, 200, { data: await knowledge.deleteTagGroup({ id: decodeURIComponent(groupMatch[1]) }) });
    return true;
  }

  if (request.method === 'POST' && url.pathname === '/api/knowledge/tags') {
    const body = await parseBody(request);
    sendJson(response, 201, {
      data: await knowledge.createTag(body)
    });
    return true;
  }

  if (request.method === 'GET' && url.pathname === '/api/knowledge/tags') {
    sendJson(response, 200, {
      data: await knowledge.listTags(toQueryObject(url))
    });
    return true;
  }

  const tagMatch = url.pathname.match(/^\/api\/knowledge\/tags\/([^/]+)$/);

  if (request.method === 'PATCH' && tagMatch) {
    const tagId = tagMatch[1];
    const body = await parseBody(request);
    sendJson(response, 200, {
      data: await knowledge.updateTag({ id: decodeURIComponent(tagId) }, body)
    });
    return true;
  }

  if (request.method === 'DELETE' && tagMatch) {
    const tagId = tagMatch[1];
    sendJson(response, 200, {
      data: await knowledge.deleteTag({ id: decodeURIComponent(tagId) })
    });
    return true;
  }

  return false;
}
