import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { cpSync, mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const repo = fileURLToPath(new URL('../../../', import.meta.url));

async function withStartup(run) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'knowra-api-startup-'));
  const children = [];
  try {
    // 启动入口没有 storageRoot 环境变量。复制真实源码使其默认根目录也是一次性测试目录。
    cpSync(path.join(repo, 'apps/api/src'), path.join(root, 'apps/api/src'), { recursive: true });
    mkdirSync(path.join(root, 'scripts'));
    for (const file of ['dev-runtime-ports.js', 'configured-port-listener.js'])
      cpSync(path.join(repo, 'scripts', file), path.join(root, 'scripts', file));
    symlinkSync(path.join(repo, 'packages'), path.join(root, 'packages'));
    symlinkSync(path.join(repo, 'node_modules'), path.join(root, 'node_modules'));
    writeFileSync(path.join(root, 'package.json'), JSON.stringify({ type: 'module' }));
    await run((port, mode = 'production') => {
      const child = spawn(process.execPath, ['apps/api/src/main.ts'], {
        cwd: root,
        env: {
          ...process.env,
          HOME: root,
          USERPROFILE: root,
          XDG_CONFIG_HOME: path.join(root, '.config'),
          NODE_ENV: mode,
          PORT: String(port),
          PERSISTENCE_DRIVER: 'local-json',
          KNOWRA_AI_ENABLED: '0',
          KNOWRA_AI_EGRESS_ENABLED: '0',
          STORAGE_UPLOADS_DIR: path.join(root, 'uploads'),
          STUDY_RUNTIME_PORTS_FILE: path.join(root, 'ports.json')
        },
        stdio: ['ignore', 'pipe', 'pipe']
      });
      children.push(child);
      return child;
    }, root);
  } finally {
    for (const child of children) {
      if (child.exitCode === null && child.signalCode === null) {
        const closed = once(child, 'close');
        child.kill('SIGTERM');
        await closed;
      }
    }
    rmSync(root, { recursive: true, force: true });
  }
}

async function reservePort() {
  const server = http.createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return { server, port: server.address().port };
}

test('API 启动入口写入实际端口并提供 loopback health', { timeout: 20_000 }, async () => {
  const { server, port } = await reservePort();
  await new Promise(resolve => server.close(resolve));
  await withStartup(async (start, root) => {
    const child = start(port);
    let output = '';
    for await (const chunk of child.stdout) {
      output += chunk;
      if (output.includes('API running at')) break;
    }
    assert.match(output, new RegExp(`http://localhost:${port}`));
    const response = await fetch(`http://127.0.0.1:${port}/api/health`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { data: { status: 'ok' } });
    assert.equal(JSON.parse(readFileSync(path.join(root, 'ports.json'), 'utf8')).api, port);
  });
});

test('API 生产端口冲突时退出失败而不回退端口', { timeout: 20_000 }, async () => {
  const { server, port } = await reservePort();
  try {
    await withStartup(async start => {
      const child = start(port);
      let error = '';
      child.stderr.on('data', chunk => {
        error += chunk;
      });
      const [code] = await once(child, 'close');
      assert.equal(code, 1);
      assert.match(error, /refusing to select another port/);
    });
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});
