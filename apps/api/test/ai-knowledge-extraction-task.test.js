import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { createAppContext } from '../src/app.factory.js';
import { createFileDataStore } from '../src/infrastructure/file-data-store.ts';
import { createMaintenanceGate } from '../src/infrastructure/maintenance-gate.ts';
import { hashRecord } from '../src/modules/ai/record-contract.ts';
import { createAiWorker } from '../src/modules/ai/worker.js';
import {
  createExtractionTaskSources,
  extractionTaskGateway,
  deferredTaskResponse,
  quietTaskLogger
} from './fixtures/knowledge-extraction-task.fixture.js';
import { assertMinimalProvenanceTransport } from './fixtures/knowledge-artifact-provenance.fixture.js';

async function fixture(run, { onCall, storeOptions, maintenanceGate } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'knowra-extraction-task-')),
    file = path.join(root, 'data.json');
  const mock = extractionTaskGateway(onCall),
    services = [];
  let time = new Date('2026-10-02T12:00:00.000Z');
  const clock = () => time;
  const open = (store = createFileDataStore(file, storeOptions), config = {}) => {
    const app = createAppContext({
      dataStore: store,
      ownerId: 'demo',
      storageRootDir: root,
      uploadsDir: path.join(root, 'uploads'),
      knowledgeExtractionMock: {
        gateway: mock.gateway,
        clock,
        schedule() {},
        logger: quietTaskLogger,
        maintenanceGate,
        ...config
      }
    });
    services.push(app.knowledgeExtractionTasks);
    return app;
  };
  try {
    const app = open();
    await run({
      root,
      file,
      app,
      open,
      mock,
      clock,
      advance: ms => {
        time = new Date(time.getTime() + ms);
      },
      ...(await createExtractionTaskSources(app))
    });
  } finally {
    for (const service of services) await service?.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
}
const counts = ai =>
  ['scopeSnapshot', 'contextManifest', 'aiGrant', 'aiJob', 'aiJobAttempt'].map(kind => ai.list(kind).length);

export const aiKnowledgeExtractionTaskTests = [
  {
    name: '已保存提炼范围切私密后阻止原资料任务创建与模型调用',
    async run() {
      await fixture(async f => {
        const repo = f.app.modules.knowledge.repositories.noteRepository;
        repo.save({ ...repo.findById(f.note.id), aiVisibility: 'private' });
        await assert.rejects(f.app.knowledgeExtractionTasks.start(f.input), {
          code: 'KNOWLEDGE_EXTRACTION_SOURCE_UNAVAILABLE'
        });
        assert.deepEqual(counts(f.app.dataStore.aiRepository), [0, 0, 0, 0, 0]);
        assert.equal(f.mock.calls.length, 0);
      });
    }
  },
  {
    name: '02C 自动恢复在异步事务中关闭须等收尾，关闭后不可重新恢复且不持维护门等待',
    async run() {
      const probe = fileURLToPath(new URL('./fixtures/knowledge-extraction-recovery-close.probe.js', import.meta.url));
      const { stdout } = await promisify(execFile)(process.execPath, [probe], { timeout: 15_000 });
      assert.match(stdout, /startup recovery close tracking passed/);
    }
  },
  {
    name: '02B direct run 与排队共享运行跟踪，idle/close 不忙循环且等待收尾',
    async run() {
      const probe = fileURLToPath(new URL('./fixtures/knowledge-extraction-worker-tracking.probe.js', import.meta.url));
      const { stdout } = await promisify(execFile)(process.execPath, [probe], { timeout: 15_000 });
      assert.match(stdout, /direct run \+ queued idle\/close passed/);
    }
  },
  {
    name: '02B JSON start 真实创建依赖束、Mock执行与原子接纳；同键和重启只复用一次',
    async run() {
      await fixture(async f => {
        const service = f.app.knowledgeExtractionTasks,
          ai = f.app.dataStore.aiRepository;
        const job = await service.start(f.input);
        assert.equal(job.status, 'pending');
        assert.deepEqual(counts(ai), [1, 1, 1, 1, 0]);
        assert.equal(f.app.dataStore.state.knowledgeItems.length, 0);
        assert.deepEqual(await service.start(f.input), job);
        assert.deepEqual(counts(ai), [1, 1, 1, 1, 0]);
        const descriptor = f.app.dataStore.knowledgeExtractionTaskStore.get({
          ...ai.identity(),
          ownerId: 'demo',
          jobId: job.jobId
        });
        descriptor.scopeId = 'caller-mutation';
        await service.idle();
        const result = await service.get(job.jobId);
        assert.equal(result.status, 'succeeded');
        assert.equal(result.executionMode, 'mock');
        assert.equal(result.candidateIds.length, 1);
        assert.equal(f.mock.calls.length, 1);
        assert.equal(JSON.stringify(f.mock.calls).includes(f.excluded), false);
        assert.equal(f.mock.calls[0].maxTokens, 8192);
        assert.deepEqual(f.mock.calls[0].tools, []);
        assert.equal(ai.get('aiJob', job.jobId).resultJson, undefined);
        assert.deepEqual(counts(ai), [1, 1, 1, 1, 1]);
        const item = f.app.modules.knowledge.knowledgeItemService.getItem(result.candidateIds[0]);
        f.app.modules.knowledge.knowledgeItemService.updateItem(item.id, {
          title: '用户修订',
          expectedUpdatedAt: item.updatedAt
        });
        const reopened = f.open();
        assert.deepEqual(await reopened.knowledgeExtractionTasks.get(job.jobId), result);
        assert.deepEqual(await reopened.knowledgeExtractionTasks.start(f.input), result);
        assert.equal(await reopened.knowledgeExtractionTasks.recover(), 0);
        assert.equal(reopened.modules.knowledge.knowledgeItemService.getItem(item.id).title, '用户修订');
        assert.equal(f.mock.calls.length, 1);
        assert.equal(JSON.stringify(result).includes('credential'), false);
        assert.equal(JSON.stringify(f.app.dataStore.exportSnapshot()).includes('creationHash'), false);
        const provenance = f.app.dataStore.state.knowledgeArtifactProvenance[0];
        assert.equal(provenance.origin.jobId, job.jobId);
        assertMinimalProvenanceTransport(f.app.dataStore.getSyncJournal(), provenance);
      });
    }
  },
  {
    name: '02B JSON 创建每个依赖/描述或最终写盘失败整束回滚，同键异范围拒绝',
    async run() {
      for (const stage of ['scopeSnapshot', 'contextManifest', 'aiGrant', 'aiJob', 'descriptor'])
        await fixture(async f => {
          const store = f.app.dataStore,
            ai = store.aiRepository,
            target = stage === 'descriptor' ? store.knowledgeExtractionTaskStore : ai;
          const insert = target.insert;
          target.insert = (...args) => {
            if (stage === 'descriptor' || args[0] === stage) throw new Error('injected task creation');
            return insert(...args);
          };
          const before = fs.readFileSync(f.file, 'utf8');
          await assert.rejects(f.app.knowledgeExtractionTasks.start(f.input), /injected/);
          assert.equal(fs.readFileSync(f.file, 'utf8'), before);
          assert.deepEqual(counts(ai), [0, 0, 0, 0, 0]);
          assert.equal(store.knowledgeExtractionTaskStore.list({ ownerId: 'demo', ...ai.identity() }).length, 0);
        });
      let fail = false;
      await fixture(
        async f => {
          const before = fs.readFileSync(f.file, 'utf8');
          fail = true;
          await assert.rejects(f.app.knowledgeExtractionTasks.start(f.input), { code: 'STORAGE_WRITE_FAILED' });
          assert.equal(fs.readFileSync(f.file, 'utf8'), before);
          assert.deepEqual(counts(f.app.dataStore.aiRepository), [0, 0, 0, 0, 0]);
          fail = false;
          await f.app.knowledgeExtractionTasks.start(f.input);
          const other = await createExtractionTaskSources(f.app, '-other');
          await assert.rejects(f.app.knowledgeExtractionTasks.start({ ...f.input, scopeId: other.scope.id }), {
            code: 'AI_IDEMPOTENCY_CONFLICT'
          });
        },
        {
          storeOptions: {
            writeJson(file, value) {
              if (fail) throw new Error('injected final write');
              fs.writeFileSync(file, JSON.stringify(value));
            }
          }
        }
      );
    }
  },
  {
    name: '02B JSON 两执行器争抢只发一次，领取job和attempt同事务',
    async run() {
      const deferred = deferredTaskResponse();
      await fixture(
        async f => {
          const service = f.app.knowledgeExtractionTasks,
            job = await service.start(f.input);
          const other = f.open(f.app.dataStore).knowledgeExtractionTasks;
          const first = service.run(job.jobId);
          await deferred.called;
          await assert.rejects(other.run(job.jobId), { code: 'KNOWLEDGE_EXTRACTION_NOT_RUNNABLE' });
          assert.equal((await service.get(job.jobId)).status, 'running');
          deferred.release();
          await first;
          assert.equal(f.mock.calls.length, 1);
          assert.equal((await service.get(job.jobId)).status, 'succeeded');
        },
        { onCall: deferred.onCall }
      );
      await fixture(async f => {
        const job = await f.app.knowledgeExtractionTasks.start(f.input),
          ai = f.app.dataStore.aiRepository,
          insert = ai.insert;
        ai.insert = (kind, value) => {
          if (kind === 'aiJobAttempt') throw new Error('injected claim');
          return insert(kind, value);
        };
        await assert.rejects(f.app.knowledgeExtractionTasks.run(job.jobId), /injected claim/);
        assert.equal(ai.list('aiJobAttempt').length, 0);
        assert.equal(ai.get('aiJob', job.jobId).status, 'failed');
        assert.equal(f.mock.calls.length, 0);
      });
    }
  },
  {
    name: '02B JSON 取消排队/在途与已提交竞争，晚到Mock结果不能写候选',
    async run() {
      await fixture(async f => {
        const job = await f.app.knowledgeExtractionTasks.start(f.input);
        assert.equal((await f.app.knowledgeExtractionTasks.cancel(job.jobId)).status, 'cancelled');
        await f.app.knowledgeExtractionTasks.idle();
        assert.equal(f.mock.calls.length, 0);
        await assert.rejects(f.app.knowledgeExtractionTasks.retry(job.jobId), {
          code: 'KNOWLEDGE_EXTRACTION_NOT_RETRYABLE'
        });
      });
      const deferred = deferredTaskResponse();
      await fixture(
        async f => {
          const service = f.app.knowledgeExtractionTasks,
            job = await service.start(f.input);
          const executing = service.run(job.jobId);
          const failure = assert.rejects(executing);
          await deferred.called;
          await service.cancel(job.jobId);
          await failure;
          deferred.release();
          await new Promise(resolve => setImmediate(resolve));
          assert.equal(f.app.dataStore.state.knowledgeItems.length, 0);
          assert.equal(f.app.dataStore.aiRepository.list('aiJobAttempt')[0].status, 'cancelled');
        },
        { onCall: deferred.onCall }
      );
      await fixture(async f => {
        const job = await f.app.knowledgeExtractionTasks.start(f.input);
        await f.app.knowledgeExtractionTasks.idle();
        assert.equal((await f.app.knowledgeExtractionTasks.cancel(job.jobId)).status, 'succeeded');
      });
    }
  },
  {
    name: '02B JSON 重启恢复不自动执行，显式重试复用旧绑定且最多四代',
    async run() {
      await fixture(async f => {
        const job = await f.app.knowledgeExtractionTasks.start(f.input),
          reopened = f.open().knowledgeExtractionTasks;
        assert.equal(await reopened.recover(), 1);
        assert.equal(f.mock.calls.length, 0);
        assert.equal((await reopened.get(job.jobId)).status, 'failed');
        await reopened.retry(job.jobId);
        await reopened.idle();
        assert.equal((await reopened.get(job.jobId)).status, 'succeeded');
      });
      await fixture(
        async f => {
          const service = f.app.knowledgeExtractionTasks,
            job = await service.start(f.input);
          for (let i = 0; i < 4; i++) {
            if (i) await service.retry(job.jobId);
            await service.idle();
            assert.equal((await service.get(job.jobId)).status, 'failed');
          }
          assert.deepEqual(
            f.app.dataStore.aiRepository.list('aiJobAttempt').map(item => item.leaseGeneration),
            [1, 2, 3, 4]
          );
          await assert.rejects(service.retry(job.jobId), { code: 'KNOWLEDGE_EXTRACTION_ATTEMPT_LIMIT' });
          assert.equal(f.mock.calls.length, 4);
        },
        {
          onCall() {
            throw Object.assign(new Error('synthetic failure'), { code: 'AI_MOCK_FAILED' });
          }
        }
      );
    }
  },
  {
    name: '02B JSON 取消与过期恢复的最终写盘失败同步回滚job和attempt',
    async run() {
      for (const operation of ['cancel', 'recover']) {
        const deferred = deferredTaskResponse();
        let fail = false;
        await fixture(
          async f => {
            const service = f.app.knowledgeExtractionTasks,
              ai = f.app.dataStore.aiRepository;
            const job = await service.start(f.input),
              executing = service.run(job.jobId),
              failed = assert.rejects(executing);
            await deferred.called;
            if (operation === 'recover') f.advance(120001);
            const before = fs.readFileSync(f.file, 'utf8');
            fail = true;
            await assert.rejects(service[operation](job.jobId), { code: 'STORAGE_WRITE_FAILED' });
            fail = false;
            assert.equal(fs.readFileSync(f.file, 'utf8'), before);
            assert.equal((await service.get(job.jobId)).status, 'running');
            assert.equal(ai.list('aiJobAttempt')[0].status, 'sent');
            await service[operation](job.jobId);
            await failed;
            deferred.release();
            assert.equal((await service.get(job.jobId)).status, operation === 'cancel' ? 'cancelled' : 'failed');
            assert.equal(ai.list('aiJobAttempt')[0].status, operation === 'cancel' ? 'cancelled' : 'timedOut');
            assert.equal(f.app.dataStore.state.knowledgeItems.length, 0);
          },
          {
            onCall: deferred.onCall,
            storeOptions: {
              writeJson(file, value) {
                if (fail) throw new Error('injected lifecycle write');
                fs.writeFileSync(file, JSON.stringify(value));
              }
            }
          }
        );
      }
    }
  },
  {
    name: '02B JSON 运行租约过期恢复、发送前撤权/来源/epoch复核与旧版本stale',
    async run() {
      const deferred = deferredTaskResponse();
      await fixture(
        async f => {
          const service = f.app.knowledgeExtractionTasks,
            job = await service.start(f.input);
          const running = service.run(job.jobId);
          const failure = assert.rejects(running);
          await deferred.called;
          assert.equal(await service.recover(), 0);
          f.advance(120001);
          assert.equal(await service.recover(), 1);
          await failure;
          deferred.release();
          assert.equal(f.app.dataStore.aiRepository.list('aiJobAttempt')[0].status, 'timedOut');
        },
        { onCall: deferred.onCall }
      );
      for (const change of ['revoke', 'extendGrant', 'expire', 'delete', 'scope', 'epoch', 'move'])
        await fixture(async f => {
          const job = await f.app.knowledgeExtractionTasks.start(f.input),
            ai = f.app.dataStore.aiRepository;
          let service = f.app.knowledgeExtractionTasks;
          if (change === 'revoke') {
            const grant = ai.list('aiGrant')[0];
            ai.replace('aiGrant', { ...grant, revokedAt: f.clock().toISOString() }, hashRecord(grant));
          }
          if (change === 'extendGrant') {
            const grant = ai.list('aiGrant')[0],
              expiresAt = new Date(f.clock().getTime() + 600000).toISOString();
            assert.throws(() => ai.replace('aiGrant', { ...grant, expiresAt }, hashRecord(grant)), {
              code: 'AI_RECORD_IMMUTABLE'
            });
            // 模拟磁盘上的有效 v1 记录被延长；私有 profile 仍须拒绝这种配置漂移。
            const data = JSON.parse(fs.readFileSync(f.file, 'utf8'));
            data.aiRuntime.grants[0].expiresAt = expiresAt;
            fs.writeFileSync(f.file, JSON.stringify(data));
            service = f.open().knowledgeExtractionTasks;
          }
          if (change === 'expire') f.advance(300001);
          if (change === 'delete') f.app.modules.knowledge.noteService.deleteNote(f.note.id);
          if (change === 'scope')
            f.app.modules.knowledge.repositories.analysisScopeRepository.save({
              ...f.scope,
              deletedAt: f.clock().toISOString()
            });
          if (change === 'epoch') f.app.dataStore.importSnapshot(f.app.dataStore.exportSnapshot());
          if (change === 'move') {
            const space = f.app.modules.knowledge.knowledgeSpaceService.createKnowledgeSpace({
              userId: 'demo',
              name: '另一个空间'
            });
            f.app.modules.knowledge.repositories.noteRepository.save({ ...f.note, spaceId: space.id });
          }
          await assert.rejects(service.run(job.jobId));
          assert.equal(f.mock.calls.length, 0);
          assert.equal(f.app.dataStore.state.knowledgeItems.length, 0);
        });
      await fixture(async f => {
        const job = await f.app.knowledgeExtractionTasks.start(f.input);
        f.app.modules.knowledge.noteService.updateNote(f.note.id, { rawMarkdown: '新的合成正文' });
        await f.app.knowledgeExtractionTasks.idle();
        assert.equal((await f.app.knowledgeExtractionTasks.get(job.jobId)).status, 'succeeded');
        assert.equal(f.app.dataStore.state.knowledgeEvidence[0].status, 'stale');
      });
    }
  },
  {
    name: '02B JSON 损坏/未来描述隔离，默认未启用，非Mock在创建前阻断',
    async run() {
      await fixture(async f => {
        const plain = createAppContext({ dataStore: f.app.dataStore, ownerId: 'demo', storageRootDir: f.root });
        assert.equal(plain.knowledgeExtractionTasks, null);
        const rejected = f.open(f.app.dataStore, {
          gateway: {
            complete() {
              throw new Error('must not call');
            },
            capabilities: () => ({ provider: 'deepseek' })
          }
        });
        await assert.rejects(rejected.knowledgeExtractionTasks.start(f.input), {
          code: 'KNOWLEDGE_EXTRACTION_MOCK_ONLY'
        });
        for (const input of [
          { ...f.input, ownerId: 'other' },
          { ...f.input, result: {} },
          Object.assign(Object.create({ scopeId: f.input.scopeId }), {
            idempotencyKey: f.input.idempotencyKey,
            ownerId: 'other'
          })
        ]) {
          await assert.rejects(f.app.knowledgeExtractionTasks.start(input));
        }
        await f.app.knowledgeExtractionTasks.start(f.input);
        const data = JSON.parse(fs.readFileSync(f.file, 'utf8'));
        data.aiKnowledgeExtractionTasks.version = 99;
        fs.writeFileSync(f.file, JSON.stringify(data));
        const bad = f.open();
        assert.equal(bad.knowledgeExtractionTasks, null);
        bad.modules.knowledge.noteService.updateNote(f.note.id, { rawMarkdown: '扩展损坏旁的正常编辑' });
        assert.equal(JSON.parse(fs.readFileSync(f.file, 'utf8')).aiKnowledgeExtractionTasks.version, 99);
      });
    }
  },
  {
    name: '02B JSON 维护门不跨Mock等待；旧answer恢复器不修改提炼任务或预算',
    async run() {
      const gate = createMaintenanceGate(),
        deferred = deferredTaskResponse();
      await fixture(
        async f => {
          const service = f.app.knowledgeExtractionTasks,
            job = await service.start(f.input),
            ai = f.app.dataStore.aiRepository;
          const legacy = createAiWorker({
            repository: ai,
            gateway: {},
            budget: {
              settle() {
                throw new Error('must not settle extraction');
              }
            }
          });
          const before = fs.readFileSync(f.file, 'utf8');
          assert.equal(await legacy.recover(), 0);
          assert.equal(fs.readFileSync(f.file, 'utf8'), before);
          const running = service.run(job.jobId);
          const failure = assert.rejects(running);
          await deferred.called;
          assert.equal(gate.getState().activeOperations, 0);
          await gate.runMaintenance(() => f.app.dataStore.importSnapshot(f.app.dataStore.exportSnapshot()));
          deferred.release();
          await failure;
          assert.equal(f.app.dataStore.state.knowledgeItems.length, 0);
        },
        { onCall: deferred.onCall, maintenanceGate: gate }
      );
    }
  }
];
