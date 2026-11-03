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
  writeFileSync
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const repositoryRoot = path.resolve(import.meta.dirname, '../..');
const bashOptions = { skip: process.platform === 'win32' };

for (const previousWebDir of ['web-v4', 'web-v5']) {
  test(`应急部署从 ${previousWebDir} 的旧定义迁至 web，并只保存已核验的进程`, bashOptions, t => {
    const fixture = runFixture(t, { previousWebDir });
    assert.equal(fixture.result.status, 0, fixture.result.stderr);
    const calls = fixture.calls().filter(call => call.command === 'pm2');
    assert.deepEqual(
      calls.map(call => call.args[0]),
      ['describe', 'describe', 'delete', 'start', 'jlist', 'save']
    );
    assert.deepEqual(calls[2].args, ['delete', 'knowra-api', 'knowra-web']);
    assert.deepEqual(calls[3].args, ['start', path.join(fixture.root, 'deploy/ecosystem.config.cjs'), '--update-env']);
    const saved = JSON.parse(readFileSync(fixture.saved, 'utf8'));
    for (const [name, script] of [
      ['knowra-api', 'apps/api/src/main.js'],
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
      fixture.calls().some(call => call.command === 'pm2'),
      false
    );
    const processes = JSON.parse(readFileSync(fixture.state, 'utf8'));
    assert.equal(
      processes.find(app => app.name === 'knowra-web').pm2_env.pm_exec_path,
      path.join(fixture.root, 'apps/web-v4/server.mjs')
    );
  });
}

function runFixture(t, { previousWebDir = 'web-v4', fault = '' } = {}) {
  const base = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'knowra-post-deploy-')));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const root = path.join(base, 'repo with spaces');
  const bin = path.join(base, 'bin');
  const state = path.join(base, 'processes.json');
  const calls = path.join(base, 'calls.jsonl');
  const saved = path.join(base, 'saved.json');
  for (const directory of ['scripts', 'deploy', 'apps/api/src', 'apps/web/dist/assets']) {
    mkdirSync(path.join(root, directory), { recursive: true });
  }
  mkdirSync(bin);
  copyFileSync(path.join(repositoryRoot, 'scripts/post-deploy.sh'), path.join(root, 'scripts/post-deploy.sh'));
  for (const file of ['ecosystem.config.cjs', 'runtime-env.cjs']) {
    copyFileSync(path.join(repositoryRoot, 'deploy', file), path.join(root, 'deploy', file));
  }
  writeFileSync(path.join(root, 'apps/api/src/main.js'), '');
  writeFileSync(path.join(root, 'apps/web/server.mjs'), '');
  writeFileSync(path.join(root, 'apps/web/dist/assets/old.js'), 'old asset');
  if (fault === 'stale-web') {
    mkdirSync(path.join(root, 'apps', previousWebDir), { recursive: true });
    writeFileSync(path.join(root, 'apps', previousWebDir, 'server.mjs'), '');
  }
  writeFileSync(
    state,
    JSON.stringify([
      {
        name: 'knowra-api',
        pm2_env: { status: 'online', pm_cwd: root, pm_exec_path: path.join(root, 'apps/api/src/main.js') }
      },
      {
        name: 'knowra-web',
        pm2_env: { status: 'online', pm_cwd: root, pm_exec_path: path.join(root, 'apps', previousWebDir, 'server.mjs') }
      },
      { name: 'unrelated-worker', pm2_env: { marker: 'untouched' } }
    ])
  );
  writeFileSync(calls, '');
  const config = path.join(base, 'fixture.json');
  writeFileSync(config, JSON.stringify({ root, state, calls, saved, fault, previousWebDir }));
  for (const command of ['npm', 'pm2']) {
    const file = path.join(bin, command);
    writeFileSync(file, `#!${process.execPath}\n${mockCommand}`);
    chmodSync(file, 0o755);
  }
  const result = spawnSync('bash', [path.join(root, 'scripts/post-deploy.sh')], {
    cwd: base,
    encoding: 'utf8',
    timeout: 15_000,
    env: {
      ...process.env,
      PATH: `${bin}${path.delimiter}${process.env.PATH}`,
      KNOWRA_POST_DEPLOY_TEST_FIXTURE: config,
      KNOWRA_V4_DIST_DIR: 'apps/web/dist',
      KNOWRA_DEPLOY_REPORT_DIR: path.join(base, 'reports'),
      PERSISTENCE_DRIVER: 'local-json'
    }
  });
  return {
    root,
    state,
    saved,
    result,
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
const { root, state, calls, saved, fault, previousWebDir } = fixture;
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
      status: 'online', pm_cwd: app.cwd, pm_exec_path: path.resolve(app.cwd, app.script)
    } });
  }
  if (fault === 'stale-web') processes.find(app => app.name === 'knowra-web').pm2_env.pm_exec_path =
    path.join(root, 'apps', previousWebDir, 'server.mjs');
  if (fault === 'wrong-cwd') processes.find(app => app.name === 'knowra-api').pm2_env.pm_cwd = path.dirname(root);
  if (fault === 'offline') processes.find(app => app.name === 'knowra-web').pm2_env.status = 'stopped';
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
