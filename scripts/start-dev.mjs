import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readRuntimePorts, writeRuntimePort } from './dev-runtime-ports.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const workspaceRoot = path.resolve(__dirname, '..');
const runtimePortsFile = path.join(workspaceRoot, 'storage', 'runtime', 'dev-ports.json');
const webCoreCompiler = path.join(workspaceRoot, 'node_modules', 'typescript', 'bin', 'tsc');
const webCoreTsconfig = path.join(workspaceRoot, 'packages', 'web-core', 'tsconfig.json');
const childProcesses = [];
// --lan：Vite 监听所有网卡供局域网设备预览；API 仍只在本机，经同源 /api 代理访问。
const lanEnabled = process.argv.includes('--lan');

const apiPort = await getFreePort(3001);
const webPort = await getFreePort(apiPort === 3000 ? 3002 : 3000);

cleanupRuntimePorts();

await runNodeScript([webCoreCompiler, '-p', webCoreTsconfig], {
  env: createChildEnv()
});

const apiEnv = createChildEnv({
  PORT: String(apiPort),
  STUDY_RUNTIME_PORTS_FILE: runtimePortsFile
});

const apiProcess = spawnNode(['apps/api/src/main.ts'], { env: apiEnv, name: 'api' });
let shuttingDown = false;

attachChildShutdown(apiProcess);

const actualApiPort = await waitForRuntimePort('api', 40, 250);

if (!actualApiPort) {
  shutdownWithError('API did not publish its runtime port in time.');
}

const apiReady = await waitForHttpOk(`http://localhost:${actualApiPort}/api/knowledge/spaces`, 40, 250);

if (!apiReady) {
  shutdownWithError(`API did not become ready at http://localhost:${actualApiPort} in time.`);
}

const webEntry = path.join(workspaceRoot, 'node_modules', 'vite', 'bin', 'vite.js');
const webProcess = spawnNode(
  [webEntry, '--port', String(webPort), '--strictPort', ...(lanEnabled ? ['--host', '0.0.0.0'] : [])],
  {
    env: createChildEnv({
      API_PORT: String(actualApiPort),
      STUDY_RUNTIME_PORTS_FILE: runtimePortsFile
    }),
    cwd: path.join(workspaceRoot, 'apps', 'web'),
    name: 'web'
  }
);
attachChildShutdown(webProcess);

const webReady = await waitForHttpOk(`http://localhost:${webPort}/`, 60, 250);

if (!webReady) {
  shutdownWithError(`Web did not become ready at http://localhost:${webPort} in time.`);
}

writeRuntimePort(runtimePortsFile, 'web', webPort);
writeRuntimePort(runtimePortsFile, 'web-v4', webPort);

console.log(`Study API: http://localhost:${actualApiPort}`);
console.log(`Study Web: http://localhost:${webPort}`);

if (lanEnabled) {
  const addresses = Object.values(os.networkInterfaces())
    .flat()
    .filter(entry => entry && entry.family === 'IPv4' && !entry.internal)
    .map(entry => entry.address);
  console.warn('局域网预览已开启：同一网络内任何设备都能以当前 owner 身份读写知识库，仅限可信网络。');
  for (const address of addresses) console.log(`Study Web (LAN): http://${address}:${webPort}`);
}

process.on('SIGINT', () => shutdownChildren(0));
process.on('SIGTERM', () => shutdownChildren(0));

function createChildEnv(overrides = {}) {
  return {
    ...process.env,
    ...overrides
  };
}

function cleanupRuntimePorts() {
  if (fs.existsSync(runtimePortsFile)) {
    fs.rmSync(runtimePortsFile, { force: true });
  }
}

function runNodeScript(args, options = {}) {
  const result = spawn(process.execPath, args, {
    cwd: workspaceRoot,
    env: options.env ?? createChildEnv(),
    stdio: 'inherit'
  });

  return new Promise((resolve, reject) => {
    result.once('exit', code => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`Script failed: ${args.join(' ')} (exit ${code ?? 'unknown'})`));
    });

    result.once('error', reject);
  });
}

function spawnNode(args, options) {
  const child = spawn(process.execPath, args, {
    cwd: options.cwd ?? workspaceRoot,
    env: options.env,
    stdio: 'inherit'
  });

  childProcesses.push(child);
  return child;
}

function attachChildShutdown(child) {
  child.once('exit', code => {
    if (shuttingDown) {
      return;
    }

    shutdownWithError(`Child process exited unexpectedly with code ${code ?? 'unknown'}.`);
  });

  child.once('error', error => {
    if (shuttingDown) {
      return;
    }

    shutdownWithError(`Child process failed to start: ${error.message}`);
  });
}

async function getFreePort(startPort, maxAttempts = 20) {
  for (let offset = 0; offset < maxAttempts; offset += 1) {
    const port = startPort + offset;
    const available = await canBindPort(port);

    if (available) {
      return port;
    }
  }

  throw new Error(`No available port found starting from ${startPort}`);
}

async function canBindPort(port) {
  const net = await import('node:net');

  return new Promise(resolve => {
    const server = net.createServer();

    server.once('error', () => resolve(false));
    server.listen(port, '127.0.0.1', () => {
      server.close(() => resolve(true));
    });
  });
}

async function waitForHttpOk(url, maxAttempts, delayMs) {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return true;
      }
    } catch {
      // The server may still be starting up.
    }

    await wait(delayMs);
  }

  return false;
}

async function waitForRuntimePort(service, maxAttempts, delayMs) {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const runtimePorts = readRuntimePorts(runtimePortsFile);
    const port = Number(runtimePorts[service]);

    if (Number.isInteger(port) && port > 0) {
      return port;
    }

    await wait(delayMs);
  }

  return null;
}

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function shutdownWithError(message) {
  console.error(message);
  shutdownChildren(1);
}

function shutdownChildren(code) {
  shuttingDown = true;
  for (const child of childProcesses) {
    if (!child.killed) {
      child.kill();
    }
  }
  process.exit(code);
}
