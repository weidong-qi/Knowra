import { parseBody } from '../../http/request.ts';
import { sendJson } from '../../http/response.ts';
import { fail } from './contract.js';

async function multipart(request) {
  const contentType = request.headers['content-type'];
  if (typeof contentType !== 'string' || !/^multipart\/form-data;\s*boundary=/i.test(contentType)) fail();
  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 5 * 1024 * 1024 + 16384) fail('LIMIT');
    chunks.push(chunk);
  }
  let form;
  try {
    form = await new Request('http://localhost/', {
      method: 'POST',
      headers: { 'content-type': contentType },
      body: Buffer.concat(chunks)
    }).formData();
  } catch {
    fail();
  }
  if (
    [...form.keys()].length !== 3 ||
    !['operationId', 'expectedRevision', 'file'].every(k => form.getAll(k).length === 1)
  )
    fail();
  const file = form.get('file');
  if (
    !file ||
    typeof file === 'string' ||
    typeof file.arrayBuffer !== 'function' ||
    typeof form.get('operationId') !== 'string' ||
    !/^\d+$/.test(form.get('expectedRevision'))
  )
    fail();
  return {
    operationId: form.get('operationId'),
    expectedRevision: Number(form.get('expectedRevision')),
    fileName: file.name,
    mimeType: file.type,
    bytes: Buffer.from(await file.arrayBuffer())
  };
}
export async function handleTaskWorkspaceRoute({ request, response, url, service, context }) {
  const root = '/api/task-workspaces';
  if (url.pathname !== root && !url.pathname.startsWith(`${root}/`)) return false;
  response.setHeader('Cache-Control', 'no-store');
  try {
    const ctx = typeof context === 'function' ? context(request, response) : context;
    if (!ctx || ctx.actor?.kind !== 'user') fail('FORBIDDEN');
    const parts = url.pathname.slice(root.length).split('/').filter(Boolean);
    if (
      parts.some(p => {
        try {
          return decodeURIComponent(p) !== p;
        } catch {
          return true;
        }
      })
    )
      fail();
    const [workspaceId, collection, entityId, action, attachmentId, content] = parts;
    const base = { workspaceId };
    const query = {};
    for (const key of url.searchParams.keys()) {
      if (
        !['limit', 'cursor', 'status', 'versionId', 'start', 'afterSequence'].includes(key) ||
        url.searchParams.getAll(key).length !== 1
      )
        fail();
      const value = url.searchParams.get(key);
      if (['limit', 'start', 'afterSequence'].includes(key)) {
        if (!/^\d+$/.test(value)) fail();
        query[key] = Number(value);
      } else query[key] = value;
    }
    let data;
    if (request.method === 'GET') {
      if (parts.length === 1 && workspaceId === 'capabilities') {
        if (url.search) fail();
        data = await service.capabilities(ctx);
      } else if (parts.length === 0) data = await service.listWorkspaces(ctx, query);
      else if (parts.length === 1) data = await service.getWorkspace(ctx, { ...base, ...query });
      else if (collection === 'documents' && parts.length === 2)
        data = await service.listDocuments(ctx, { ...base, ...query });
      else if (collection === 'documents' && parts.length === 3)
        data = await service.getDocument(ctx, {
          ...base,
          documentId: entityId,
          ...query
        });
      else if (collection === 'documents' && action === 'attachments' && content === 'content' && parts.length === 6) {
        if (Object.keys(query).some(k => k !== 'versionId')) fail();
        const versionId =
          query.versionId ?? (await service.getDocument(ctx, { ...base, documentId: entityId })).version.id;
        const image = await service.readAttachment(ctx, {
          ...base,
          documentId: entityId,
          attachmentId,
          versionId
        });
        service.capabilities(ctx);
        response.setHeader('Content-Type', image.mimeType);
        response.setHeader('X-Content-Type-Options', 'nosniff');
        response.setHeader('Content-Length', image.bytes.length);
        response.end(image.bytes);
        return true;
      } else if (collection === 'tasks' && parts.length === 2)
        data = await service.listTasks(ctx, { ...base, ...query });
      else if (collection === 'tasks' && parts.length === 3)
        data = await service.getTask(ctx, {
          ...base,
          taskId: entityId,
          ...query
        });
      else if (collection === 'tasks' && action === 'events' && parts.length === 4)
        data = await service.listTaskEvents(ctx, {
          ...base,
          taskId: entityId,
          ...query
        });
      else fail();
    } else if (['POST', 'PATCH'].includes(request.method)) {
      if (request.headers['x-task-workspace-epoch'] !== ctx.datasetEpoch) fail('CONFLICT');
      if (url.search) fail();
      if (request.method === 'POST' && collection === 'documents' && action === 'attachments' && parts.length === 4)
        data = await service.uploadAttachment(ctx, {
          ...(await multipart(request)),
          ...base,
          documentId: entityId
        });
      else {
        const body = await parseBody(request, { limitBytes: 1024 * 1024 });
        if (
          !body ||
          Array.isArray(body) ||
          typeof body !== 'object' ||
          [
            'workspaceId',
            'documentId',
            'taskId',
            'actor',
            'actorId',
            'ownerId',
            'pairingId',
            'datasetId',
            'datasetEpoch',
            'acceptedAt'
          ].some(k => Object.hasOwn(body, k))
        )
          fail();
        if (request.method === 'POST' && parts.length === 0) data = await service.createWorkspace(ctx, body);
        else if (request.method === 'POST' && parts.length === 2 && collection === 'archive')
          data = await service.archiveWorkspace(ctx, { ...body, ...base });
        else if (request.method === 'POST' && parts.length === 2 && collection === 'documents')
          data = await service.createDocument(ctx, { ...body, ...base });
        else if (request.method === 'PATCH' && parts.length === 3 && collection === 'documents')
          data = await service.updateDocument(ctx, {
            ...body,
            ...base,
            documentId: entityId
          });
        else if (request.method === 'POST' && parts.length === 2 && collection === 'tasks')
          data = await service.createTask(ctx, { ...body, ...base });
        else if (
          request.method === 'POST' &&
          parts.length === 4 &&
          collection === 'tasks' &&
          ['publish', 'cancel', 'review'].includes(action)
        )
          data = await service[
            {
              publish: 'publishTask',
              cancel: 'cancelTask',
              review: 'reviewSubmission'
            }[action]
          ](ctx, { ...body, ...base, taskId: entityId });
        else fail();
      }
    } else fail();
    if (ctx.guard() === false) fail('FORBIDDEN');
    service.capabilities(ctx);
    sendJson(response, 200, { data });
    return true;
  } catch (error) {
    const safe = error?.code?.startsWith('TASK_WORKSPACE_');
    sendJson(response, safe ? error.statusCode : 422, {
      error: {
        code: safe ? error.code : 'TASK_WORKSPACE_INVALID',
        message: safe ? error.message : '任务工作区请求无效。'
      }
    });
    return true;
  }
}
