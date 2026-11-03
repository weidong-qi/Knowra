import fs from 'node:fs';
import path from 'node:path';

const STATIC_CACHE_CONTROL = 'public, max-age=0, must-revalidate';

const mimeTypes = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.js', 'application/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.svg', 'image/svg+xml; charset=utf-8']
]);

export function canServeStaticPath(pathname) {
  return (
    pathname === '/src/client.js'
    || pathname === '/src/styles.css'
    || pathname.startsWith('/src/services/')
    || pathname.startsWith('/src/controllers/')
    || pathname.startsWith('/src/app/')
    || pathname.startsWith('/src/server/')
    || pathname.startsWith('/lib/')
    || pathname.startsWith('/styles/')
    || pathname.startsWith('/packages/web-core/dist/')
  );
}

export function serveStaticAsset({ pathname, rootDir, request, response }) {
  const relativePath = pathname.replace(/^\//, '');
  const normalizedRoot = path.resolve(rootDir);
  const filePath = path.resolve(normalizedRoot, relativePath);

  if (
    filePath !== normalizedRoot
    && !filePath.startsWith(`${normalizedRoot}${path.sep}`)
  ) {
    response.writeHead(403);
    response.end('Forbidden');
    return true;
  }

  if (!fs.existsSync(filePath)) {
    response.writeHead(404);
    response.end('Not Found');
    return true;
  }

  const stat = fs.statSync(filePath);
  if (!stat.isFile()) {
    response.writeHead(404);
    response.end('Not Found');
    return true;
  }

  const ext = path.extname(filePath).toLowerCase();
  const etag = createWeakEtag(stat);
  const headers = {
    'Content-Type': mimeTypes.get(ext) || 'text/plain; charset=utf-8',
    'Content-Length': stat.size,
    'Cache-Control': STATIC_CACHE_CONTROL,
    ETag: etag,
    'Last-Modified': stat.mtime.toUTCString()
  };

  if (request?.headers?.['if-none-match'] === etag) {
    response.writeHead(304, {
      'Cache-Control': STATIC_CACHE_CONTROL,
      ETag: etag,
      'Last-Modified': headers['Last-Modified']
    });
    response.end();
    return true;
  }

  response.writeHead(200, headers);
  if (request?.method === 'HEAD') {
    response.end();
    return true;
  }

  const stream = fs.createReadStream(filePath);
  stream.on('error', (error) => response.destroy(error));
  stream.pipe(response);
  return true;
}

function createWeakEtag(stat) {
  const size = stat.size.toString(16);
  const modified = Math.trunc(stat.mtimeMs).toString(16);
  return `W/"${size}-${modified}"`;
}
