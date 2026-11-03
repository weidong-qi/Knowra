import type { IncomingMessage, ServerResponse } from 'node:http';
import type { createPdfService } from './service.ts';
import type { PdfMutationInput } from './contracts.ts';
interface PdfRouteContext {
  request: IncomingMessage;
  response: ServerResponse;
  url: URL;
  pdf?: ReturnType<typeof createPdfService> | null;
}
import fs from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { parseBody } from '../../http/request.ts';
import { sendJson } from '../../http/response.ts';
import { assertReadableStatus } from '../../infrastructure/attachment-recovery.ts';
import { parseByteRange } from './files.ts';

export async function handlePdfRoute({ request, response, url, pdf }: PdfRouteContext) {
  if (!pdf) return false;
  if (url.pathname === '/api/storage/archive' && request.method === 'GET') {
    response.setHeader('Content-Type', 'application/zip');
    response.setHeader('Content-Disposition', 'attachment; filename="Knowra-backup.zip"');
    response.setHeader('Cache-Control', 'no-store');
    await pdf.archive.export(response);
    return true;
  }
  if (url.pathname === '/api/storage/archive/inspect' && request.method === 'POST') {
    sendJson(response, 200, {
      data: await (String(request.headers['content-type']).includes('application/json')
        ? pdf.archive.inspectLegacy(await parseBody(request))
        : pdf.archive.inspect(request))
    });
    return true;
  }
  if (url.pathname === '/api/storage/archive/restore' && request.method === 'POST') {
    const input = (await parseBody(request)) as { token?: string; confirmToken?: string };
    if (input.confirmToken !== input.token) return false;
    sendJson(response, 200, { data: await pdf.archive.restore(input.token ?? '') });
    return true;
  }
  const discard = /^\/api\/storage\/archive\/([a-f0-9-]{36})$/.exec(url.pathname);
  if (discard && request.method === 'DELETE') {
    pdf.archive.cancel(discard[1]);
    sendJson(response, 200, { data: { discarded: true } });
    return true;
  }
  const backup = /^\/api\/storage\/archive\/backups\/([^/]+)$/.exec(url.pathname);
  if (backup && request.method === 'GET') {
    const source = pdf.archive.backupFile(backup[1]);
    response.writeHead(200, {
      'Content-Type': 'application/zip',
      'Content-Disposition': 'attachment; filename="Knowra-before-restore.zip"'
    });
    await pipeline(fs.createReadStream(source), response);
    return true;
  }
  if (url.pathname === '/api/storage/pdf-imports' && request.method === 'POST') {
    sendJson(response, 201, { data: await pdf.importPdf(Object.fromEntries(url.searchParams), request) });
    return true;
  }
  const regularFile = /^\/api\/storage\/attachments\/([^/]+)\/content$/.exec(url.pathname);
  if (regularFile && !(await pdf.isPdfFile(decodeURIComponent(regularFile[1])))) return false;
  const file = regularFile ?? /^\/api\/storage\/pdf-files\/([^/]+)$/.exec(url.pathname);
  if (file) {
    const id = decodeURIComponent(file[1]);
    if (request.method === 'PUT') {
      sendJson(response, 200, { data: await pdf.restore(id, request) });
      return true;
    }
    if (!['GET', 'HEAD'].includes(request.method ?? '')) return false;
    const attachment = await pdf.requireAttachment(id);
    assertReadableStatus(attachment);
    const source = await pdf.files.inspect(attachment);
    const etag = `"${attachment.sha256}"`;
    let range;
    try {
      range = parseByteRange(
        !request.headers['if-range'] || request.headers['if-range'] === etag ? request.headers.range : null,
        attachment.size
      );
    } catch (error) {
      response.setHeader('Content-Range', `bytes */${attachment.size}`);
      throw error;
    }
    response.writeHead(range ? 206 : 200, {
      'Content-Type': 'application/pdf',
      'X-Content-Type-Options': 'nosniff',
      'Accept-Ranges': 'bytes',
      ETag: etag,
      'Cache-Control': 'private, no-cache',
      'Content-Disposition': `${regularFile ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(attachment.fileName)}`,
      'Content-Length': range ? range.end - range.start + 1 : attachment.size,
      ...(range ? { 'Content-Range': `bytes ${range.start}-${range.end}/${attachment.size}` } : {})
    });
    if (request.method === 'HEAD') response.end();
    else await pipeline(fs.createReadStream(source, range ?? {}), response);
    return true;
  }
  const match = /^\/api\/pdf\/([^/]+)\/annotations(?:\/([^/]+))?$/.exec(url.pathname);
  if (!match) return false;
  const noteId = decodeURIComponent(match[1]);
  if (request.method === 'GET' && !match[2]) sendJson(response, 200, { data: await pdf.list(noteId) });
  else if (['PUT', 'DELETE'].includes(request.method ?? '') && match[2])
    sendJson(response, 200, {
      data: await pdf.mutate(
        noteId,
        decodeURIComponent(match[2]),
        (await parseBody(request)) as PdfMutationInput,
        request.method === 'DELETE'
      )
    });
  else return false;
  return true;
}
