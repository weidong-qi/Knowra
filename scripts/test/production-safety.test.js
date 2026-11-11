import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.resolve(testDirectory, '..', '..');

test('默认前端使用稳定 web 工作区，V3 归档仅提供回归测试', () => {
  const packageJson = JSON.parse(readWorkspaceFile('package.json'));
  const legacyPackageJson = JSON.parse(readWorkspaceFile('apps/web-legacy/package.json'));
  const ecosystem = readWorkspaceFile('deploy/ecosystem.config.cjs');

  assert.equal(packageJson.scripts['dev:web'], 'npm run dev -w @study-accelerator/web');
  assert.equal(packageJson.scripts['test:web:legacy'], 'npm test -w @study-accelerator/web-legacy');
  assert.equal(legacyPackageJson.name, '@study-accelerator/web-legacy');
  assert.equal(packageJson.scripts['dev:web:legacy'], undefined);
  assert.equal(legacyPackageJson.scripts.dev, undefined);
  assert.equal(legacyPackageJson.scripts['build:editor-bundle'], undefined);
  assert.equal(packageJson.scripts['start:web'], 'npm run start -w @study-accelerator/web');
  assert.match(ecosystem, /script: 'apps\/web\/server\.mjs'/);
  assert.doesNotMatch(ecosystem, /apps\/web-legacy\/src\/main\.js/);
});

test('API and default V4 Web listeners bind to loopback only', () => {
  const apiMain = readWorkspaceFile('apps/api/src/main.ts');
  const webMain = readWorkspaceFile('apps/web/server.mjs');
  const portListener = readWorkspaceFile('scripts/configured-port-listener.js');

  assert.match(portListener, /host = ['"]127\.0\.0\.1['"]/);
  assert.match(apiMain, /process\.env\.NODE_ENV !== ['"]production['"]/);
  assert.match(webMain, /process\.env\.NODE_ENV !== ['"]production['"]/);
  assert.match(apiMain, /listenOnConfiguredPort\(server, preferredPort, \{ allowPortFallback \}\)/);
  assert.match(webMain, /listenOnConfiguredPort\(server, preferredPort, \{ allowPortFallback \}\)/);
});

test('production Nginx template protects the site and keeps health public', () => {
  const nginxConfig = readWorkspaceFile('deploy/nginx/knowra.conf.example');

  assert.match(nginxConfig, /auth_basic\s+"Knowra";/);
  assert.match(nginxConfig, /auth_basic_user_file\s+\/etc\/nginx\/\.htpasswd-knowra;/);
  assert.match(
    nginxConfig,
    /location = \/api\/health\s*\{[\s\S]*?auth_basic off;[\s\S]*?proxy_pass http:\/\/127\.0\.0\.1:3000;/
  );
  assert.match(nginxConfig, /location \/\s*\{[\s\S]*?proxy_pass http:\/\/127\.0\.0\.1:3000;/);
  assert.match(nginxConfig, /gzip_comp_level\s+5;/);
  assert.match(
    nginxConfig,
    /gzip_types[\s\S]*?text\/css[\s\S]*?application\/javascript[\s\S]*?application\/json[\s\S]*?image\/svg\+xml;/
  );
});

test('应急部署在附件校验后重建 PM2，并在实际入口核验后才保存状态', () => {
  const postDeploy = readWorkspaceFile('scripts/post-deploy.sh');

  const attachmentCheckIndex = postDeploy.indexOf('npm run check:attachments');
  const deleteIndex = postDeploy.indexOf('pm2 delete knowra-api knowra-web');
  const startIndex = postDeploy.indexOf('pm2 start "$ROOT_DIR/deploy/ecosystem.config.cjs" --update-env');
  const preflightIndex = postDeploy.indexOf('verify_pm2_runtime before');
  const verifyIndex = postDeploy.indexOf('verify_pm2_runtime after');
  const saveIndex = postDeploy.indexOf('pm2 save');
  assert.notEqual(attachmentCheckIndex, -1);
  assert.notEqual(deleteIndex, -1);
  assert.notEqual(startIndex, -1);
  assert.notEqual(verifyIndex, -1);
  assert.notEqual(preflightIndex, -1);
  assert.notEqual(saveIndex, -1);
  assert.ok(attachmentCheckIndex < deleteIndex);
  assert.ok(preflightIndex < attachmentCheckIndex);
  assert.ok(deleteIndex < startIndex && startIndex < verifyIndex && verifyIndex < saveIndex);
  assert.doesNotMatch(postDeploy, /pm2 startOrReload/);
});

test('production deployment guide keeps the full test suite off the live host', () => {
  const serverGuide = readWorkspaceFile('docs/阿里云ECS服务器信息.md');

  assert.match(serverGuide, /不得在正在提供服务的生产主机上运行 `npm test`/);
  assert.doesNotMatch(serverGuide, /cd \/opt\/knowra[\s\S]{0,1800}# \d+\. 部署前验证[\s\S]{0,120}npm test/);
});

test('CI runs the V4 architecture boundary gate directly', () => {
  const workflow = readWorkspaceFile('.github/workflows/ci.yml');
  assert.match(workflow, /npm run check:boundaries -w @study-accelerator\/web/);
});

function readWorkspaceFile(relativePath) {
  return readFileSync(path.join(workspaceRoot, relativePath), 'utf8');
}
