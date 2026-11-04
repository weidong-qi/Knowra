import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { requestBodyLimit } from '../../../packages/shared/src/http-limits.js';
import { isWriteMethod, writeOriginDecision } from '../../../packages/shared/src/http-origin.js';

export async function proxyApiRequest({
  request,
  response,
  url,
  apiOrigin,
  limitBytes,
  allowedOrigins = [],
  trustProxy = false
}) {
  const decision = isWriteMethod(request.method) ? writeOriginDecision(request, { allowedOrigins, trustProxy }) : null;
  if (decision && !decision.allowed) {
    throw Object.assign(new Error('写入请求来源不被允许'), { statusCode: 403, code: 'REQUEST_ORIGIN_FORBIDDEN' });
  }
  const upstreamUrl = new URL(url.pathname + url.search, apiOrigin);
  const bodyLimit = limitBytes ?? requestBodyLimit(request.method, url.pathname);
  if (
    url.pathname.startsWith('/api/storage/pdf-') ||
    url.pathname === '/api/sync/blob-stream' ||
    url.pathname.startsWith('/api/storage/archive')
  ) {
    const abort = new AbortController();
    const cancel = () => {
      if (!response.writableFinished) abort.abort();
    };
    request.once('aborted', cancel);
    response.once('close', cancel);
    let bodyError;
    async function* boundedBody() {
      let size = 0;
      for await (const chunk of request.iterator({ destroyOnReturn: false })) {
        size += chunk.length;
        if (size > bodyLimit) {
          bodyError = Object.assign(new Error('文件超过支持的大小'), { statusCode: 413, code: 'PAYLOAD_TOO_LARGE' });
          request.resume();
          throw bodyError;
        }
        yield chunk;
      }
    }
    try {
      const upstream = await fetch(upstreamUrl, {
        method: request.method,
        signal: abort.signal,
        headers: buildProxyHeaders(request.headers, decision?.sameOrigin ? new URL(apiOrigin).origin : null),
        ...(shouldSendBody(request.method) ? { body: Readable.from(boundedBody()), duplex: 'half' } : {})
      });
      response.writeHead(
        upstream.status,
        Object.fromEntries(
          [...upstream.headers.entries()].filter(([key]) => !['connection', 'transfer-encoding'].includes(key))
        )
      );
      if (request.method === 'HEAD' || !upstream.body) response.end();
      else await pipeline(Readable.fromWeb(upstream.body), response);
    } catch (error) {
      throw bodyError ?? error;
    } finally {
      request.off('aborted', cancel);
      response.off('close', cancel);
    }
    return;
  }
  const requestBody = await readRequestBody(request, bodyLimit);
  const upstreamResponse = await fetch(upstreamUrl, {
    method: request.method,
    headers: buildProxyHeaders(request.headers, decision?.sameOrigin ? new URL(apiOrigin).origin : null),
    body: shouldSendBody(request.method) ? requestBody : undefined
  });
  const responseBody = Buffer.from(await upstreamResponse.arrayBuffer());
  const headers = Object.fromEntries(upstreamResponse.headers.entries());
  response.writeHead(upstreamResponse.status, headers);
  response.end(responseBody);
}

function shouldSendBody(method) {
  return !['GET', 'HEAD'].includes(String(method || 'GET').toUpperCase());
}

function buildProxyHeaders(headers, sameOrigin) {
  const result = Object.fromEntries(
    Object.entries(headers || {}).filter(
      ([key, value]) =>
        Boolean(value) &&
        ![
          'host',
          'connection',
          'content-length',
          'transfer-encoding',
          'keep-alive',
          'te',
          'trailer',
          'upgrade',
          'forwarded'
        ].includes(key.toLowerCase()) &&
        !key.toLowerCase().startsWith('x-forwarded-')
    )
  );
  if (sameOrigin) result.origin = sameOrigin;
  return result;
}

function readRequestBody(request, limitBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let finished = false;
    const fail = error => {
      if (finished) return;
      finished = true;
      chunks.length = 0;
      reject(error);
    };
    request.on('data', chunk => {
      if (finished) return;
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += buffer.byteLength;
      if (size > limitBytes) {
        fail(
          Object.assign(new Error('Request body is too large'), {
            statusCode: 413,
            code: 'PAYLOAD_TOO_LARGE'
          })
        );
        return;
      }
      chunks.push(buffer);
    });
    request.on('end', () => {
      if (finished) return;
      finished = true;
      resolve(size ? Buffer.concat(chunks, size) : undefined);
      chunks.length = 0;
    });
    request.on('error', fail);
    request.on('aborted', () => fail(new Error('Request body was interrupted')));
  });
}
