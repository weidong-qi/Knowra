export async function proxyApiRequest({ request, response, url, getApiOrigin }) {
  const upstreamUrl = new URL(url.pathname + url.search, getApiOrigin());
  const requestBody = await readRequestBody(request);
  const upstreamResponse = await fetch(upstreamUrl, {
    method: request.method,
    headers: buildProxyHeaders(request.headers),
    body: shouldSendBody(request.method) ? requestBody : undefined
  });
  const upstreamBuffer = Buffer.from(await upstreamResponse.arrayBuffer());
  const responseHeaders = Object.fromEntries(upstreamResponse.headers.entries());

  response.writeHead(upstreamResponse.status, responseHeaders);
  response.end(upstreamBuffer);
}

export function shouldSendBody(method) {
  return !['GET', 'HEAD'].includes(String(method || 'GET').toUpperCase());
}

export function buildProxyHeaders(headers) {
  const nextHeaders = {};

  Object.entries(headers || {}).forEach(([key, value]) => {
    if (!value) return;
    if (key.toLowerCase() === 'host') return;
    nextHeaders[key] = value;
  });

  return nextHeaders;
}

export function readRequestBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];

    request.on('data', (chunk) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    request.on('end', () => {
      resolve(chunks.length ? Buffer.concat(chunks) : undefined);
    });
    request.on('error', reject);
  });
}
