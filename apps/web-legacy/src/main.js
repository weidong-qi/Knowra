import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInitialWorkspaceScript } from '../lib/workspace-loading.js';
import { readRuntimePorts, resolveApiPort, writeRuntimePort } from '../../../scripts/dev-runtime-ports.js';
import { proxyApiRequest } from './server/api-proxy.js';
import { loadInitialWorkspaceSnapshot } from './server/initial-workspace.js';
import { listenOnAvailablePort } from './server/port-listener.js';
import { renderHtml } from './server/shell-html.js';
import { canServeStaticPath, serveStaticAsset } from './server/static-assets.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const workspaceRoot = path.resolve(rootDir, '..', '..');

const preferredPort = Number(process.env.PORT || 3000);
const runtimePortsFile = process.env.STUDY_RUNTIME_PORTS_FILE || path.join(workspaceRoot, 'storage', 'runtime', 'dev-ports.json');
let activeWebPort = preferredPort;

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);

    if (['GET', 'HEAD'].includes(request.method) && url.pathname === '/') {
      const initialWorkspace = await loadInitialWorkspaceSnapshot({ getApiOrigin });
      response.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store'
      });
      response.end(request.method === 'HEAD' ? '' : renderHtml(createInitialWorkspaceScript(initialWorkspace)));
      return;
    }

    if (['GET', 'HEAD'].includes(request.method) && url.pathname === '/favicon.ico') {
      response.writeHead(204, { 'Cache-Control': 'no-store' });
      response.end();
      return;
    }

    if (url.pathname.startsWith('/api/')) {
      await proxyApiRequest({ request, response, url, getApiOrigin });
      return;
    }

    if (canServeStaticPath(url.pathname)) {
      const staticRoot = url.pathname.startsWith('/packages/web-core/dist/')
        ? workspaceRoot
        : rootDir;
      serveStaticAsset({
        pathname: url.pathname,
        rootDir: staticRoot,
        request,
        response
      });
      return;
    }

    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('Not Found');
  } catch (error) {
    response.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end(error.message);
  }
});

function getApiOrigin() {
  if (process.env.API_ORIGIN?.trim()) {
    return process.env.API_ORIGIN.trim();
  }

  const apiPort = resolveApiPort({
    envApiPort: process.env.API_PORT,
    runtimePorts: readRuntimePorts(runtimePortsFile),
    webPort: activeWebPort,
    fallbackPort: 3001
  });

  return `http://localhost:${apiPort}`;
}

listenOnAvailablePort(server, preferredPort)
  .then((port) => {
    activeWebPort = port;
    writeRuntimePort(runtimePortsFile, 'web', port);
    const suffix = port === preferredPort ? '' : ` (auto-selected from ${preferredPort})`;
    console.log(`知境·Knowra web UI running at http://localhost:${port}${suffix}`);
    console.log(`Proxying /api to ${getApiOrigin()}`);
  })
  .catch((error) => {
    console.error('Failed to start 知境·Knowra web UI:', error.message);
    process.exitCode = 1;
  });
