import path from 'node:path';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';
import { readRuntimePorts, resolveApiPort } from '../../scripts/dev-runtime-ports.js';
import { resolveBuildInfo } from '../../scripts/build-info.mjs';

const appDirectory = path.dirname(fileURLToPath(import.meta.url));
const pdfRoot = path.dirname(createRequire(import.meta.url).resolve('pdfjs-dist/package.json'));
const pdfAssetDirectories = {
  cmaps: 'cmaps',
  standard_fonts: 'standard_fonts',
  wasm: 'wasm',
  iccs: 'iccs',
  images: 'web/images'
};
const workspaceRoot = path.resolve(appDirectory, '../..');

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, workspaceRoot, '');
  const webPort = toPort(env.PORT);
  const runtimePortsFile =
    env.STUDY_RUNTIME_PORTS_FILE || path.join(workspaceRoot, 'storage', 'runtime', 'dev-ports.json');
  const apiPort = resolveApiPort({
    envApiPort: env.API_PORT,
    runtimePorts: readRuntimePorts(runtimePortsFile),
    webPort
  });
  const outputDirectory = process.env.KNOWRA_V4_OUT_DIR?.trim();
  // 构建标识仅从进程环境/Git生成，不从开发 .env 注入发布身份。
  const buildInfo = resolveBuildInfo(workspaceRoot);

  return {
    define: { __KNOWRA_BUILD_INFO__: JSON.stringify(buildInfo) },
    plugins: [
      react(),
      {
        name: 'knowra-pdf-assets',
        configureServer(server) {
          server.middlewares.use('/pdf-assets/', (request, response, next) => {
            const match = /^\/(cmaps|standard_fonts|wasm|iccs|images)\/([a-zA-Z0-9_.-]+)$/.exec(
              (request.url ?? '').split('?')[0]
            );
            if (!match) {
              next();
              return;
            }
            const file = path.join(
              pdfRoot,
              pdfAssetDirectories[match[1] as keyof typeof pdfAssetDirectories],
              match[2]
            );
            if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
              next();
              return;
            }
            response.setHeader(
              'Content-Type',
              file.endsWith('.wasm')
                ? 'application/wasm'
                : file.endsWith('.svg')
                  ? 'image/svg+xml'
                  : 'application/octet-stream'
            );
            fs.createReadStream(file).pipe(response);
          });
        },
        generateBundle() {
          for (const [directory, relative] of Object.entries(pdfAssetDirectories))
            for (const name of fs.readdirSync(path.join(pdfRoot, relative))) {
              const file = path.join(pdfRoot, relative, name);
              if (fs.statSync(file).isFile())
                this.emitFile({
                  type: 'asset',
                  fileName: `pdf-assets/${directory}/${name}`,
                  source: fs.readFileSync(file)
                });
            }
        }
      },
      {
        name: 'knowra-build-info',
        generateBundle() {
          this.emitFile({
            type: 'asset',
            fileName: 'build-info.json',
            source: `${JSON.stringify(buildInfo, null, 2)}\n`
          });
        }
      }
    ],
    ...(outputDirectory ? { build: { outDir: outputDirectory } } : {}),
    server: {
      host: '127.0.0.1',
      ...(webPort ? { port: webPort } : {}),
      proxy: {
        '/api': { target: `http://127.0.0.1:${apiPort}`, changeOrigin: false }
      }
    }
  };
});

function toPort(value: string | undefined): number | undefined {
  const port = Number(value);
  return Number.isInteger(port) && port > 0 ? port : undefined;
}
