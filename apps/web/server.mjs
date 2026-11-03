import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readRuntimePorts, resolveApiPort, writeRuntimePort } from '../../scripts/dev-runtime-ports.js';
import { listenOnConfiguredPort } from '../../scripts/configured-port-listener.js';
import { createV4WebServer } from './server/app.mjs';

const appRoot = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.resolve(appRoot, '../..');
const distRoot = path.join(appRoot, 'dist');
const preferredPort = Number(process.env.PORT || 3000);
const runtimePortsFile = process.env.STUDY_RUNTIME_PORTS_FILE || path.join(workspaceRoot, 'storage', 'runtime', 'dev-ports.json');
let activeWebPort = preferredPort;
const allowPortFallback = process.env.NODE_ENV !== 'production';

if (!fs.existsSync(path.join(distRoot, 'index.html'))) {
  throw new Error('V4 production assets are missing. Run `npm run build:web` before starting the web service.');
}

function getApiOrigin() {
  if (process.env.API_ORIGIN?.trim()) return process.env.API_ORIGIN.trim();
  const apiPort = resolveApiPort({
    envApiPort: process.env.API_PORT,
    runtimePorts: readRuntimePorts(runtimePortsFile),
    webPort: activeWebPort,
    fallbackPort: 3001
  });
  return `http://127.0.0.1:${apiPort}`;
}

const server = createV4WebServer({ distRoot, getApiOrigin,
  allowedOrigins: String(process.env.CORS_ALLOWED_ORIGINS || '').split(',').map(value => value.trim()).filter(Boolean),
  trustProxy: process.env.WEB_TRUST_LOOPBACK_PROXY === '1' });
listenOnConfiguredPort(server, preferredPort, { allowPortFallback })
  .then((port) => {
    activeWebPort = port;
    writeRuntimePort(runtimePortsFile, 'web', port);
    console.log(`知境·Knowra V4 web UI running at http://127.0.0.1:${port}`);
    console.log(`Proxying /api to ${getApiOrigin()}`);
  })
  .catch((error) => {
    console.error('Failed to start 知境·Knowra V4 web UI:', error.message);
    process.exitCode = 1;
  });
