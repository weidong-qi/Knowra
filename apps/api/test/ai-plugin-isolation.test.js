import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createPersistentAppContext } from '../src/app.factory.js';
import { createServer } from '../src/server.js';
import { createOptionalAiRuntime, createUnavailableAiRuntime } from '../src/modules/ai/runtime.ts';
import { AI_PROCESS_LIMITS, createIsolatedDeepSeekAdapter } from '../src/modules/ai/isolated-provider.ts';
import { createIsolatedAiWorker } from '../src/modules/ai/isolated-worker.ts';
import { aiRecords } from './ai-record-fixtures.js';
import { beijingDay } from '../src/modules/ai/budget-ledger.ts';
import { measureCoreHttp, p95 } from './fixtures/ai-core-http-probe.mjs';
import { startHangProbe } from './fixtures/ai-hang-probe.mjs';

const childUrl = new URL('./fixtures/ai-process-fixture.mjs', import.meta.url);
const adapter = limits =>
  createIsolatedDeepSeekAdapter({ childUrl, limits: { ...AI_PROCESS_LIMITS, wallMs: 2000, ...limits } });

export const aiPluginIsolationTests = [
  {
    name: '真实默认供应商子进程归一化请求错误并释放进程与并发名额',
    async run() {
      const children = [];
      const exits = [];
      const isolated = createIsolatedDeepSeekAdapter({
        limits: { ...AI_PROCESS_LIMITS, concurrency: 1, queue: 0, wallMs: 5000 },
        spawn(...args) {
          const child = fork(...args);
          children.push(child);
          exits.push(once(child, 'exit'));
          return child;
        }
      });
      try {
        // 缺失 tools 在序列化阶段抛错，真实子进程不会发起供应商网络请求。
        for (let index = 0; index < 2; index++) {
          await assert.rejects(isolated.complete({}), error => {
            assert.equal(error.code, 'AI_PROVIDER_UNAVAILABLE');
            assert.equal(error.retryable, false);
            assert.equal(error.httpStatus, null);
            return true;
          });
        }
        assert.equal(children.length, 2);
        for (const [code, signal] of await Promise.all(exits)) {
          assert.equal(code, null);
          assert.equal(signal, 'SIGKILL');
        }
      } finally {
        for (const child of children) child.kill('SIGKILL');
      }
    }
  },
  {
    name: 'AI 子进程正常返回、异常退出、卡死和资源超限均有确定结果',
    async run() {
      assert.deepEqual(await adapter().complete({ mode: 'ok' }), { ok: true });
      await assert.rejects(adapter().complete({ mode: 'crash' }), error => error.code === 'AI_PROCESS_FAILED');
      await assert.rejects(
        adapter({ wallMs: 80 }).complete({ mode: 'hang' }),
        error => error.code === 'AI_PROCESS_TIMEOUT'
      );
      await assert.rejects(adapter().complete({ mode: 'limit' }), error => error.code === 'AI_PROCESS_LIMIT');
      if (process.platform !== 'win32') {
        await assert.rejects(
          adapter({ cpuMs: 10, wallMs: 4000 }).complete({ mode: 'spin' }),
          error => error.code === 'AI_PROCESS_LIMIT'
        );
      }
    }
  },
  {
    name: 'AI 子进程并发队列有上限且取消会终止等待',
    async run() {
      const isolated = adapter({ concurrency: 1, queue: 0, wallMs: 100 });
      const first = isolated.complete({ mode: 'hang' });
      await assert.rejects(isolated.complete({ mode: 'ok' }), error => error.code === 'AI_QUEUE_FULL');
      await assert.rejects(first, error => error.code === 'AI_PROCESS_TIMEOUT');
      const controller = new AbortController();
      const pending = adapter().complete({ mode: 'hang', signal: controller.signal });
      controller.abort();
      await assert.rejects(pending, error => error.code === 'AI_CANCELLED');
    }
  },
  {
    name: '独立任务进程只能经白名单桥读当前任务，崩溃后任务转失败',
    async run() {
      const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'knowra-ai-worker-process-'));
      try {
        const app = createPersistentAppContext({ storageRootDir: directory, ownerId: 'demo' });
        const repo = app.ai.repository;
        const records = aiRecords(await repo.identity(), 'r01');
        for (const [kind, record] of [
          ['scopeSnapshot', records.scope],
          ['contextManifest', records.manifest],
          ['aiGrant', records.grant],
          ['aiJob', records.job]
        ])
          await repo.insert(kind, record);
        const worker = createIsolatedAiWorker({
          repository: repo,
          budget: app.ai.budgetAuthority,
          gateway: app.ai.gateway,
          modelSettings: app.http.modelSettings,
          readContext: { verifyJobSources() {}, validateAnswer() {} },
          priceProfile: { version: 'expired', expiresAt: '2000-01-01T00:00:00.000Z' },
          allowExternal: true,
          childUrl: new URL('./fixtures/ai-worker-fixture.mjs', import.meta.url)
        });
        await assert.rejects(
          worker.run(records.job.jobId, { mode: 'probe' }),
          error => error.code === 'AI_BRIDGE_REJECTED'
        );
        assert.equal((await repo.get('aiJob', records.job.jobId)).status, 'failed');
        const crash = aiRecords(await repo.identity(), 'r02');
        for (const [kind, record] of [
          ['scopeSnapshot', crash.scope],
          ['contextManifest', crash.manifest],
          ['aiGrant', crash.grant],
          ['aiJob', crash.job]
        ])
          await repo.insert(kind, record);
        await assert.rejects(
          worker.run(crash.job.jobId, { mode: 'crash' }),
          error => error.code === 'AI_PROCESS_FAILED'
        );
        assert.equal((await repo.get('aiJob', crash.job.jobId)).status, 'failed');
        const sent = aiRecords(await repo.identity(), 'r04');
        for (const [kind, record] of [
          ['scopeSnapshot', sent.scope],
          ['contextManifest', sent.manifest],
          ['aiGrant', sent.grant],
          ['aiJob', { ...sent.job, status: 'running', phase: 'generating' }],
          ['aiJobAttempt', { ...sent.attempt, status: 'sent', deliveryUncertain: true }]
        ]) {
          await repo.insert(kind, record);
        }
        const day = beijingDay(new Date());
        await app.ai.budgetAuthority.reserve({
          accountRef: 'deepseek-primary',
          jobId: sent.job.jobId,
          attemptId: sent.attempt.attemptId,
          priceVersion: 'v1',
          reservedMicrounits: 10_000,
          day
        });
        await assert.rejects(
          worker.run(sent.job.jobId, { mode: 'crash' }),
          error => error.code === 'AI_PROCESS_FAILED'
        );
        assert.equal((await repo.get('aiJobAttempt', sent.attempt.attemptId)).status, 'timedOut');
        assert.equal((await repo.get('aiJob', sent.job.jobId)).status, 'failed');
        assert.equal(app.ai.budgetAuthority.status('deepseek-primary', day).heldMicrounits, 10_000);
        const credentialProbe = aiRecords(await repo.identity(), 'r08');
        for (const [kind, record] of [
          ['scopeSnapshot', credentialProbe.scope],
          ['contextManifest', credentialProbe.manifest],
          ['aiGrant', credentialProbe.grant],
          ['aiJob', { ...credentialProbe.job, status: 'running', phase: 'generating' }],
          ['aiJobAttempt', { ...credentialProbe.attempt, status: 'sent', deliveryUncertain: true }]
        ])
          repo.insert(kind, record);
        app.ai.budgetAuthority.reserve({
          accountRef: 'deepseek-primary',
          jobId: credentialProbe.job.jobId,
          attemptId: credentialProbe.attempt.attemptId,
          priceVersion: 'v1',
          reservedMicrounits: 10_000,
          day
        });
        await assert.rejects(
          worker.run(credentialProbe.job.jobId, {
            mode: 'credential-probe',
            attemptId: credentialProbe.attempt.attemptId
          }),
          error => error.code === 'AI_BRIDGE_REJECTED'
        );
        const queued = createIsolatedAiWorker({
          repository: repo,
          budget: app.ai.budgetAuthority,
          gateway: app.ai.gateway,
          modelSettings: app.http.modelSettings,
          readContext: { verifyJobSources() {}, validateAnswer() {} },
          priceProfile: { version: 'expired', expiresAt: '2000-01-01T00:00:00.000Z' },
          allowExternal: true,
          childUrl: new URL('./fixtures/ai-worker-fixture.mjs', import.meta.url),
          limits: { ...AI_PROCESS_LIMITS, concurrency: 1, queue: 1, wallMs: 200 }
        });
        const jobs = ['r05', 'r06', 'r07'].map(suffix => aiRecords(repo.identity(), suffix));
        for (const item of jobs)
          for (const [kind, record] of [
            ['scopeSnapshot', item.scope],
            ['contextManifest', item.manifest],
            ['aiGrant', item.grant],
            ['aiJob', item.job]
          ])
            repo.insert(kind, record);
        const first = queued.run(jobs[0].job.jobId, { mode: 'hang' });
        const second = queued.run(jobs[1].job.jobId, { mode: 'hang' });
        await assert.rejects(queued.run(jobs[2].job.jobId, { mode: 'hang' }), error => error.code === 'AI_QUEUE_FULL');
        await assert.rejects(first, error => error.code === 'AI_PROCESS_TIMEOUT');
        await assert.rejects(second, error => error.code === 'AI_PROCESS_TIMEOUT');
        const shutdown = aiRecords(repo.identity(), 'r09');
        for (const [kind, record] of [
          ['scopeSnapshot', shutdown.scope],
          ['contextManifest', shutdown.manifest],
          ['aiGrant', shutdown.grant],
          ['aiJob', shutdown.job]
        ])
          repo.insert(kind, record);
        const closing = createIsolatedAiWorker({
          repository: repo,
          budget: app.ai.budgetAuthority,
          gateway: app.ai.gateway,
          modelSettings: app.http.modelSettings,
          readContext: { verifyJobSources() {}, validateAnswer() {} },
          priceProfile: { version: 'expired', expiresAt: '2000-01-01T00:00:00.000Z' },
          allowExternal: true,
          childUrl: new URL('./fixtures/ai-worker-fixture.mjs', import.meta.url)
        });
        const interrupted = closing.run(shutdown.job.jobId, { mode: 'hang' });
        const stopped = assert.rejects(interrupted, error => error.code === 'AI_CANCELLED');
        await closing.close();
        await stopped;
        assert.equal(repo.get('aiJob', shutdown.job.jobId).status, 'cancelled');
        await assert.rejects(
          closing.run(shutdown.job.jobId, { mode: 'hang' }),
          error => error.code === 'AI_GENERATION_UNAVAILABLE'
        );
      } finally {
        fs.rmSync(directory, { recursive: true, force: true });
      }
    }
  },
  {
    name: '真实任务子进程可通过桥接校验并在核价门禁前停止',
    async run() {
      const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'knowra-ai-worker-bridge-'));
      try {
        const app = createPersistentAppContext({ storageRootDir: directory, ownerId: 'demo' });
        const repo = app.ai.repository;
        const records = aiRecords(await repo.identity(), 'r03');
        for (const [kind, record] of [
          ['scopeSnapshot', records.scope],
          ['contextManifest', records.manifest],
          ['aiGrant', records.grant],
          ['aiJob', records.job]
        ])
          await repo.insert(kind, record);
        const worker = createIsolatedAiWorker({
          repository: repo,
          budget: app.ai.budgetAuthority,
          gateway: app.ai.gateway,
          modelSettings: app.http.modelSettings,
          readContext: { verifyJobSources() {}, validateAnswer() {} },
          priceProfile: { version: 'expired', modelId: 'deepseek-flash', expiresAt: '2000-01-01T00:00:00.000Z' },
          allowExternal: true
        });
        const request = {
          modelId: 'deepseek-flash',
          credentialRef: records.job.credentialRef,
          messages: [{ role: 'user', content: '合成测试' }],
          tools: [],
          maxTokens: 100,
          format: 'text'
        };
        await assert.rejects(worker.run(records.job.jobId, request), error => error.code === 'AI_PRICE_UNAVAILABLE');
        assert.equal((await repo.get('aiJob', records.job.jobId)).status, 'failed');
        assert.equal((await repo.list('aiJobAttempt', { jobId: records.job.jobId })).length, 0);
      } finally {
        fs.rmSync(directory, { recursive: true, force: true });
      }
    }
  },
  {
    name: 'AI 禁用或装配失败时核心笔记仍能创建和保存',
    async run() {
      const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'knowra-ai-off-'));
      const before = process.env.KNOWRA_AI_ENABLED;
      try {
        process.env.KNOWRA_AI_ENABLED = '0';
        const app = createPersistentAppContext({ storageRootDir: directory, ownerId: 'demo' });
        assert.equal(app.ai.worker, null);
        assert.match(app.ai.unavailableReason, /关闭/);
        const space = app.http.knowledge.createDefaultKnowledgeSpace({});
        app.http.knowledge.createNote({ id: 'core-note', title: '核心笔记', rawMarkdown: '可保存', spaceId: space.id });
        assert.equal(app.dataStore.state.notes[0].rawMarkdown, '可保存');
        const failed = createOptionalAiRuntime({}, { enabled: true, logger: { warn() {} } });
        assert.equal(failed.worker, null);
        assert.match(failed.unavailableReason, /装配失败/);
      } finally {
        if (before === undefined) delete process.env.KNOWRA_AI_ENABLED;
        else process.env.KNOWRA_AI_ENABLED = before;
        fs.rmSync(directory, { recursive: true, force: true });
      }
    }
  },
  {
    name: 'JSON AI 私有状态损坏不覆盖原记录且不阻断核心笔记写入',
    async run() {
      const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'knowra-ai-private-failure-'));
      try {
        const first = createPersistentAppContext({ storageRootDir: directory, ownerId: 'demo' });
        const space = first.http.knowledge.createDefaultKnowledgeSpace({});
        first.http.knowledge.createNote({ id: 'before', title: '旧笔记', rawMarkdown: '保留', spaceId: space.id });
        const dataPath = path.join(directory, 'storage', 'data', 'knowledge-base.json');
        const raw = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
        raw.aiRuntime.version = 999;
        fs.writeFileSync(dataPath, JSON.stringify(raw));
        const second = createPersistentAppContext({ storageRootDir: directory, ownerId: 'demo' });
        assert.match(second.ai.unavailableReason, /私有存储/);
        assert.equal(second.dataStore.state.notes.find(note => note.id === 'before')?.rawMarkdown, '保留');
        second.http.knowledge.createNote({ id: 'after', title: '新笔记', rawMarkdown: '继续保存', spaceId: space.id });
        const saved = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
        assert.equal(saved.aiRuntime.version, 999);
        assert.equal(saved.notes.find(note => note.id === 'after')?.rawMarkdown, '继续保存');
      } finally {
        fs.rmSync(directory, { recursive: true, force: true });
      }
    }
  },
  {
    name: 'AI 私有 repository 运行中失效只关闭助手接口，核心 HTTP 保持可用',
    async run() {
      const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'knowra-ai-repository-failure-'));
      const context = createPersistentAppContext({ storageRootDir: directory, ownerId: 'demo' });
      context.ai.repository = {
        identity: () => {
          throw new Error('AI table unavailable');
        }
      };
      const server = createServer({ appContext: context, logger: { warn() {}, error() {} } });
      await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
      const base = `http://127.0.0.1:${server.address().port}`;
      try {
        const status = await (await fetch(`${base}/api/ai/assistant/status`)).json();
        assert.equal(status.data.generationAvailable, false);
        assert.match(status.data.unavailableReason, /私有存储/);
        const list = await fetch(`${base}/api/ai/assistant/jobs?spaceId=space-1`);
        assert.equal(list.status, 503);
        assert.equal((await fetch(`${base}/api/health`)).status, 200);
        const space = context.http.knowledge.createDefaultKnowledgeSpace({});
        context.http.knowledge.createNote({
          id: 'core-survives',
          title: '核心可用',
          rawMarkdown: '正文',
          spaceId: space.id
        });
        assert.equal((await fetch(`${base}/api/knowledge/notes/core-survives`)).status, 200);
      } finally {
        await new Promise(resolve => server.close(resolve));
        fs.rmSync(directory, { recursive: true, force: true });
      }
    }
  },
  {
    name: '核心 HTTP 采样要求足量样本且就绪 hang 进程退出后失效',
    async run() {
      assert.throws(() => p95(Array(8).fill(1)), /40/);
      assert.equal(p95(Array.from({ length: 40 }, (_, index) => index + 1)), 38);
      const probe = await startHangProbe();
      try {
        probe.assertActive();
      } finally {
        assert.equal((await probe.close()).error?.code, 'AI_CANCELLED');
      }
      assert.throws(() => probe.assertActive(), /仍在运行/);
    }
  },
  {
    name: 'AI 卡死进程仍按 600ms 墙钟预算超时',
    async run() {
      await assert.rejects(
        adapter({ wallMs: 600 }).complete({ mode: 'hang' }),
        error => error.code === 'AI_PROCESS_TIMEOUT'
      );
    }
  },
  {
    name: 'AI 执行进程卡死时核心 HTTP 笔记保存和同步状态仍响应',
    async run() {
      const off = await measureCoreHttp('off');
      const baseline = await measureCoreHttp('baseline');
      const fault = await measureCoreHttp('fault');
      const offP95 = p95(off),
        baselineP95 = p95(baseline),
        faultP95 = p95(fault);
      console.log(
        `R01 核心 HTTP 三操作样本：关闭 p95=${offP95.toFixed(1)}ms，空闲 p95=${baselineP95.toFixed(1)}ms，故障 p95=${faultP95.toFixed(1)}ms，故障最大=${Math.max(...fault).toFixed(1)}ms`
      );
      assert(faultP95 < Math.max(250, baselineP95 * 3), `核心请求 p95 ${faultP95.toFixed(1)}ms`);
      assert(Math.max(...fault) < 1000, `核心请求最大阻塞 ${Math.max(...fault).toFixed(1)}ms`);
    }
  }
];
