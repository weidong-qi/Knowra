const path = require('node:path');
const { resolveDeploymentEnv } = require('./runtime-env.cjs');

const workspaceRoot = path.resolve(__dirname, '..');
const runtimeEnv = resolveDeploymentEnv();

module.exports = {
  apps: [
    {
      name: 'knowra-api',
      cwd: workspaceRoot,
      script: 'apps/api/src/main.ts',
      env: {
        NODE_ENV: 'production',
        PORT: runtimeEnv.apiPort,
        KNOWRA_OWNER_ID: process.env.KNOWRA_OWNER_ID || 'demo'
      }
    },
    {
      name: 'knowra-web',
      cwd: workspaceRoot,
      script: 'apps/web/server.mjs',
      env: {
        NODE_ENV: 'production',
        PORT: runtimeEnv.webPort,
        // 本仓库 Nginx 覆盖 Host/协议；只信任回环连接，独立启动默认不信任转发头。
        WEB_TRUST_LOOPBACK_PROXY: '1',
        API_ORIGIN: runtimeEnv.apiOrigin
      }
    }
  ]
};
