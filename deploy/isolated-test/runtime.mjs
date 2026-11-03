import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';
import { createPostgresAppContext } from '../../apps/api/src/postgres-app.factory.js';
import { createServer } from '../../apps/api/src/server.js';
import { resolveAssetPath, serveV4Asset } from '../../apps/web/server/static-assets.mjs';
import { validateInstance, claimInstance, repositoryRoot } from './config.mjs';

export async function startIsolatedInstance({
  instanceId,
  dataRoot,
  databaseUrl,
  port = 43100,
  distRoot = path.join(repositoryRoot, 'apps/web/dist'),
  host = '127.0.0.1',
  publicOrigin = '',
  testEphemeralPort = false
}) {
  if (!['127.0.0.1', '0.0.0.0'].includes(host)) throw new Error('测试实例监听地址无效。');
  const config = validateInstance({
    instanceId,
    dataRoot,
    databaseUrl,
    port: testEphemeralPort && port === 0 ? 43100 : port
  });
  if (publicOrigin) {
    const url = new URL(publicOrigin);
    if (url.protocol !== 'https:' || url.origin !== publicOrigin || url.hostname === 'knowra.qwdream.top')
      throw new Error('只能配置独立测试HTTPS来源，不能使用生产域名。');
  }
  if (!fs.existsSync(path.join(distRoot, 'index.html'))) throw new Error('缺少已构建的V4生产页面。');
  // 此专用入口不读取模型凭据，也不启动AI执行器；网络路由进一步拒绝全部AI配置/调用。
  process.env.KNOWRA_AI_ENABLED = '0';
  process.env.KNOWRA_AI_EGRESS_ENABLED = '0';
  const client = new PrismaClient({ datasources: { db: { url: databaseUrl } }, log: [] });
  let app, server;
  const close = async () => {
    if (server?.listening)
      await new Promise((resolve, reject) => server.close(error => (error ? reject(error) : resolve())));
    await app?.close?.();
    await client.$disconnect();
  };
  try {
    await client.$connect();
    const identity = await claimInstance(client, config);
    app = await createPostgresAppContext({
      client,
      storageRootDir: config.dataRoot,
      uploadsDir: path.join(config.dataRoot, 'storage/uploads'),
      ownerId: config.ownerId
    });
    for (const folder of ['backups', 'exports', 'temp', 'logs'])
      fs.mkdirSync(path.join(config.dataRoot, folder), { recursive: true, mode: 0o700 });
    const api = createServer({
      appContext: app,
      cors: { allowedOrigins: publicOrigin ? [publicOrigin] : [] },
      logger: { warn() {}, error() {} }
    });
    const marker = `<aside aria-label="测试环境" style="position:fixed;bottom:12px;right:12px;z-index:2147483647;padding:8px 12px;background:#ffe08a;color:#302200;border:2px solid #8a5a00;border-radius:6px;font:700 14px sans-serif;pointer-events:none">测试环境 · 仅合成资料 · ${config.instanceId}</aside>`;
    server = http.createServer((request, response) => {
      response.setHeader('X-Knowra-Test-Instance', config.instanceId);
      let pathname;
      try {
        pathname = new URL(request.url, 'http://localhost').pathname;
      } catch {
        response.writeHead(400).end();
        return;
      }
      if (pathname === '/api/health') {
        response.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        response.end(
          JSON.stringify({ data: { status: 'ok', testInstance: identity.instanceId, syntheticOnly: true } })
        );
        return;
      }
      if (pathname.startsWith('/api/ai')) {
        response.writeHead(503, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        response.end(
          JSON.stringify({ error: { code: 'TEST_AI_DISABLED', message: '合成同步测试实例关闭模型配置及外部调用。' } })
        );
        return;
      }
      if (pathname.startsWith('/api/')) {
        api.emit('request', request, response);
        return;
      }
      if (['GET', 'HEAD'].includes(request.method)) {
        const asset = resolveAssetPath(pathname, distRoot);
        if (asset && path.basename(asset) === 'index.html') {
          const html = fs.readFileSync(asset, 'utf8').replace('</body>', `${marker}</body>`);
          response.writeHead(200, {
            'Content-Type': 'text/html; charset=utf-8',
            'Cache-Control': 'no-store',
            'X-Content-Type-Options': 'nosniff'
          });
          response.end(request.method === 'HEAD' ? undefined : html);
          return;
        }
        if (serveV4Asset({ request, response, pathname, distRoot })) return;
      }
      response.writeHead(404).end();
    });
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, host, resolve);
    });
    return { origin: `http://127.0.0.1:${server.address().port}`, config, close };
  } catch (error) {
    await close();
    throw error;
  }
}
