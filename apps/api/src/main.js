import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPersistentAppContext } from './app.factory.ts';
import { createServer } from './server.js';
import { parseCorsAllowedOrigins } from './http/cors.ts';
import { writeRuntimePort } from '../../../scripts/dev-runtime-ports.js';
import { listenOnConfiguredPort } from '../../../scripts/configured-port-listener.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const workspaceRoot = path.resolve(__dirname, '..', '..', '..');

const app = await createPersistentAppContext();
const server = createServer({
  appContext: app,
  cors: {
    allowedOrigins: parseCorsAllowedOrigins(process.env.CORS_ALLOWED_ORIGINS)
  }
});
const preferredPort = Number(process.env.PORT || 3001);
const runtimePortsFile =
  process.env.STUDY_RUNTIME_PORTS_FILE || path.join(workspaceRoot, 'storage', 'runtime', 'dev-ports.json');
const allowPortFallback = process.env.NODE_ENV !== 'production';

listenOnConfiguredPort(server, preferredPort, { allowPortFallback })
  .then(port => {
    writeRuntimePort(runtimePortsFile, 'api', port);
    const suffix = port === preferredPort ? '' : ` (auto-selected from ${preferredPort})`;
    console.log(`知境·Knowra API running at http://localhost:${port}${suffix}`);
    console.log('Knowledge module ready:', Object.keys(app.modules.knowledge).join(', '));
  })
  .catch(async error => {
    console.error('Failed to start 知境·Knowra API:', error.message);
    try {
      await server.closeAi();
      await app.close?.();
    } catch (failure) {
      console.error('Failed to close AI runtime:', failure.code ?? 'AI_CLOSE_FAILED');
    }
    process.exitCode = 1;
  });
