import fs from 'node:fs';
import path from 'node:path';

const CONTENT_TYPES = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.html', 'text/html; charset=utf-8'],
  ['.ico', 'image/x-icon'],
  ['.jpeg', 'image/jpeg'],
  ['.jpg', 'image/jpeg'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml; charset=utf-8'],
  ['.webp', 'image/webp'],
  ['.woff', 'font/woff'],
  ['.woff2', 'font/woff2']
]);

export function serveV4Asset({ request, response, pathname, distRoot }) {
  const assetPath = resolveAssetPath(pathname, distRoot);
  if (!assetPath) return false;

  const stats = fs.statSync(assetPath);
  const etag = `W/"${stats.size}-${Math.trunc(stats.mtimeMs)}"`;
  const isEntry = path.basename(assetPath) === 'index.html';
  const isHashedAsset = assetPath.startsWith(path.join(distRoot, 'assets') + path.sep);
  const headers = {
    'Content-Type': CONTENT_TYPES.get(path.extname(assetPath).toLowerCase()) ?? 'application/octet-stream',
    'Content-Length': stats.size,
    'Cache-Control': isEntry ? 'no-store' : isHashedAsset ? 'public, max-age=31536000, immutable' : 'public, max-age=0, must-revalidate',
    ETag: etag,
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'same-origin'
  };

  if (request.headers['if-none-match'] === etag) {
    response.writeHead(304, headers);
    response.end();
    return true;
  }

  response.writeHead(200, headers);
  if (request.method === 'HEAD') {
    response.end();
    return true;
  }
  fs.createReadStream(assetPath).pipe(response);
  return true;
}

export function resolveAssetPath(pathname, distRoot) {
  let decodedPath;
  try {
    decodedPath = decodeURIComponent(pathname);
  } catch {
    return null;
  }

  const relativePath = decodedPath === '/' ? 'index.html' : decodedPath.replace(/^\/+/, '');
  const candidate = path.resolve(distRoot, relativePath);
  if (!isInside(candidate, distRoot)) return null;
  if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;

  if (!path.extname(relativePath)) {
    const entryPath = path.join(distRoot, 'index.html');
    return fs.existsSync(entryPath) ? entryPath : null;
  }
  return null;
}

function isInside(candidate, root) {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}
