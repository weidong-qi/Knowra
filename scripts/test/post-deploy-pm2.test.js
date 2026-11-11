import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const repositoryRoot = path.resolve(import.meta.dirname, '../..');
const bashOptions = { skip: process.platform === 'win32' };
const databaseUrl = 'postgresql://synthetic:private-P1-password@127.0.0.1:5432/knowra_test';

for (const [label, apiEnv, webEnv, shellEnv, nestedEnv] of [
  ['postgres 配置只保存在 PM2', { PERSISTENCE_DRIVER: 'postgres', DATABASE_URL: databaseUrl }, {}, {}, false],
  [
    '数据库连接未在 Shell 导出',
    { PERSISTENCE_DRIVER: 'postgres', DATABASE_URL: databaseUrl },
    {},
    { PERSISTENCE_DRIVER: 'postgres' },
    false
  ],
  [
    'Shell 指向另一数据库',
    { PERSISTENCE_DRIVER: 'postgres', DATABASE_URL: databaseUrl },
    {},
    { PERSISTENCE_DRIVER: 'postgres', DATABASE_URL: `${databaseUrl}_other` },
    false
  ],
  ['上传目录只保存在 PM2', { STORAGE_UPLOADS_DIR: '/synthetic-original-uploads' }, {}, {}, false],
  ['owner 只保存在 PM2', { KNOWRA_OWNER_ID: 'synthetic-owner' }, {}, {}, false],
  ['外发禁用配置只保存在 PM2', { KNOWRA_AI_EGRESS_ENABLED: '0' }, {}, {}, false],
  ['Node 运行参数只保存在 PM2', { NODE_OPTIONS: '--max-old-space-size=128' }, {}, {}, false],
  ['数据库 TLS 证书只保存在 PM2', { NODE_EXTRA_CA_CERTS: '/synthetic-private-ca.pem' }, {}, {}, false],
  [
    'PG 口令只保存在 PM2',
    { PERSISTENCE_DRIVER: 'postgres', DATABASE_URL: databaseUrl, PGPASSWORD: 'private-P1-password' },
    {},
    { PERSISTENCE_DRIVER: 'postgres', DATABASE_URL: databaseUrl },
    false
  ],
  ['Web 代理配置只保存在 PM2', {}, { API_ORIGIN: 'http://127.0.0.1:43123' }, {}, false],
  ['postgres 配置保存在嵌套环境中', { PERSISTENCE_DRIVER: 'postgres', DATABASE_URL: databaseUrl }, {}, {}, true],
  [
    'PM2 平铺与嵌套配置矛盾',
    {
      PERSISTENCE_DRIVER: 'local-json',
      DATABASE_URL: '',
      env: { PERSISTENCE_DRIVER: 'postgres', DATABASE_URL: databaseUrl }
    },
    {},
    {},
    false
  ]
]) {
  test(`运行配置不一致时提前拒绝：${label}`, bashOptions, t => {
    const fixture = runFixture(t, { apiEnv, webEnv, shellEnv, nestedEnv });
    assert.notEqual(fixture.result.status, 0);
    assert.match(fixture.result.stderr, /PM2.*核验失败/);
    assert.equal(
      fixture.calls().some(call => call.command === 'npm'),
      false
    );
    assert.equal(
      fixture.calls().some(call => ['delete', 'start', 'save'].includes(call.args[0])),
      false
    );
    assert.equal(readFileSync(fixture.state, 'utf8'), fixture.initialState);
    assert.equal(existsSync(path.join(fixture.root, 'apps/web/dist/index.html')), false);
    assert.equal(`${fixture.result.stdout}${fixture.result.stderr}`.includes('private-P1-password'), false);
    assert.equal(existsSync(fixture.saved), false);
  });
}

for (const nestedEnv of [false, true]) {
  test(`相同 postgres 与存储配置可以重建并保存（嵌套环境：${nestedEnv}）`, bashOptions, t => {
    const settings = {
      PERSISTENCE_DRIVER: 'postgres',
      DATABASE_URL: databaseUrl,
      STORAGE_MODE: 'cloud',
      STORAGE_UPLOADS_DIR: '/synthetic-uploads',
      KNOWRA_OWNER_ID: 'synthetic-owner',
      KNOWRA_AI_EGRESS_ENABLED: '0'
    };
    const fixture = runFixture(t, { apiEnv: settings, shellEnv: settings, nestedEnv });
    assert.equal(fixture.result.status, 0, fixture.result.stderr);
    const saved = JSON.parse(readFileSync(fixture.saved, 'utf8')).find(app => app.name === 'knowra-api').pm2_env;
    assert.equal(saved.PERSISTENCE_DRIVER, 'postgres');
    assert.equal(saved.DATABASE_URL, databaseUrl);
    assert.equal(saved.STORAGE_UPLOADS_DIR, settings.STORAGE_UPLOADS_DIR);
    assert.equal(saved.KNOWRA_OWNER_ID, settings.KNOWRA_OWNER_ID);
    assert.ok(fixture.calls().some(call => call.command === 'npm' && call.args.includes('postgres')));
    assert.equal(`${fixture.result.stdout}${fixture.result.stderr}`.includes('private-P1-password'), false);
  });
}

test('重建后运行配置被丢弃时不保存状态', bashOptions, t => {
  const settings = { PERSISTENCE_DRIVER: 'postgres', DATABASE_URL: databaseUrl };
  const fixture = runFixture(t, { apiEnv: settings, shellEnv: settings, fault: 'drop-storage' });
  assert.notEqual(fixture.result.status, 0);
  assert.equal(existsSync(fixture.saved), false);
  assert.equal(
    fixture.calls().some(call => call.args[0] === 'delete'),
    true
  );
});

test('构建期间数据库配置变化时，在发布资源前拒绝继续部署', bashOptions, t => {
  const settings = { PERSISTENCE_DRIVER: 'postgres', DATABASE_URL: databaseUrl };
  const fixture = runFixture(t, { apiEnv: settings, shellEnv: settings, fault: 'changed-during-build' });
  assert.notEqual(fixture.result.status, 0);
  assert.equal(
    fixture.calls().some(call => call.args[0] === 'delete'),
    false
  );
  assert.equal(existsSync(path.join(fixture.root, 'apps/web/dist/index.html')), false);
  assert.equal(
    JSON.parse(readFileSync(fixture.state, 'utf8')).find(app => app.name === 'knowra-api').pm2_env.DATABASE_URL,
    `${databaseUrl}_changed`
  );
  assert.equal(`${fixture.result.stdout}${fixture.result.stderr}`.includes('private-P1-password'), false);
});

for (const sharedStorage of [false, true]) {
  test(`相对资料路径跨发布目录时检查实际存储位置（共享资料：${sharedStorage}）`, bashOptions, t => {
    const fixture = runFixture(t, { previousApiRoot: true, sharedStorage });
    if (sharedStorage) {
      assert.equal(fixture.result.status, 0, fixture.result.stderr);
      assert.equal(existsSync(fixture.saved), true);
    } else {
      assert.notEqual(fixture.result.status, 0);
      assert.match(fixture.result.stderr, /LOCAL_JSON_PATH/);
      assert.equal(
        fixture.calls().some(call => call.command === 'npm'),
        false
      );
      assert.equal(readFileSync(fixture.state, 'utf8'), fixture.initialState);
    }
  });
}

for (const previousWebDir of ['web-v4', 'web-v5']) {
  test(`应急部署从 ${previousWebDir} 的旧定义迁至 web，并只保存已核验的进程`, bashOptions, t => {
    const fixture = runFixture(t, { previousWebDir });
    assert.equal(fixture.result.status, 0, fixture.result.stderr);
    const calls = fixture.calls().filter(call => call.command === 'pm2');
    assert.deepEqual(
      calls.map(call => call.args[0]),
      ['describe', 'describe', 'jlist', 'jlist', 'delete', 'start', 'jlist', 'save']
    );
    assert.deepEqual(calls[4].args, ['delete', 'knowra-api', 'knowra-web']);
    assert.deepEqual(calls[5].args, ['start', path.join(fixture.root, 'deploy/ecosystem.config.cjs'), '--update-env']);
    const saved = JSON.parse(readFileSync(fixture.saved, 'utf8'));
    for (const [name, script] of [
      ['knowra-api', 'apps/api/src/main.ts'],
      ['knowra-web', 'apps/web/server.mjs']
    ]) {
      const env = saved.find(app => app.name === name).pm2_env;
      assert.equal(env.pm_exec_path, path.join(fixture.root, script));
      assert.equal(env.pm_cwd, fixture.root);
      assert.equal(env.status, 'online');
    }
    assert.equal(saved.find(app => app.name === 'unrelated-worker').pm2_env.marker, 'untouched');
    assert.equal(existsSync(path.join(fixture.root, 'apps', previousWebDir, 'server.mjs')), false);
    assert.equal(readFileSync(path.join(fixture.root, 'apps/web/dist/assets/old.js'), 'utf8'), 'old asset');
  });
}

for (const [fault, label] of [
  ['stale-web', '仍指向存在的旧 Web 入口'],
  ['wrong-cwd', 'API 工作目录不属于当前发布'],
  ['offline', 'Web 进程未在线'],
  ['invalid-json', 'PM2 元数据损坏'],
  ['jlist', 'PM2 查询失败但仍输出有效元数据']
]) {
  test(`应急部署拒绝保存：${label}`, bashOptions, t => {
    const fixture = runFixture(t, { fault });
    assert.notEqual(fixture.result.status, 0);
    assert.match(fixture.result.stderr, /PM2.*核验失败/);
    assert.equal(existsSync(fixture.saved), false);
    assert.equal(
      fixture.calls().some(call => call.command === 'pm2' && call.args[0] === 'save'),
      false
    );
  });
}

for (const fault of ['delete', 'start']) {
  test(`应急部署在 PM2 ${fault} 失败后停止，不继续查询或保存`, bashOptions, t => {
    const fixture = runFixture(t, { fault });
    assert.notEqual(fixture.result.status, 0);
    const calls = fixture.calls().filter(call => call.command === 'pm2');
    assert.equal(calls.at(-1).args[0], fault);
    assert.equal(existsSync(fixture.saved), false);
  });
}

for (const fault of ['attachments', 'build']) {
  test(`应急部署在 ${fault} 检查失败时保留原 PM2 定义`, bashOptions, t => {
    const fixture = runFixture(t, { fault });
    assert.notEqual(fixture.result.status, 0);
    assert.equal(
      fixture.calls().some(call => call.command === 'pm2' && ['delete', 'start', 'save'].includes(call.args[0])),
      false
    );
    const processes = JSON.parse(readFileSync(fixture.state, 'utf8'));
    assert.equal(
      processes.find(app => app.name === 'knowra-web').pm2_env.pm_exec_path,
      path.join(fixture.root, 'apps/web-v4/server.mjs')
    );
  });
}

function runFixture(
  t,
  {
    previousWebDir = 'web-v4',
    fault = '',
    apiEnv = {},
    webEnv = {},
    shellEnv = {},
    nestedEnv = false,
    previousApiRoot = false,
    sharedStorage = false
  } = {}
) {
  const base = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'knowra-post-deploy-')));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const root = path.join(base, 'repo with spaces');
  const bin = path.join(base, 'bin');
  const state = path.join(base, 'processes.json');
  const calls = path.join(base, 'calls.jsonl');
  const saved = path.join(base, 'saved.json');
  for (const directory of ['scripts', 'deploy', 'apps/api/src/config', 'apps/web/dist/assets']) {
    mkdirSync(path.join(root, directory), { recursive: true });
  }
  mkdirSync(bin);
  copyFileSync(path.join(repositoryRoot, 'scripts/post-deploy.sh'), path.join(root, 'scripts/post-deploy.sh'));
  copyFileSync(
    path.join(repositoryRoot, 'scripts/verify-pm2-runtime.mjs'),
    path.join(root, 'scripts/verify-pm2-runtime.mjs')
  );
  copyFileSync(
    path.join(repositoryRoot, 'apps/api/src/config/env.schema.ts'),
    path.join(root, 'apps/api/src/config/env.schema.ts')
  );
  for (const file of ['ecosystem.config.cjs', 'runtime-env.cjs']) {
    copyFileSync(path.join(repositoryRoot, 'deploy', file), path.join(root, 'deploy', file));
  }
  writeFileSync(path.join(root, 'apps/api/src/main.ts'), '');
  writeFileSync(path.join(root, 'apps/web/server.mjs'), '');
  writeFileSync(path.join(root, 'apps/web/dist/assets/old.js'), 'old asset');
  const apiRoot = previousApiRoot ? path.join(base, 'previous release') : root;
  if (previousApiRoot) {
    mkdirSync(path.join(apiRoot, 'apps/api/src'), { recursive: true });
    writeFileSync(path.join(apiRoot, 'apps/api/src/main.ts'), '');
    if (sharedStorage) {
      mkdirSync(path.join(root, 'storage'), { recursive: true });
      symlinkSync(path.join(root, 'storage'), path.join(apiRoot, 'storage'), 'dir');
    }
  }
  if (fault === 'stale-web') {
    mkdirSync(path.join(root, 'apps', previousWebDir), { recursive: true });
    writeFileSync(path.join(root, 'apps', previousWebDir, 'server.mjs'), '');
  }
  const apiSettings = { NODE_ENV: 'production', PORT: '3001', KNOWRA_OWNER_ID: 'demo', ...apiEnv };
  const webSettings = {
    NODE_ENV: 'production',
    PORT: '3000',
    API_ORIGIN: 'http://127.0.0.1:3001',
    WEB_TRUST_LOOPBACK_PROXY: '1',
    ...webEnv
  };
  writeFileSync(
    state,
    JSON.stringify([
      {
        name: 'knowra-api',
        pm2_env: {
          ...(nestedEnv ? { env: apiSettings } : apiSettings),
          status: 'online',
          pm_cwd: apiRoot,
          pm_exec_path: path.join(apiRoot, 'apps/api/src/main.ts')
        }
      },
      {
        name: 'knowra-web',
        pm2_env: {
          ...(nestedEnv ? { env: webSettings } : webSettings),
          status: 'online',
          pm_cwd: root,
          pm_exec_path: path.join(root, 'apps', previousWebDir, 'server.mjs')
        }
      },
      { name: 'unrelated-worker', pm2_env: { marker: 'untouched' } }
    ])
  );
  const initialState = readFileSync(state, 'utf8');
  writeFileSync(calls, '');
  const config = path.join(base, 'fixture.json');
  writeFileSync(config, JSON.stringify({ root, state, calls, saved, fault, previousWebDir, shellEnv }));
  for (const command of ['npm', 'pm2']) {
    const file = path.join(bin, command);
    writeFileSync(file, `#!${process.execPath}\n${mockCommand}`);
    chmodSync(file, 0o755);
  }
  const inheritedEnv = { ...process.env };
  for (const key of Object.keys(inheritedEnv)) {
    if (/^(?:PG[A-Z_]+|PRISMA_)/.test(key)) delete inheritedEnv[key];
  }
  const result = spawnSync('bash', [path.join(root, 'scripts/post-deploy.sh')], {
    cwd: base,
    encoding: 'utf8',
    timeout: 15_000,
    env: {
      ...inheritedEnv,
      PATH: `${bin}${path.delimiter}${process.env.PATH}`,
      KNOWRA_POST_DEPLOY_TEST_FIXTURE: config,
      KNOWRA_V4_DIST_DIR: 'apps/web/dist',
      KNOWRA_DEPLOY_REPORT_DIR: path.join(base, 'reports'),
      PERSISTENCE_DRIVER: 'local-json',
      DATABASE_URL: '',
      DIRECT_URL: '',
      STORAGE_MODE: '',
      STORAGE_UPLOADS_DIR: '',
      STORAGE_EXPORTS_DIR: '',
      STORAGE_TEMP_DIR: '',
      KNOWRA_OWNER_ID: '',
      CORS_ALLOWED_ORIGINS: '',
      KNOWRA_AI_ENABLED: '',
      KNOWRA_AI_EGRESS_ENABLED: '',
      KNOWRA_SYNC_PUSH_ENABLED: '',
      KNOWRA_SYNC_ALLOWED_DEVICE_IDS: '',
      KNOWRA_SYNC_VERIFY_SCOPED_AFTER: '',
      STUDY_RUNTIME_PORTS_FILE: '',
      KNOWRA_API_PORT: '',
      KNOWRA_WEB_PORT: '',
      API_ORIGIN: '',
      NODE_OPTIONS: '',
      NODE_EXTRA_CA_CERTS: '',
      NODE_TLS_REJECT_UNAUTHORIZED: '',
      NODE_USE_ENV_PROXY: '',
      SSL_CERT_FILE: '',
      SSL_CERT_DIR: '',
      TZ: '',
      ...shellEnv
    }
  });
  return {
    root,
    state,
    saved,
    result,
    initialState,
    calls: () =>
      readFileSync(calls, 'utf8')
        .trim()
        .split('\n')
        .filter(Boolean)
        .map(line => JSON.parse(line))
  };
}

// 所有外部命令只操作本测试的临时目录，不构建真实前端或访问真实 PM2。
const mockCommand = String.raw`
const fs = require('node:fs');
const path = require('node:path');
const fixture = JSON.parse(fs.readFileSync(process.env.KNOWRA_POST_DEPLOY_TEST_FIXTURE, 'utf8'));
const { root, state, calls, saved, fault, previousWebDir, shellEnv } = fixture;
const command = path.basename(process.argv[1]);
const args = process.argv.slice(2);
fs.appendFileSync(calls, JSON.stringify({ command, args }) + '\n');
if (command === 'npm') {
  if (args[1] === 'check:attachments') process.exit(fault === 'attachments' ? 21 : 0);
  if (args[1] !== 'build:web') process.exit(99);
  if (fault === 'build') process.exit(22);
  const dist = process.env.KNOWRA_V4_OUT_DIR;
  fs.mkdirSync(path.join(dist, 'assets'), { recursive: true });
  fs.writeFileSync(path.join(dist, 'index.html'), 'synthetic index');
  fs.writeFileSync(path.join(dist, 'assets/new.js'), 'new asset');
  if (fault === 'changed-during-build') {
    const processes = JSON.parse(fs.readFileSync(state, 'utf8'));
    processes.find(app => app.name === 'knowra-api').pm2_env.DATABASE_URL += '_changed';
    fs.writeFileSync(state, JSON.stringify(processes));
  }
  process.exit(0);
}
let processes = JSON.parse(fs.readFileSync(state, 'utf8'));
if (args[0] === 'describe') process.exit(processes.some(app => app.name === args[1]) ? 0 : 1);
if (args[0] === 'delete') {
  if (fault === 'delete') process.exit(23);
  processes = processes.filter(app => !args.slice(1).includes(app.name));
  fs.writeFileSync(state, JSON.stringify(processes));
} else if (args[0] === 'start') {
  if (fault === 'start') process.exit(24);
  for (const app of require(args[1]).apps) {
    processes.push({ name: app.name, pm2_env: {
      ...shellEnv, ...app.env, status: 'online', pm_cwd: app.cwd, pm_exec_path: path.resolve(app.cwd, app.script)
    } });
  }
  if (fault === 'stale-web') processes.find(app => app.name === 'knowra-web').pm2_env.pm_exec_path =
    path.join(root, 'apps', previousWebDir, 'server.mjs');
  if (fault === 'wrong-cwd') processes.find(app => app.name === 'knowra-api').pm2_env.pm_cwd = path.dirname(root);
  if (fault === 'offline') processes.find(app => app.name === 'knowra-web').pm2_env.status = 'stopped';
  if (fault === 'drop-storage') {
    const env = processes.find(app => app.name === 'knowra-api').pm2_env;
    env.PERSISTENCE_DRIVER = 'local-json';
    delete env.DATABASE_URL;
  }
  fs.writeFileSync(state, JSON.stringify(processes));
} else if (args[0] === 'startOrReload') {
  // 复现旧入口只更新环境而保留已有执行路径的语义。
} else if (args[0] === 'jlist') {
  process.stdout.write(fault === 'invalid-json' ? '{broken' : JSON.stringify(processes));
  process.exitCode = fault === 'jlist' ? 25 : 0;
} else if (args[0] === 'save') {
  fs.copyFileSync(state, saved);
} else process.exit(99);
`;
