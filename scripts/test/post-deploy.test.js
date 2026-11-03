import assert from 'node:assert/strict';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.resolve(testDirectory, '..', '..');
const deployScript = path.join(workspaceRoot, 'scripts', 'post-deploy.sh');
const deployScriptSource = readFileSync(deployScript, 'utf8');

test('post-deploy builds and restarts the production PM2 processes', () => {
  const fixture = createFixture();

  try {
    const result = runDeployScript(fixture);
    const calls = readFileSync(fixture.logFile, 'utf8');

    assert.equal(result.status, 0, result.stderr);
    assert.match(calls, /^npm run check:attachments -- --driver local-json --report /m);
    assert.match(calls, /^npm run build:web$/m);
    assert.match(
      deployScriptSource,
      /KNOWRA_V4_OUT_DIR=.*NODE_ENV=production npm run build:web/,
      'deployment must build the V4 frontend'
    );
    assert.match(calls, /^pm2 describe knowra-api$/m);
    assert.match(calls, /^pm2 describe knowra-web$/m);
    assert.match(calls, /^pm2 delete knowra-api knowra-web$/m);
    assert.ok(
      calls.includes(`pm2 start ${toGitBashPath(path.join(workspaceRoot, 'deploy/ecosystem.config.cjs'))} --update-env`)
    );
    assert.match(calls, /^pm2 jlist$/m);
    assert.match(calls, /^pm2 save$/m);
    assert.doesNotMatch(calls, /study-web/);
    assert.equal(readFileSync(path.join(fixture.distDirectory, 'index.html'), 'utf8'), 'new-index\n');
    assert.equal(readFileSync(path.join(fixture.distDirectory, 'assets', 'old.js'), 'utf8'), 'old\n');
    assert.equal(readFileSync(path.join(fixture.distDirectory, 'assets', 'new.js'), 'utf8'), 'new\n');
    assert.equal(
      readdirSync(fixture.root).some(name => name.startsWith('dist.staging.')),
      false
    );
  } finally {
    fixture.cleanup();
  }
});

test('post-deploy fails before build and restart when attachment integrity is degraded', () => {
  const fixture = createFixture({ failingNpmCommand: 'run check:attachments' });

  try {
    const result = runDeployScript(fixture);
    const calls = readFileSync(fixture.logFile, 'utf8');

    assert.notEqual(result.status, 0);
    assert.match(calls, /^npm run check:attachments /m);
    assert.doesNotMatch(calls, /^npm run build:web$/m);
    assert.doesNotMatch(calls, /^pm2 (?:delete|start|save)(?: |$)/m);
  } finally {
    fixture.cleanup();
  }
});

test('post-deploy fails before restart when a production PM2 process is missing', () => {
  const fixture = createFixture({ missingProcess: 'knowra-api' });

  try {
    const result = runDeployScript(fixture);
    const calls = readFileSync(fixture.logFile, 'utf8');

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /未找到 PM2 进程 knowra-api/);
    assert.doesNotMatch(calls, /^pm2 (?:delete|start|save)(?: |$)/m);
  } finally {
    fixture.cleanup();
  }
});

function createFixture({ missingProcess = '', failingNpmCommand = '' } = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'knowra-post-deploy-'));
  const binDir = path.join(root, 'bin');
  const distDirectory = path.join(root, 'dist');
  const logFile = path.join(root, 'calls.log');

  writeFileSync(logFile, '');
  mkdirSync(path.join(distDirectory, 'assets'), { recursive: true });
  writeFileSync(path.join(distDirectory, 'assets', 'old.js'), 'old\n');
  writeExecutable(path.join(binDir, 'npm'), [
    '#!/usr/bin/env bash',
    'printf "npm %s\\n" "$*" >> "$DEPLOY_TEST_LOG"',
    'if [[ -n "$DEPLOY_TEST_FAILING_NPM_COMMAND" && "$*" == "$DEPLOY_TEST_FAILING_NPM_COMMAND"* ]]; then exit 2; fi',
    'if [[ "$*" == "run build:web" ]]; then',
    '  output_dir="${KNOWRA_V4_OUT_DIR:-$KNOWRA_V4_DIST_DIR}"',
    '  mkdir -p "$output_dir/assets"',
    '  printf "%s\\n" new > "$output_dir/assets/new.js"',
    '  printf "%s\\n" new-index > "$output_dir/index.html"',
    'fi'
  ]);
  writeExecutable(path.join(binDir, 'pm2'), [
    '#!/usr/bin/env bash',
    'printf "pm2 %s\\n" "$*" >> "$DEPLOY_TEST_LOG"',
    'if [[ "$1" == "describe" && "$2" == "$DEPLOY_TEST_MISSING_PROCESS" ]]; then',
    '  exit 1',
    'fi',
    'if [[ "$1" == jlist ]]; then',
    `  node -e 'const fs = require("node:fs"); const path = require("node:path"); const root = fs.realpathSync(process.env.DEPLOY_TEST_WORKSPACE_ROOT); console.log(JSON.stringify(require(path.join(root, "deploy/ecosystem.config.cjs")).apps.map(app => ({ name: app.name, pm2_env: { ...process.env, ...app.env, status: "online", pm_cwd: root, pm_exec_path: path.join(root, app.script) } }))));'`,
    'fi'
  ]);

  return {
    binDir,
    distDirectory,
    logFile,
    root,
    missingProcess,
    failingNpmCommand,
    cleanup: () => rmSync(root, { recursive: true, force: true })
  };
}

function writeExecutable(filePath, lines) {
  const directory = path.dirname(filePath);
  mkdirSync(directory, { recursive: true });
  writeFileSync(filePath, `${lines.join('\n')}\n`);
  chmodSync(filePath, 0o755);
}

function runDeployScript(fixture) {
  const bashCommand = resolveBashCommand();
  const isWindows = process.platform === 'win32';
  const gitBashRoot = isWindows && path.isAbsolute(bashCommand) ? resolveGitBashRoot(bashCommand) : null;
  const shellPathEntries = [fixture.binDir];

  if (gitBashRoot) {
    shellPathEntries.push(path.join(gitBashRoot, 'usr', 'bin'), path.join(gitBashRoot, 'bin'));
  } else {
    shellPathEntries.push(process.env.PATH ?? '');
  }

  return spawnSync(bashCommand, [isWindows ? toGitBashPath(deployScript) : deployScript], {
    cwd: workspaceRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      DEPLOY_TEST_LOG: isWindows ? toGitBashPath(fixture.logFile) : fixture.logFile,
      DEPLOY_TEST_MISSING_PROCESS: fixture.missingProcess,
      DEPLOY_TEST_FAILING_NPM_COMMAND: fixture.failingNpmCommand,
      DEPLOY_TEST_WORKSPACE_ROOT: workspaceRoot,
      KNOWRA_V4_DIST_DIR: isWindows
        ? toGitBashPath(path.join(fixture.binDir, '..', 'dist'))
        : path.join(fixture.binDir, '..', 'dist'),
      KNOWRA_DEPLOY_REPORT_DIR: isWindows
        ? toGitBashPath(path.join(fixture.binDir, '..', 'reports'))
        : path.join(fixture.binDir, '..', 'reports'),
      PATH: shellPathEntries
        .map(entry => (isWindows ? toGitBashPath(entry) : entry))
        .join(isWindows ? ':' : path.delimiter)
    }
  });
}

function resolveBashCommand() {
  if (process.platform !== 'win32') {
    return 'bash';
  }

  const candidates = [
    process.env.BASH_PATH,
    path.join(process.env.ProgramFiles ?? 'C:\\Program Files', 'Git', 'bin', 'bash.exe'),
    path.join(process.env.ProgramFiles ?? 'C:\\Program Files', 'Git', 'usr', 'bin', 'bash.exe'),
    path.join(process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)', 'Git', 'bin', 'bash.exe'),
    path.join(process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)', 'Git', 'usr', 'bin', 'bash.exe'),
    path.join(process.env.LOCALAPPDATA ?? '', 'Programs', 'Git', 'bin', 'bash.exe')
  ].filter(Boolean);

  return candidates.find(candidate => existsSync(candidate)) ?? 'bash';
}

function resolveGitBashRoot(bashCommand) {
  const bashDirectory = path.dirname(bashCommand);
  const parentDirectory = path.basename(path.dirname(bashDirectory)).toLowerCase();
  return parentDirectory === 'usr' ? path.resolve(bashDirectory, '..', '..') : path.resolve(bashDirectory, '..');
}

function toGitBashPath(filePath) {
  if (process.platform !== 'win32') {
    return filePath;
  }

  const absolutePath = path.resolve(filePath).replaceAll('\\', '/');
  return `/${absolutePath[0].toLowerCase()}${absolutePath.slice(2)}`;
}
