import { requestBodyLimit } from '@study-accelerator/shared/http-limits';
import { parseBody, toQueryObject } from '../../http/request.ts';
import { sendJson } from '../../http/response.ts';
import { syncError } from './journal.ts';

export async function handleSyncRoute({ request, response, url, sync }) {
  if (!url.pathname.startsWith('/api/sync/')) return false;
  if (!sync) throw syncError('SYNC_UNAVAILABLE', '此运行服务尚未启用云端同步存储。', 503);
  if (request.method === 'POST' && url.pathname === '/api/sync/blob-stream') {
    let metadata;
    try {
      metadata = JSON.parse(decodeURIComponent(request.headers['x-knowra-blob'] ?? ''));
    } catch {
      throw syncError('SYNC_ATTACHMENT_INVALID', 'PDF 传输元数据无效。', 422);
    }
    sendJson(response, 200, { data: await sync.uploadBlobStream({ ...metadata, stream: request }) });
    return true;
  }
  const handlers = {
    'GET /api/sync/device': () => sync.device(toQueryObject(url)),
    'GET /api/sync/status': () => sync.status(),
    'POST /api/sync/bootstrap': async () => sync.bootstrap(await parseBody(request)),
    'GET /api/sync/operation-receipt': () => sync.operationReceipt(toQueryObject(url)),
    'GET /api/sync/snapshot': () => sync.snapshot(toQueryObject(url)),
    'POST /api/sync/snapshot-release': async () => sync.releaseSnapshot(await parseBody(request)),
    'GET /api/sync/changes': () => sync.changes(toQueryObject(url)),
    'POST /api/sync/batch': async () =>
      sync.pushBatch(await parseBody(request, { limitBytes: requestBodyLimit(request.method, url.pathname) })),
    'POST /api/sync/blobs': async () =>
      sync.uploadBlob(await parseBody(request, { limitBytes: requestBodyLimit(request.method, url.pathname) })),
    'POST /api/sync/push': async () => sync.push(await parseBody(request))
  };
  const handler = handlers[`${request.method} ${url.pathname}`];
  if (!handler) return false;
  sendJson(response, 200, { data: await handler() });
  return true;
}
