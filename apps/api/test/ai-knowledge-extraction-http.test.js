import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createAppContext } from '../src/app.factory.js';
import { createFileDataStore } from '../src/infrastructure/file-data-store.js';
import { createMaintenanceGate } from '../src/infrastructure/maintenance-gate.ts';
import {
  createExtractionTaskSources,
  extractionTaskGateway,
  deferredTaskResponse,
  quietTaskLogger
} from './fixtures/knowledge-extraction-task.fixture.js';
import {
  startExtractionHttpServer,
  waitForExtractionReady,
  callExtractionHttp as call
} from './fixtures/knowledge-extraction-http.fixture.js';

async function fixture(run, options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'knowra-extraction-http-')),
    file = path.join(root, 'data.json');
  const mock = extractionTaskGateway(options.onCall),
    apps = [],
    servers = [];
  let now = new Date('2026-10-02T12:00:00.000Z');
  const open = (enabled = true) => {
    const app = createAppContext({
      dataStore: createFileDataStore(file),
      ownerId: 'demo',
      storageRootDir: root,
      uploadsDir: path.join(root, 'uploads'),
      ...(enabled
        ? {
            knowledgeExtractionMock: {
              gateway: mock.gateway,
              clock: () => now,
              schedule() {},
              logger: quietTaskLogger,
              maintenanceGate: options.maintenanceGate
            }
          }
        : {})
    });
    apps.push(app);
    return app;
  };
  const serve = async app => {
    const server = await startExtractionHttpServer(app);
    servers.push(server);
    return server;
  };
  try {
    const app = open(options.enabled !== false),
      sources = await createExtractionTaskSources(app);
    const server = options.noServer ? null : await serve(app);
    await run({
      app,
      root,
      file,
      mock,
      open,
      serve,
      ...sources,
      ...server,
      advance: ms => {
        now = new Date(now.getTime() + ms);
      }
    });
  } finally {
    for (const server of servers.reverse()) await server.close();
    for (const app of apps.reverse()) await app.knowledgeExtractionTasks?.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
}
const request = input => ({ kind: 'knowledgeExtraction', ...input });
const listUrl = (spaceId, tail = '') => `/jobs?kind=knowledgeExtraction&spaceId=${encodeURIComponent(spaceId)}${tail}`;

export const aiKnowledgeExtractionHttpTests = [
  {
    name: '02C 测试宿主显式只读等就绪，恢复失败/超时有诊断且关闭，不隐式重试POST',
    async run() {
      for (const mode of ['success', 'failure', 'timeout'])
        await fixture(
          async f => {
            const held = Promise.withResolvers(),
              entered = Promise.withResolvers(),
              polled = Promise.withResolvers();
            const recover = f.app.knowledgeExtractionTasks.recover;
            f.app.knowledgeExtractionTasks.recover = async () => {
              entered.resolve();
              await held.promise;
              if (mode === 'failure') throw new Error('synthetic private recovery failure');
              return recover();
            };
            const http = await startExtractionHttpServer(f.app),
              requests = [];
            try {
              await entered.promise;
              const early = await call(http.origin, '/jobs', request(f.input));
              assert.equal(early.status, 503, JSON.stringify(early.data));
              assert.equal(early.data.error.code, 'KNOWLEDGE_EXTRACTION_RECOVERING');
              assert.equal(f.app.dataStore.aiRepository.list('aiJob').length, 0);
              http.server.on('request', request => {
                requests.push(`${request.method} ${request.url}`);
                if (requests.length === 2) polled.resolve();
              });
              let settled = false;
              const waiting = waitForExtractionReady(http.origin, { timeoutMs: 1000 });
              waiting.then(
                () => {
                  settled = true;
                },
                () => {
                  settled = true;
                }
              );
              await Promise.race([polled.promise, waiting]);
              assert.equal(settled, false, '恢复未释放，准备阶段必须仍在等待');
              if (mode === 'timeout') {
                await assert.rejects(
                  waiting,
                  error =>
                    error.code === 'EXTRACTION_HTTP_READY_TIMEOUT' &&
                    error.message.includes('KNOWLEDGE_EXTRACTION_RECOVERING')
                );
              } else {
                held.resolve();
                if (mode === 'failure')
                  await assert.rejects(
                    waiting,
                    error =>
                      error.code === 'EXTRACTION_HTTP_NOT_READY' &&
                      error.message.includes('KNOWLEDGE_EXTRACTION_UNAVAILABLE') &&
                      !error.message.includes('synthetic private')
                  );
                else assert.equal((await waiting).canStart, true);
              }
              assert.ok(requests.length >= 2);
              assert.ok(requests.every(value => value === 'GET /api/ai/capabilities'));
              assert.equal(f.app.dataStore.aiRepository.list('aiJob').length, 0);
              assert.equal(f.mock.calls.length, 0);
              if (mode === 'success') {
                const explicit = await call(http.origin, '/jobs', request(f.input));
                assert.equal(explicit.status, 202, JSON.stringify(explicit.data));
                assert.equal(f.app.dataStore.aiRepository.list('aiJob').length, 1);
              }
            } finally {
              held.resolve();
              await http.close();
              assert.equal(http.server.listening, false);
            }
          },
          { noServer: true }
        );
    }
  },
  {
    name: '02C 恢复中jobs立即503且不排队，核心可读写，完成后需新明确POST',
    async run() {
      await fixture(
        async f => {
          const held = Promise.withResolvers(),
            entered = Promise.withResolvers(),
            finished = Promise.withResolvers();
          const recover = f.app.knowledgeExtractionTasks.recover;
          f.app.knowledgeExtractionTasks.recover = async () => {
            entered.resolve();
            await held.promise;
            try {
              return await recover();
            } finally {
              finished.resolve();
            }
          };
          let timer, requests;
          try {
            const http = await f.serve(f.app);
            await entered.promise;
            const cap = (await call(http.origin, '/capabilities')).data.data.knowledgeExtraction;
            assert.equal(cap.canStart, false);
            assert.equal(cap.canReadJobs, false);
            assert.equal(cap.reasonCode, 'KNOWLEDGE_EXTRACTION_RECOVERING');
            requests = Promise.all([
              call(http.origin, '/jobs', request(f.input)),
              call(http.origin, listUrl(f.space.id)),
              call(http.origin, '/jobs/missing'),
              call(http.origin, '/jobs/missing/cancel', {}),
              call(http.origin, '/jobs/missing/retry', {})
            ]);
            const responses = await Promise.race([
              requests,
              new Promise(resolve => {
                timer = setTimeout(() => resolve(null), 1000);
              })
            ]);
            if (!responses) {
              // 失败路径也释放宿主，记录旧实现是否在恢复结束后自动创建任务，避免悬挂测试。
              held.resolve();
              const delayed = await requests;
              assert.fail(
                `恢复中请求被排队：恢复后HTTP=${delayed.map(value => value.status)},任务数=${f.app.dataStore.aiRepository.list('aiJob').length}`
              );
            }
            clearTimeout(timer);
            for (const response of responses) {
              assert.equal(response.status, 503);
              assert.equal(response.data.error.code, 'KNOWLEDGE_EXTRACTION_RECOVERING');
              assert.equal(response.cacheControl, 'no-store');
            }
            assert.equal(f.app.dataStore.aiRepository.list('aiJob').length, 0);
            assert.equal(f.app.dataStore.aiRepository.list('aiGrant').length, 0);
            const created = await fetch(`${http.origin}/api/knowledge/notes`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ spaceId: f.space.id, title: '恢复期间手动资料', rawMarkdown: '独立合成内容' })
            });
            assert.equal(created.status, 201);
            const note = (await created.json()).data;
            const read = await fetch(`${http.origin}/api/knowledge/notes/${note.id}`);
            assert.equal(read.status, 200);
            assert.equal((await read.json()).data.title, '恢复期间手动资料');
            held.resolve();
            await finished.promise;
            assert.equal((await call(http.origin, '/capabilities')).data.data.knowledgeExtraction.canStart, true);
            assert.equal((await call(http.origin, listUrl(f.space.id))).data.data.items.length, 0);
            assert.equal(f.app.dataStore.aiRepository.list('aiGrant').length, 0);
            assert.equal(f.mock.calls.length, 0);
            const explicit = await call(http.origin, '/jobs', request(f.input));
            assert.equal(explicit.status, 202);
            assert.equal(f.app.dataStore.aiRepository.list('aiJob').length, 1);
            await call(http.origin, `/jobs/${explicit.data.data.jobId}/cancel`, {});
            assert.equal(f.mock.calls.length, 0);
          } finally {
            clearTimeout(timer);
            held.resolve();
            await requests;
          }
        },
        { noServer: true }
      );
    }
  },
  {
    name: '02C 默认无任务reader，能力可读且jobs503，范围与手动知识不依赖AI',
    async run() {
      await fixture(
        async f => {
          assert.equal(f.app.knowledgeExtractionTasks, null);
          const capability = await call(f.origin, '/capabilities');
          assert.equal(capability.status, 200);
          assert.equal(capability.cacheControl, 'no-store');
          assert.deepEqual(capability.data.data.knowledgeExtraction, {
            available: false,
            executionMode: 'unavailable',
            executionLocation: 'server',
            canReadJobs: false,
            canStart: false,
            reasonCode: 'KNOWLEDGE_EXTRACTION_UNAVAILABLE',
            message: '知识提炼暂不可用；仍可保存分析范围和手动整理知识。'
          });
          for (const [url, body] of [
            [listUrl(f.space.id)],
            ['/jobs/missing'],
            ['/jobs', request(f.input)],
            ['/jobs/missing/cancel', {}]
          ]) {
            const result = await call(f.origin, url, body);
            assert.equal(result.status, 503);
            assert.equal(result.data.error.code, 'KNOWLEDGE_EXTRACTION_UNAVAILABLE');
          }
          assert.equal(f.app.http.knowledge.listAnalysisScopes({ spaceId: f.space.id }).length, 1);
          const saved = f.app.modules.knowledge.knowledgeItemService.createCandidate({
            spaceId: f.space.id,
            title: '手动知识',
            canonicalStatement: '手动整理的合成内容',
            knowledgeType: 'concept',
            sourceMode: 'manual'
          });
          assert.equal(saved.item.title, '手动知识');
          assert.equal(f.mock.calls.length, 0);
        },
        { enabled: false }
      );
    }
  },
  {
    name: '02C HTTP start同键响应丢失复用、首份候选回读和个人修订重启保留',
    async run() {
      await fixture(async f => {
        const before = f.app.http.knowledge.previewAnalysisScope({
          spaceId: f.space.id,
          mode: 'all',
          noteIds: [f.note.id]
        });
        const capability = (await call(f.origin, '/capabilities')).data.data.knowledgeExtraction;
        assert.equal(capability.canStart, true);
        assert.equal(capability.executionMode, 'mock');
        assert.deepEqual(
          f.app.http.knowledge.previewAnalysisScope({ spaceId: f.space.id, mode: 'all', noteIds: [f.note.id] }),
          before
        );
        const one = await call(f.origin, '/jobs', request(f.input));
        const two = await call(f.origin, '/jobs', request(f.input));
        assert.equal(one.status, 202);
        assert.deepEqual(two.data, one.data);
        const job = one.data.data;
        assert.equal(job.actions.canCancel, true);
        assert.equal(job.actions.canRetry, false);
        assert.equal(job.actions.retryUnavailableReason, null);
        const lookup = (await call(f.origin, listUrl(f.space.id, `&idempotencyKey=${f.input.idempotencyKey}`))).data
          .data;
        assert.equal(lookup.items.length, 1);
        assert.equal(lookup.items[0].jobId, job.jobId);
        await f.app.knowledgeExtractionTasks.idle();
        const done = (await call(f.origin, `/jobs/${job.jobId}`)).data.data;
        assert.equal(done.status, 'succeeded');
        assert.equal(done.candidateIds.length, 1);
        assert.equal(done.actions.canCancel, false);
        assert.equal(done.actions.canRetry, false);
        assert.equal(done.error, null);
        assert.equal(done.actions.retryUnavailableReason, null);
        assert.equal(f.app.dataStore.state.knowledgeItems.filter(item => item.reviewStatus === 'confirmed').length, 0);
        const item = f.app.modules.knowledge.knowledgeItemService.getItem(done.candidateIds[0]);
        f.app.http.knowledge.updateKnowledgeItem(
          { id: item.id },
          { title: '用户个人修订', expectedUpdatedAt: item.updatedAt }
        );
        assert.equal((await call(f.origin, `/jobs/${job.jobId}/cancel`, {})).data.data.status, 'succeeded');
        const text = JSON.stringify(done);
        for (const privateValue of [
          'credential',
          'grant',
          'descriptor',
          '数据增强通过',
          'deepseek',
          'mock:no-credential'
        ])
          assert.equal(text.includes(privateValue), false);
        const reopened = f.open(),
          next = await f.serve(reopened);
        assert.deepEqual((await call(next.origin, '/jobs', request(f.input))).data.data, done);
        assert.equal(reopened.modules.knowledge.knowledgeItemService.getItem(item.id).title, '用户个人修订');
        assert.equal(f.mock.calls.length, 1);
        const off = f.open(false),
          offServer = await f.serve(off);
        assert.equal((await call(offServer.origin, `/jobs/${job.jobId}`)).status, 503);
        assert.equal(off.modules.knowledge.knowledgeItemService.getItem(item.id).title, '用户个人修订');
      });
    }
  },
  {
    name: '02C 任务列表限域分页与精确键恢复，不读取所有AIJob且不泄露详情',
    async run() {
      await fixture(async f => {
        const ids = [];
        for (let index = 0; index < 4; index++) {
          const result = (await call(f.origin, '/jobs', request({ ...f.input, idempotencyKey: `page-${index}` }))).data
            .data;
          ids.push(result.jobId);
          await call(f.origin, `/jobs/${result.jobId}/cancel`, {});
        }
        const otherSpace = f.app.http.knowledge.createKnowledgeSpace({ name: '第二空间' });
        const list = f.app.dataStore.aiRepository.list;
        f.app.dataStore.aiRepository.list = (kind, ...args) => {
          assert.notEqual(kind, 'aiJob', 'HTTP列表不能调用全量AIJob查询');
          return list(kind, ...args);
        };
        const first = await call(f.origin, listUrl(f.space.id, '&limit=2'));
        assert.equal(first.status, 200);
        assert.equal(first.data.data.items.length, 2);
        const second = await call(f.origin, listUrl(f.space.id, `&limit=2&cursor=${first.data.data.nextCursor}`));
        assert.equal(second.data.data.nextCursor, null);
        assert.deepEqual(
          [...first.data.data.items, ...second.data.data.items].map(row => row.jobId),
          ids.sort().reverse()
        );
        assert.equal(Object.hasOwn(first.data.data.items[0], 'candidateIds'), false);
        assert.equal(Object.hasOwn(first.data.data.items[0], 'actions'), false);
        assert.equal((await call(f.origin, listUrl(otherSpace.id))).data.data.items.length, 0);
        assert.equal(
          (await call(f.origin, listUrl(otherSpace.id, `&cursor=${first.data.data.nextCursor}`))).status,
          422
        );
        assert.equal((await call(f.origin, listUrl('foreign-space'))).status, 404);
        assert.equal(
          (await call(f.origin, listUrl(f.space.id, '&idempotencyKey=%27%20OR%201%3D1--'))).data.data.items.length,
          0
        );
        f.app.dataStore.aiRepository.rotateEpoch();
        assert.equal((await call(f.origin, listUrl(f.space.id))).data.data.items.length, 0);
        assert.equal((await call(f.origin, `/jobs/${ids[0]}`)).status, 404);
        assert.equal((await call(f.origin, listUrl(f.space.id, `&cursor=${first.data.data.nextCursor}`))).status, 422);
      });
    }
  },
  {
    name: '02C HTTP严格请求、来源保护和同键异范围冲突，不接受模型或私有记录字段',
    async run() {
      await fixture(async f => {
        for (const body of [
          { ...request(f.input), ownerId: 'other' },
          { ...request(f.input), result: {} },
          { ...request(f.input), provider: 'deepseek' },
          { ...request(f.input), kind: 'answer' },
          [],
          null
        ]) {
          assert.equal((await call(f.origin, '/jobs', body)).status, 422);
        }
        assert.equal((await call(f.origin, '/jobs', request(f.input), { header: '0' })).status, 403);
        assert.equal(
          (await call(f.origin, '/jobs', request(f.input), { headers: { Origin: 'https://outside.example' } })).status,
          403
        );
        for (const tail of [
          '&limit=0',
          '&limit=51',
          '&limit=2.5',
          '&limit=2&limit=3',
          '&ownerId=demo',
          '&cursor=bad'
        ]) {
          assert.equal((await call(f.origin, listUrl(f.space.id, tail))).status, 422);
        }
        assert.equal((await call(f.origin, '/jobs?spaceId=space-demo')).status, 422);
        assert.equal(f.app.dataStore.aiRepository.list('aiJob').length, 0);
        const created = (await call(f.origin, '/jobs', request(f.input))).data.data;
        const other = await createExtractionTaskSources(f.app, '-other');
        assert.equal(
          (await call(f.origin, '/jobs', request({ ...f.input, scopeId: other.scope.id }))).data.error.code,
          'AI_IDEMPOTENCY_CONFLICT'
        );
        assert.equal((await call(f.origin, `/jobs/${created.jobId}/cancel`, { grantId: 'forged' })).status, 422);
        await call(f.origin, `/jobs/${created.jobId}/cancel`, {});
        assert.equal(f.mock.calls.length, 0);
      });
    }
  },
  {
    name: '02C 安全失败与动态重试权限：grant到期不延长、不泄露供应商正文',
    async run() {
      await fixture(
        async f => {
          const job = (await call(f.origin, '/jobs', request(f.input))).data.data;
          await assert.rejects(f.app.knowledgeExtractionTasks.run(job.jobId));
          const detail = (await call(f.origin, `/jobs/${job.jobId}`)).data.data;
          assert.equal(detail.status, 'failed');
          assert.equal(detail.actions.canRetry, true);
          assert.equal(detail.error.code, 'KNOWLEDGE_EXTRACTION_FAILED');
          assert.equal(JSON.stringify(detail).includes('private-secret-response'), false);
          f.advance(300_001);
          const expired = (await call(f.origin, `/jobs/${job.jobId}`)).data.data;
          assert.equal(expired.actions.canRetry, false);
          assert.equal(expired.actions.retryUnavailableReason.code, 'KNOWLEDGE_EXTRACTION_GRANT_INVALID');
          assert.equal((await call(f.origin, `/jobs/${job.jobId}/retry`, {})).status, 409);
          assert.equal(f.mock.calls.length, 1);
          assert.equal(f.app.dataStore.aiRepository.list('aiGrant').length, 1);
        },
        {
          onCall() {
            throw Object.assign(new Error('private-secret-response'), { code: 'AI_PROVIDER_UNAVAILABLE' });
          }
        }
      );
    }
  },
  {
    name: '02C HTTP显式重试最多四次，恢复与回读不会自动生成',
    async run() {
      await fixture(
        async f => {
          const job = await f.app.knowledgeExtractionTasks.start(f.input);
          const http = await f.serve(f.app);
          const recovered = (await call(http.origin, `/jobs/${job.jobId}`)).data.data;
          assert.equal(recovered.status, 'failed');
          assert.equal(recovered.actions.canRetry, true);
          assert.equal(f.mock.calls.length, 0);
          for (let attempt = 0; attempt < 4; attempt++) {
            assert.equal((await call(http.origin, `/jobs/${job.jobId}/retry`, {})).status, 202);
            await assert.rejects(f.app.knowledgeExtractionTasks.run(job.jobId));
          }
          const limit = (await call(http.origin, `/jobs/${job.jobId}`)).data.data;
          assert.equal(limit.actions.canRetry, false);
          assert.equal(limit.actions.retryUnavailableReason.code, 'KNOWLEDGE_EXTRACTION_ATTEMPT_LIMIT');
          assert.equal((await call(http.origin, `/jobs/${job.jobId}/retry`, {})).status, 409);
          assert.equal(f.mock.calls.length, 4);
        },
        {
          noServer: true,
          onCall() {
            throw new Error('synthetic failure');
          }
        }
      );
    }
  },
  {
    name: '02C HTTP取消在途拒绝晚到结果，删除范围后不能重试但可回看记录',
    async run() {
      const deferred = deferredTaskResponse();
      await fixture(
        async f => {
          const job = (await call(f.origin, '/jobs', request(f.input))).data.data;
          const running = f.app.knowledgeExtractionTasks.run(job.jobId),
            failed = assert.rejects(running);
          await deferred.called;
          const cancelled = await call(f.origin, `/jobs/${job.jobId}/cancel`, {});
          assert.equal(cancelled.data.data.status, 'cancelled');
          await failed;
          deferred.release();
          await f.app.knowledgeExtractionTasks.idle();
          assert.equal(f.app.dataStore.state.knowledgeItems.length, 0);
          const pending = (await call(f.origin, '/jobs', request({ ...f.input, idempotencyKey: 'deleted-scope' }))).data
            .data;
          await f.app.knowledgeExtractionTasks.recover();
          f.app.http.knowledge.trashAnalysisScope(
            { id: f.scope.id },
            { spaceId: f.space.id, expectedUpdatedAt: f.scope.updatedAt }
          );
          const invalid = (await call(f.origin, `/jobs/${pending.jobId}`)).data.data;
          assert.equal(invalid.status, 'failed');
          assert.equal(invalid.actions.canRetry, false);
          assert.equal(invalid.actions.retryUnavailableReason.code, 'KNOWLEDGE_EXTRACTION_SCOPE_FORBIDDEN');
          assert.equal((await call(f.origin, `/jobs/${pending.jobId}/retry`, {})).status, 409);
          assert.equal(
            (await call(f.origin, '/jobs', request({ ...f.input, idempotencyKey: 'new-deleted-scope' }))).status,
            409
          );
          assert.equal((await call(f.origin, listUrl(f.space.id))).data.data.items.length, 2);
        },
        { onCall: deferred.onCall }
      );
    }
  },
  {
    name: '02C 关闭AI/desktop/维护/恢复失败只关闭任务协议，核心HTTP仍可读写',
    async run() {
      for (const mode of ['disabled', 'local', 'recover-failed', 'closed'])
        await fixture(
          async f => {
            let recovered = 0;
            const recover = f.app.knowledgeExtractionTasks.recover;
            f.app.knowledgeExtractionTasks.recover = () => {
              recovered++;
              if (mode === 'recover-failed') throw new Error('secret storage failure');
              return recover();
            };
            if (mode === 'local') f.app.aiLocation = 'local';
            if (mode === 'closed') await f.app.knowledgeExtractionTasks.close();
            const prior = process.env.KNOWRA_AI_ENABLED;
            try {
              if (mode === 'disabled') process.env.KNOWRA_AI_ENABLED = '0';
              const http = await f.serve(f.app);
              const jobs = await call(http.origin, listUrl(f.space.id));
              assert.equal(jobs.status, 503);
              const cap = (await call(http.origin, '/capabilities')).data.data.knowledgeExtraction;
              assert.equal(cap.canStart, false);
              assert.equal(cap.canReadJobs, false);
              assert.equal(JSON.stringify(cap).includes('secret'), false);
              if (['disabled', 'local'].includes(mode)) assert.equal(recovered, 0);
              const health = await fetch(`${http.origin}/api/health`);
              assert.equal(health.status, 200);
              f.app.http.knowledge.updateNote({ id: f.note.id }, { title: '故障旁仍可编辑' });
              assert.equal(f.mock.calls.length, 0);
            } finally {
              if (prior === undefined) delete process.env.KNOWRA_AI_ENABLED;
              else process.env.KNOWRA_AI_ENABLED = prior;
            }
          },
          { noServer: true }
        );
      const gate = createMaintenanceGate();
      await fixture(
        async f => {
          await call(f.origin, listUrl(f.space.id));
          await gate.runMaintenance(async () => {
            assert.equal((await call(f.origin, '/capabilities')).data.data.knowledgeExtraction.canStart, false);
            assert.equal((await call(f.origin, '/jobs', request(f.input))).status, 503);
          });
          assert.equal((await call(f.origin, '/capabilities')).data.data.knowledgeExtraction.canStart, true);
          assert.equal(f.app.dataStore.aiRepository.list('aiJob').length, 0);
        },
        { maintenanceGate: gate }
      );
    }
  }
];
