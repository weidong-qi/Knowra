import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { startLocalRuntime } from '../src/runtime-server.mjs';
import { createRuntimeServices } from '../src/runtime-services.mjs';
import { createAppContext } from '../../api/src/app.factory.js';
import { createFileDataStore } from '../../api/src/infrastructure/file-data-store.js';
import { createServer } from '../../api/src/server.js';

const logger = { warn() {}, error() {} };
const tick = () => new Promise(resolve => setImmediate(resolve));
async function reached(promise) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('合成恢复未到达预期阶段')), 2000);
      })
    ]);
  } finally {
    clearTimeout(timer);
  }
}
async function pending(promise) {
  let done = false;
  promise.then(
    () => {
      done = true;
    },
    () => {
      done = true;
    }
  );
  await tick();
  assert.equal(done, false, '仍须等待恢复收尾');
}
function directory() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'knowra-ai-lifecycle-')),
    distRoot = path.join(root, 'dist');
  fs.mkdirSync(distRoot);
  fs.writeFileSync(path.join(distRoot, 'index.html'), '<html><head></head><body>synthetic</body></html>');
  return { root, distRoot, dataDirectory: path.join(root, 'data') };
}
async function connect(runtime) {
  const cookie = (await fetch(runtime.launchUrl, { redirect: 'manual' })).headers.get('set-cookie').split(';')[0];
  return async (route, body) => {
    const response = await fetch(`${runtime.origin}${route}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        Cookie: cookie,
        'Content-Type': 'application/json',
        'X-Knowra-Dataset': runtime.store.getStatus().datasetId
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    });
    return { status: response.status, ...(await response.json()) };
  };
}

for (const fails of [false, true])
  test(`真实SQLite启动恢复${fails ? '一支先失败' : '挂起'}时并发关闭等待其余收尾`, { timeout: 5000 }, async () => {
    const f = directory(),
      entered = Promise.withResolvers(),
      release = Promise.withResolvers(),
      stopping = Promise.withResolvers();
    let runtime,
      closes = 0,
      reads = 0,
      repository;
    try {
      runtime = await startLocalRuntime({
        ...f,
        logger,
        syncOptions: { autoSync: false },
        aiRuntimeFactory(options) {
          repository = options.repository;
          const close = () => {
            if (++closes === 2) stopping.resolve();
          };
          return {
            conversationStore: {
              recoverInterrupted() {
                if (fails) throw new Error('synthetic recovery failure');
              }
            },
            agent: {
              async recover() {
                entered.resolve();
                await release.promise;
                repository.identity();
                reads++;
              },
              close
            },
            worker: { recover() {}, close }
          };
        }
      });
      await reached(entered.promise);
      const one = runtime.close(),
        two = runtime.close();
      assert.equal(one, two);
      await reached(stopping.promise);
      await pending(one);
      assert.equal(reads, 0);
      assert.ok(repository.identity().datasetId);
      release.resolve();
      await one;
      assert.equal(reads, 1);
      assert.throws(() => repository.identity(), /not open/);
      await runtime.close();
    } finally {
      release.resolve();
      await runtime?.close();
      fs.rmSync(f.root, { recursive: true, force: true });
    }
  });

test('真实SQLite listen失败先排空后台AI，再关库与释放目录锁', { timeout: 5000 }, async () => {
  const f = directory(),
    entered = Promise.withResolvers(),
    release = Promise.withResolvers(),
    stopping = Promise.withResolvers();
  const blocker = http.createServer();
  let starting,
    repository,
    reads = 0;
  try {
    await new Promise(resolve => blocker.listen(0, '127.0.0.1', resolve));
    starting = startLocalRuntime({
      ...f,
      port: blocker.address().port,
      logger,
      syncOptions: { autoSync: false },
      aiRuntimeFactory(options) {
        repository = options.repository;
        return {
          agent: {
            async recover() {
              entered.resolve();
              await release.promise;
              repository.identity();
              reads++;
            },
            close() {
              stopping.resolve();
            }
          }
        };
      }
    });
    const rejected = assert.rejects(starting, { code: 'EADDRINUSE' });
    await reached(entered.promise);
    await reached(stopping.promise);
    await pending(starting);
    assert.ok(repository.identity().datasetId);
    release.resolve();
    await rejected;
    assert.equal(reads, 1);
    assert.throws(() => repository.identity(), /not open/);
    const restarted = await startLocalRuntime({
      ...f,
      logger,
      syncOptions: { autoSync: false },
      aiRuntimeFactory: () => ({})
    });
    await restarted.close();
  } finally {
    release.resolve();
    await Promise.allSettled([starting]);
    await new Promise(resolve => blocker.close(resolve));
    fs.rmSync(f.root, { recursive: true, force: true });
  }
});

test('真实SQLite listen失败且AI关闭失败时保留目录锁，拒绝第二个存储owner', { timeout: 5000 }, async () => {
  const f = directory();
  try {
    // 失败启动没有返回关闭句柄；让独立子进程退出后再清理目录，避免泄漏 SQLite owner。
    const { stdout } = await promisify(execFile)(
      process.execPath,
      [fileURLToPath(new URL('./fixtures/ai-listen-close-failure.mjs', import.meta.url)), f.root],
      { timeout: 3000 }
    );
    const result = JSON.parse(stdout);
    assert.equal(result.startErrorCode, 'EADDRINUSE', stdout);
    assert.equal(result.closeError, 'synthetic close failure', stdout);
    assert.equal(result.oldStoreStillOpen, true, stdout);
    assert.equal(result.runtimeLockExists, true, stdout);
    assert.equal(result.lockOwnerPid, result.ownerPid, stdout);
    assert.equal(result.secondRuntimeStarted, false, stdout);
    assert.match(result.secondStartError, /本地数据目录已被使用/, stdout);
  } finally {
    fs.rmSync(f.root, { recursive: true, force: true });
  }
});

for (const rollback of [false, true])
  test(`真实SQLite恢复资料库${rollback ? '失败回滚' : '成功切换'}等待对应AI owner`, { timeout: 5000 }, async () => {
    const f = directory(),
      entered = Promise.withResolvers(),
      release = Promise.withResolvers(),
      stopping = Promise.withResolvers();
    let runtime,
      generation = 0,
      reads = 0,
      heldRepository;
    const repositories = [],
      recoveryStarts = [];
    try {
      runtime = await startLocalRuntime({
        ...f,
        logger,
        syncOptions: { autoSync: false },
        aiRuntimeFactory(options) {
          const current = ++generation,
            held = current === 1;
          repositories.push(options.repository);
          return {
            agent: {
              async recover() {
                recoveryStarts.push(current);
                if (held) {
                  heldRepository = options.repository;
                  entered.resolve();
                  await release.promise;
                }
                options.repository.identity();
                if (held) reads++;
              },
              close() {
                if (held) stopping.resolve();
              }
            }
          };
        }
      });
      const call = await connect(runtime);
      const backup = await call('/api/local-runtime/backup', {});
      assert.equal(backup.status, 201, JSON.stringify(backup));
      if (rollback) fs.mkdirSync(path.join(f.dataDirectory, 'active-dataset.json')); // 确定性阻断原子指针发布。
      const restoring = call(`/api/local-runtime/backups/${backup.data.id}/restore`, {
        confirmBackupId: backup.data.id
      });
      await reached(entered.promise);
      await reached(stopping.promise);
      await pending(restoring);
      assert.ok(heldRepository.identity().datasetId);
      release.resolve();
      const result = await restoring;
      assert.equal(result.status, rollback ? 422 : 200, JSON.stringify(result));
      assert.equal(reads, 1);
      assert.throws(() => heldRepository.identity(), /not open/);
      assert.equal(generation, rollback ? 3 : 2);
      if (rollback) {
        assert.equal(recoveryStarts.includes(2), false, '未开始的替换库恢复应在关闭后跳过');
        assert.throws(() => repositories[1].identity(), /not open/);
      }
      assert.ok(runtime.store.aiRepository.identity().datasetId);
    } finally {
      release.resolve();
      await runtime?.close();
      fs.rmSync(f.root, { recursive: true, force: true });
    }
  });

for (const stage of ['configure', 'worker'])
  test(`真实SQLite configure在${stage}阶段关闭AI后不再启动后续恢复`, { timeout: 5000 }, async () => {
    const f = directory(),
      entered = Promise.withResolvers(),
      release = Promise.withResolvers();
    const cloud = createServer({
      appContext: createAppContext({ dataStore: createFileDataStore(path.join(f.root, 'cloud.json')) }),
      logger
    });
    let services,
      calls = 0,
      agentCalls = 0,
      holdStatus = true;
    try {
      await new Promise(resolve => cloud.listen(0, '127.0.0.1', resolve));
      services = createRuntimeServices({
        dataDirectory: f.dataDirectory,
        logger,
        syncOptions: {
          autoSync: false,
          fetcher: async (url, options) => {
            if (stage === 'configure' && holdStatus && url.endsWith('/status')) {
              holdStatus = false;
              entered.resolve();
              await release.promise;
            }
            return fetch(url, options);
          }
        },
        aiRuntimeFactory(options) {
          return {
            worker: {
              async recover() {
                calls++;
                if (stage === 'worker' && calls === 2) {
                  entered.resolve();
                  await release.promise;
                }
                options.repository.identity();
              },
              close() {}
            },
            agent: {
              recover() {
                agentCalls++;
              },
              close() {}
            }
          };
        }
      });
      await services.recoverAi;
      const configuring = services.sync.configure({ serverUrl: `http://127.0.0.1:${cloud.address().port}` });
      await reached(entered.promise);
      const closing = services.closeAi();
      assert.equal(closing, services.closeAi());
      if (stage === 'worker') await pending(closing);
      else await closing;
      release.resolve();
      await configuring;
      await closing;
      assert.equal(calls, stage === 'worker' ? 2 : 1);
      assert.equal(agentCalls, 1);
    } finally {
      release.resolve();
      await services?.sync.close();
      await services?.closeAi();
      services?.store.close();
      await new Promise(resolve => cloud.close(resolve));
      await cloud.closeAi();
      fs.rmSync(f.root, { recursive: true, force: true });
    }
  });
