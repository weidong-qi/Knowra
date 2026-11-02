import { parseBody, toQueryObject } from '../../../http/request.ts';
import { sendJson } from '../../../http/response.ts';
import { createAppError } from '../../../errors/app-error.js';

function decodeRouteId(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    throw createAppError('ROUTE_PARAMETER_INVALID', 'Route parameter is invalid', 400);
  }
}

function matchNotePath(pathname, suffix = '') {
  const escapedSuffix = suffix.replaceAll('/', '\\/');
  return pathname.match(new RegExp(`^\\/api\\/knowledge\\/notes\\/([^/]+)${escapedSuffix}$`));
}

export async function handleNoteRoute({ request, response, url, knowledge }) {
  if (request.method === 'GET' && url.pathname === '/api/knowledge/notes') {
    sendJson(response, 200, {
      data: await knowledge.listNotes(toQueryObject(url))
    });
    return true;
  }

  if (request.method === 'POST' && url.pathname === '/api/knowledge/notes') {
    const body = await parseBody(request);
    sendJson(response, 201, {
      data: await knowledge.createNote(body)
    });
    return true;
  }

  if (request.method === 'POST' && url.pathname === '/api/knowledge/notes/import-markdown') {
    const body = await parseBody(request);
    sendJson(response, 201, {
      data: await knowledge.importMarkdown(body)
    });
    return true;
  }

  if (request.method === 'POST' && url.pathname === '/api/knowledge/notes/import-markdown-batch') {
    const body = await parseBody(request);
    sendJson(response, 201, {
      data: await knowledge.importMarkdownBatch(body)
    });
    return true;
  }

  if (request.method === 'DELETE' && url.pathname === '/api/knowledge/notes/recycle-bin') {
    sendJson(response, 200, {
      data: await knowledge.emptyRecycleBin(toQueryObject(url))
    });
    return true;
  }

  if (request.method === 'POST' && url.pathname === '/api/knowledge/notes/batch/delete') {
    const body = await parseBody(request);
    sendJson(response, 200, {
      data: await knowledge.deleteNotes(body)
    });
    return true;
  }

  if (request.method === 'POST' && url.pathname === '/api/knowledge/notes/batch/tags') {
    const body = await parseBody(request);
    sendJson(response, 200, {
      data: await knowledge.assignTagToNotes(body)
    });
    return true;
  }

  if (request.method === 'PATCH' && url.pathname === '/api/knowledge/notes/batch/tags') {
    const body = await parseBody(request);
    sendJson(response, 200, { data: await knowledge.updateTagsForNotes(body) });
    return true;
  }

  const tagPathMatch = matchNotePath(url.pathname, '/tags/([^/]+)');
  if (request.method === 'DELETE' && tagPathMatch) {
    sendJson(response, 200, {
      data: await knowledge.removeTagFromNote({
        id: decodeRouteId(tagPathMatch[1]),
        tagId: decodeRouteId(tagPathMatch[2])
      })
    });
    return true;
  }

  const linksMatch = matchNotePath(url.pathname, '/links');
  const relationsMatch = matchNotePath(url.pathname, '/link-relations');
  if (request.method === 'GET' && relationsMatch) {
    sendJson(response, 200, { data: await knowledge.getNoteLinkRelations({ id: decodeRouteId(relationsMatch[1]) }) });
    return true;
  }
  if (request.method === 'GET' && linksMatch) {
    sendJson(response, 200, {
      data: await knowledge.getLinkedNotes({ id: decodeRouteId(linksMatch[1]) })
    });
    return true;
  }

  const noteMatch = matchNotePath(url.pathname);
  if (request.method === 'GET' && noteMatch) {
    sendJson(response, 200, {
      data: await knowledge.getNote({ id: decodeRouteId(noteMatch[1]) }, toQueryObject(url))
    });
    return true;
  }

  if (request.method === 'PATCH' && noteMatch) {
    const body = await parseBody(request);
    if (
      Object.hasOwn(/** @type {object} */ (body ?? {}), 'rawMarkdown') &&
      !(/** @type {{ expectedUpdatedAt?: unknown }} */ (body).expectedUpdatedAt)
    ) {
      throw createAppError('NOTE_VERSION_REQUIRED', '正文保存需要加载时的版本，请刷新客户端后重试。', 428);
    }
    sendJson(response, 200, {
      data: await knowledge.updateNote({ id: decodeRouteId(noteMatch[1]) }, body)
    });
    return true;
  }

  const permanentMatch = matchNotePath(url.pathname, '/permanent');
  if (request.method === 'DELETE' && permanentMatch) {
    sendJson(response, 200, {
      data: await knowledge.permanentlyDeleteNote({
        id: decodeRouteId(permanentMatch[1])
      })
    });
    return true;
  }

  if (request.method === 'DELETE' && noteMatch) {
    if (noteMatch[1] === 'recycle-bin') {
      return false;
    }
    sendJson(response, 200, {
      data: await knowledge.deleteNote({ id: decodeRouteId(noteMatch[1]) })
    });
    return true;
  }

  const favoriteMatch = matchNotePath(url.pathname, '/favorite');
  if (request.method === 'POST' && favoriteMatch) {
    const body = await parseBody(request);
    sendJson(response, 200, {
      data: await knowledge.setFavorite({ id: decodeRouteId(favoriteMatch[1]) }, body)
    });
    return true;
  }

  const restoreMatch = matchNotePath(url.pathname, '/restore');
  if (request.method === 'POST' && restoreMatch) {
    sendJson(response, 200, {
      data: await knowledge.restoreNote({ id: decodeRouteId(restoreMatch[1]) })
    });
    return true;
  }

  const tagsMatch = matchNotePath(url.pathname, '/tags');
  if (request.method === 'POST' && tagsMatch) {
    const body = await parseBody(request);
    sendJson(response, 200, {
      data: await knowledge.assignTagToNote({ id: decodeRouteId(tagsMatch[1]) }, body)
    });
    return true;
  }

  if (request.method === 'PUT' && tagsMatch) {
    const body = await parseBody(request);
    sendJson(response, 200, {
      data: await knowledge.setNoteTags(
        {
          id: decodeRouteId(tagsMatch[1])
        },
        body
      )
    });
    return true;
  }

  if (request.method === 'GET' && url.pathname === '/api/knowledge/search/notes') {
    sendJson(response, 200, {
      data: await knowledge.searchNotes(toQueryObject(url))
    });
    return true;
  }

  return false;
}
