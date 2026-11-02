import { createAppError } from '../errors/app-error.js';

import { DEFAULT_JSON_BODY_LIMIT_BYTES } from '@study-accelerator/shared/http-limits';
export { DEFAULT_JSON_BODY_LIMIT_BYTES } from '@study-accelerator/shared/http-limits';

function createRequestError(message, statusCode = 400, code = 'VALIDATION_ERROR') {
  return createAppError(code, message, statusCode);
}

export function parseBody(request, { limitBytes = DEFAULT_JSON_BODY_LIMIT_BYTES } = {}) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let receivedBytes = 0;
    let finished = false;
    const contentType = request.headers['content-type'] ?? '';

    function fail(error) {
      if (finished) return;
      finished = true;
      chunks.length = 0;
      reject(error);
    }

    request.on('data', (chunk) => {
      if (finished) return;
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      receivedBytes += buffer.byteLength;
      if (receivedBytes > limitBytes) {
        // Keep draining without retaining bytes so the 413 response can reach the client.
        fail(createRequestError('Request body is too large', 413, 'PAYLOAD_TOO_LARGE'));
        return;
      }
      chunks.push(buffer);
    });
    request.on('end', () => {
      if (finished) return;
      const data = Buffer.concat(chunks, receivedBytes).toString('utf8');
      chunks.length = 0;
      if (!data) {
        finished = true;
        resolve({});
        return;
      }
      if (typeof contentType !== 'string' || contentType.split(';', 1)[0].trim().toLowerCase() !== 'application/json') {
        fail(createRequestError('Content-Type must be application/json', 415, 'UNSUPPORTED_MEDIA_TYPE'));
        return;
      }

      try {
        const body = JSON.parse(data);
        finished = true;
        resolve(body);
      } catch (error) {
        fail(createRequestError('Invalid JSON body'));
      }
    });
    request.on('error', fail);
    request.on('aborted', () => fail(createRequestError('Request body was interrupted')));
  });
}

export function toQueryObject(url) {
  return Object.fromEntries(url.searchParams.entries());
}
