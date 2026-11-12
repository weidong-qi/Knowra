import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createServer } from '../src/server.js';
import { createPersistentAppContext } from '../src/app.factory.js';
import { createPostgresAppContext } from '../src/postgres-app.factory.js';
import { createIsolatedAiWorker } from '../src/modules/ai/isolated-worker.js';
import { createAiAgentWorker } from '../src/modules/ai/agent-worker.ts';
import { aiRuntimeLifecycle } from '../src/modules/ai/runtime-lifecycle.ts';
import { createMaintenanceGate } from '../src/infrastructure/maintenance-gate.ts';
import { createPostgresTestDatabase } from '../../../scripts/test-support/postgres-test-database.mjs';

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
const logger = { warn() {}, error() {} };
const stopHttp = server =>
  server.listening
    ? new Promise((resolve, reject) => server.close(error => (error ? reject(error) : resolve())))
    : Promise.resolve();
async function serve(app) {
  const server = createServer({ appContext: app, logger });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return server;
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
  assert.equal(done, false, '关闭必须仍等待已接纳恢复收尾');
}

export const aiRuntimeLifecycleTests = [
  {
    name: 'AI 生命周期：真实 HTTP 启动 isolated worker，关闭等待恢复且关闭后不再读库',
    async run() {
      const entered = Promise.withResolvers(),
        release = Promise.withResolvers();
      let closed = false,
        reads = 0;
      const worker = createIsolatedAiWorker({
        budget: {},
        gateway: {},
        modelSettings: {},
        repository: {
          async identity() {
            reads++;
            entered.resolve();
            await release.promise;
            return { datasetId: 'synthetic', datasetEpoch: 'synthetic' };
          },
          async list() {
            reads++;
            assert.equal(closed, false);
            return [];
          }
        }
      });
      const server = await serve({ ai: { worker }, http: {} });
      try {
        await reached(entered.promise);
        await stopHttp(server); // 原生 HTTP close 仍只排空网络。
        const one = worker.close(),
          two = worker.close();
        assert.equal(one, two);
        await pending(one);
        release.resolve();
        await Promise.all([one, two, server.closeAi()]);
        closed = true;
        const before = reads;
        await assert.rejects(worker.recover(), { code: 'AI_GENERATION_UNAVAILABLE' });
        assert.equal(reads, before);
      } finally {
        release.resolve();
        await stopHttp(server);
        await server.closeAi();
      }
    }
  },
  {
    name: 'AI 生命周期：Agent 恢复成功/失败均排空，重复 close 共享完成责任',
    async run() {
      for (const fails of [false, true]) {
        const entered = Promise.withResolvers(),
          release = Promise.withResolvers();
        let reads = 0,
          closed = false;
        const agent = createAiAgentWorker({
          store: {
            async recoverInterrupted() {
              reads++;
              entered.resolve();
              await release.promise;
              if (fails) throw new Error('synthetic recovery failure');
            },
            async listModelAttempts() {
              reads++;
              assert.equal(closed, false);
              return [];
            },
            async listTurns() {
              reads++;
              assert.equal(closed, false);
              return [];
            }
          },
          modelSettings: {},
          budget: {},
          gateway: {},
          priceProfile: {}
        });
        const recovering = agent.recover(),
          result = Promise.allSettled([recovering]);
        try {
          await reached(entered.promise);
          const one = agent.close(),
            two = agent.close();
          assert.equal(one, two);
          await pending(one);
          release.resolve();
          await one;
          assert.equal((await result)[0].status, fails ? 'rejected' : 'fulfilled');
          closed = true;
          const before = reads;
          await assert.rejects(agent.recover(), { code: 'AI_GENERATION_UNAVAILABLE' });
          assert.equal(reads, before);
        } finally {
          release.resolve();
          await agent.close();
        }
      }
    }
  },
  {
    name: 'AI 生命周期：JSON 持库 owner 排空多 HTTP 启动链，关闭阻止后续阶段',
    async run() {
      const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'knowra-ai-owner-'));
      const entered = Promise.withResolvers(),
        release = Promise.withResolvers();
      const context = createPersistentAppContext({ storageRootDir: directory });
      const servers = [];
      let conversations = 0,
        later = 0,
        closes = 0;
      context.ai = {
        conversationStore: {
          async recoverInterrupted() {
            if (++conversations === 2) entered.resolve();
            await release.promise;
            context.dataStore.aiRepository.identity();
          }
        },
        agent: {
          recover() {
            later++;
          },
          close() {
            closes++;
          }
        },
        worker: {
          recover() {
            later++;
          },
          close() {
            closes++;
          }
        }
      };
      try {
        servers.push(await serve(context));
        servers.push(await serve(context));
        await reached(entered.promise);
        const response = await fetch(`http://127.0.0.1:${servers[0].address().port}/api/health`);
        assert.equal(response.status, 200);
        await Promise.all(servers.map(stopHttp));
        const one = context.close(),
          two = context.close();
        assert.equal(one, two);
        await pending(servers[0].closeAi());
        await pending(one);
        assert.equal(closes, 2, '恢复仍挂起时已经开始停止执行器');
        release.resolve();
        await one;
        assert.equal(later, 0);
        assert.equal(closes, 2);
        await assert.rejects(aiRuntimeLifecycle(context.ai).recover(), { code: 'AI_GENERATION_UNAVAILABLE' });
        assert.equal(conversations, 2);
      } finally {
        release.resolve();
        await Promise.all(servers.map(stopHttp));
        await context.close();
        fs.rmSync(directory, { recursive: true, force: true });
      }
    }
  },
  {
    name: 'AI 生命周期：启动未进入/阶段失败/关闭失败均保留排空边界且不持维护门',
    async run() {
      let calls = 0;
      const runtime = {
        conversationStore: {
          recoverInterrupted() {
            calls++;
          }
        }
      };
      const server = createServer({ appContext: { ai: runtime, http: {} }, logger });
      await server.closeAi();
      assert.equal(calls, 0);
      const gate = createMaintenanceGate(),
        entered = Promise.withResolvers(),
        release = Promise.withResolvers();
      let after = 0;
      const owner = aiRuntimeLifecycle({
        conversationStore: {
          recoverInterrupted: () =>
            gate.runMutation(async () => {
              entered.resolve();
              await release.promise;
              throw new Error('synthetic recovery failure');
            })
        },
        agent: {
          recover() {
            after++;
          },
          close() {
            throw new Error('synthetic close failure');
          }
        }
      });
      const recovered = Promise.allSettled([owner.recover()]);
      await reached(entered.promise);
      const closing = owner.close(),
        rejected = assert.rejects(closing, /AI 执行器关闭失败/);
      const maintenance = gate.runMaintenance(() => {});
      await pending(closing);
      release.resolve();
      await rejected;
      await recovered;
      await maintenance;
      assert.equal(after, 0);
      assert.equal(owner.close(), closing);
      assert.deepEqual(gate.getState(), { activeOperations: 0, maintenanceActive: false, waitingMaintenances: 0 });
    }
  }
];

export const aiRuntimeLifecyclePostgresTests = process.env.KNOWRA_SYNC_TEST_DATABASE_URL
  ? [
      {
        name: 'AI PostgreSQL 持库 close 等完整启动链后才 disconnect，替换 runtime 与并发关闭均受管',
        async run() {
          const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'knowra-ai-owner-pg-'));
          const entered = Promise.withResolvers(),
            release = Promise.withResolvers();
          let database,
            app,
            server,
            disconnected = false,
            reads = 0,
            later = 0;
          try {
            database = await createPostgresTestDatabase();
            app = await createPostgresAppContext({ databaseUrl: database.databaseUrl, storageRootDir: directory });
            const disconnect = app.prisma.$disconnect.bind(app.prisma);
            app.prisma.$disconnect = async () => {
              disconnected = true;
              await disconnect();
            };
            app.ai = {
              conversationStore: {
                async recoverInterrupted() {
                  entered.resolve();
                  await release.promise;
                  assert.equal(disconnected, false);
                  reads++;
                  await app.prisma.$queryRawUnsafe('SELECT 1');
                }
              },
              agent: {
                recover() {
                  later++;
                },
                close() {}
              },
              worker: {
                recover() {
                  later++;
                },
                close() {}
              }
            };
            server = await serve(app);
            await reached(entered.promise);
            await stopHttp(server);
            const one = app.close(),
              two = app.close();
            assert.equal(one, two);
            await pending(one);
            assert.equal(disconnected, false);
            release.resolve();
            await one;
            assert.equal(disconnected, true);
            assert.equal(reads, 1);
            assert.equal(later, 0);
            await assert.rejects(aiRuntimeLifecycle(app.ai).recover(), { code: 'AI_GENERATION_UNAVAILABLE' });
            assert.equal(reads, 1);
          } finally {
            release.resolve();
            if (server) await stopHttp(server);
            await app?.close();
            await database?.close();
            fs.rmSync(directory, { recursive: true, force: true });
          }
        }
      }
    ]
  : [];
