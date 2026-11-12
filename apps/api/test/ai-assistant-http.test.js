import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createPersistentAppContext } from '../src/app.factory.ts';
import { createServer } from '../src/server.js';
import { createAiWorker, quoteWorstCase } from '../src/modules/ai/worker.ts';
import { reviewedDeepSeekPriceProfile } from '../src/modules/ai/reviewed-price-profile.ts';

const priceProfile = {
  version: 'synthetic',
  expiresAt: '2030-01-01T00:00:00.000Z',
  inputMicrounitsPerMillion: 2_000_000,
  outputMicrounitsPerMillion: 8_000_000
};

async function withServer(context, run) {
  const server = createServer({ appContext: context, logger: { warn() {}, error() {} } });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    return await run(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

async function call(origin, route, body, header = '1') {
  const response = await fetch(
    `${origin}/api/ai/assistant${route}`,
    body === undefined
      ? undefined
      : {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Knowra-AI-Assistant': header },
          body: JSON.stringify(body)
        }
  );
  return { status: response.status, payload: await response.json() };
}

export const aiAssistantHttpTests = [
  {
    name: '用量导出与未知请求处理接口：CSV 下载头、释放与按金额结算、重复处理和无效输入被拒',
    async run() {
      const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'knowra-ai-resolve-http-'));
      try {
        const context = createPersistentAppContext({
          storageRootDir: directory,
          ownerId: 'demo',
          persistenceDriver: 'local-json',
          databaseUrl: null,
          uploadsDir: path.join(directory, 'uploads')
        });
        const authority = context.ai.budgetAuthority;
        for (const n of [1, 2]) {
          await authority.reserve({
            accountRef: 'deepseek-primary',
            jobId: `job-${n}`,
            attemptId: `attempt-${n}`,
            priceVersion: 'p1',
            reservedMicrounits: 1_000_000
          });
          await authority.settle({
            accountRef: 'deepseek-primary',
            attemptId: `attempt-${n}`,
            disposition: 'unknown',
            usage: { modelId: 'deepseek-flash' }
          });
        }
        await withServer(context, async origin => {
          const usage = async () => (await (await fetch(`${origin}/api/ai/assistant/usage`)).json()).data;
          const before = await usage();
          assert.deepEqual(
            before.unknown.map(row => [row.attemptId, row.reservedMicrounits]),
            [
              ['attempt-1', 1_000_000],
              ['attempt-2', 1_000_000]
            ]
          );
          const exported = await fetch(`${origin}/api/ai/assistant/usage/export`);
          assert.equal(exported.status, 200);
          assert.match(exported.headers.get('content-type'), /text\/csv/);
          assert.match(exported.headers.get('content-disposition'), /attachment; filename="knowra-ai-usage\.csv"/);
          assert.match(await exported.text(), /结果未知/);
          assert.equal(
            (await call(origin, '/usage/resolve', { attemptId: 'attempt-1', disposition: 'released' }, '0')).status,
            403
          );
          assert.equal(
            (await call(origin, '/usage/resolve', { attemptId: 'attempt-1', disposition: 'settled' })).status,
            422
          );
          assert.equal(
            (await call(origin, '/usage/resolve', { attemptId: 'attempt-1', disposition: 'bogus' })).status,
            422
          );
          const released = await call(origin, '/usage/resolve', { attemptId: 'attempt-1', disposition: 'released' });
          assert.equal(released.status, 200);
          assert.deepEqual(
            released.payload.data.unknown.map(row => row.attemptId),
            ['attempt-2']
          );
          assert.equal(
            (await call(origin, '/usage/resolve', { attemptId: 'attempt-1', disposition: 'released' })).status,
            404,
            '已处理的请求不能再改'
          );
          assert.equal(
            (
              await call(origin, '/usage/resolve', {
                attemptId: 'attempt-2',
                disposition: 'settled',
                actualMicrounits: 2_000_000
              })
            ).status,
            422,
            '超过预留额'
          );
          const settled = await call(origin, '/usage/resolve', {
            attemptId: 'attempt-2',
            disposition: 'settled',
            actualMicrounits: 300_000
          });
          assert.equal(settled.payload.data.total.spentMicrounits, 300_000);
          assert.deepEqual(settled.payload.data.unknown, []);
          const status = (await (await fetch(`${origin}/api/ai/assistant/status`)).json()).data;
          if (status.budget) assert.equal(status.budget.heldMicrounits, 0);
        });
      } finally {
        fs.rmSync(directory, { recursive: true, force: true });
      }
    }
  },
  {
    name: '预算提醒接口：越过阈值只提醒一次，标记后保留；达到即停时可放行当日，放行后状态恢复可用',
    async run() {
      const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'knowra-ai-alerts-http-'));
      try {
        const context = createPersistentAppContext({
          storageRootDir: directory,
          ownerId: 'demo',
          persistenceDriver: 'local-json',
          databaseUrl: null,
          uploadsDir: path.join(directory, 'uploads')
        });
        context.ai.credentialReference = async () => ({
          provider: 'deepseek',
          modelId: 'deepseek-flash',
          credentialRef: 'synthetic-ref'
        });
        await withServer(context, async origin => {
          const get = async route => (await (await fetch(`${origin}/api/ai/assistant${route}`)).json()).data;
          assert.deepEqual((await get('/alerts')).alerts, []);
          const initial = await get('/budget-settings');
          await call(origin, '/budget-settings', {
            rules: { ...initial.rules, daily: { mode: 'stop', limitMicrounits: 2_000_000 } },
            price: null,
            alerts: { thresholds: [50, 100] }
          });
          const authority = context.ai.budgetAuthority;
          await authority.reserve({
            accountRef: 'deepseek-primary',
            jobId: 'job-1',
            attemptId: 'attempt-1',
            priceVersion: 'p1',
            reservedMicrounits: 1_200_000
          });
          await authority.settle({
            accountRef: 'deepseek-primary',
            attemptId: 'attempt-1',
            disposition: 'settled',
            actualMicrounits: 1_100_000
          });
          const first = await get('/alerts');
          assert.deepEqual(
            first.alerts.map(item => [item.threshold, item.notified, item.dismissed]),
            [[50, false, false]]
          );
          const marked = await call(origin, '/alerts/mark', { ids: [first.alerts[0].id], kind: 'notified' });
          assert.equal(marked.payload.data.alerts[0].notified, true);
          assert.equal((await call(origin, '/alerts/mark', { ids: ['nope'], kind: 'notified' })).status, 422);
          assert.equal(
            (await call(origin, '/alerts/mark', { ids: [first.alerts[0].id], kind: 'notified' }, '0')).status,
            403
          );
          await authority.reserve({
            accountRef: 'deepseek-primary',
            jobId: 'job-2',
            attemptId: 'attempt-2',
            priceVersion: 'p1',
            reservedMicrounits: 900_000
          });
          await authority.settle({
            accountRef: 'deepseek-primary',
            attemptId: 'attempt-2',
            disposition: 'settled',
            actualMicrounits: 900_000
          });
          const full = await get('/alerts');
          assert.deepEqual(
            full.alerts.map(item => item.threshold),
            [50, 100]
          );
          assert.equal(full.alerts[0].notified, true, '已通知的阈值不会再次变成未通知');
          assert.equal(full.alerts[1].notified, false);
          const blocked = await get('/status');
          assert.equal(blocked.generationAvailable, false);
          assert.match(blocked.unavailableReason, /预算已用完/);
          assert.equal((await call(origin, '/alerts/allow', { rule: 'turn' })).status, 422);
          const allowed = await call(origin, '/alerts/allow', { rule: 'daily' });
          assert.equal(allowed.status, 200);
          assert.equal(allowed.payload.data.overrides[0].rule, 'daily');
          const after = await get('/status');
          assert.equal(after.budget.limitMicrounits, null);
          assert.equal(after.budget.availableMicrounits, null);
          // 暂停：状态立即不可用且不改预算设置；恢复后可用
          const settingsBefore = JSON.stringify(await get('/budget-settings'));
          const paused = await call(origin, '/alerts/pause', { rule: 'daily' });
          assert.equal(paused.payload.data.pauses[0].rule, 'daily');
          assert.deepEqual(paused.payload.data.overrides, [], '暂停取消同周期的放行');
          const pausedStatus = await get('/status');
          assert.equal(pausedStatus.generationAvailable, false);
          assert.match(pausedStatus.unavailableReason, /暂停至明天/);
          assert.equal(JSON.stringify(await get('/budget-settings')), settingsBefore);
          assert.equal((await call(origin, '/alerts/pause', { rule: 'turn' })).status, 422);
          const resumed = await call(origin, '/alerts/resume', { rule: 'daily' });
          assert.deepEqual(resumed.payload.data.pauses, []);
          // 状态文件损坏：AI 被阻止并如实告知，关闭横幅不能覆盖文件，显式重置后恢复
          fs.writeFileSync(path.join(directory, 'ai-budget-alerts.json'), '{"pauses":null}');
          const broken = await get('/alerts');
          assert.equal(broken.stateInvalid, true);
          const brokenStatus = await get('/status');
          assert.equal(brokenStatus.generationAvailable, false);
          assert.match(brokenStatus.unavailableReason, /已损坏/);
          assert.equal(
            (await call(origin, '/alerts/mark', { ids: ['daily:2026-10-08:50'], kind: 'dismissed' })).status,
            409
          );
          assert.equal((await call(origin, '/alerts/resume', { rule: 'daily' })).status, 200);
          assert.equal((await get('/alerts')).stateInvalid, false);
        });
      } finally {
        fs.rmSync(directory, { recursive: true, force: true });
      }
    }
  },
  {
    name: '云端预算接口按服务端保存的上限执行：客户端传来的 limits 被忽略，状态也反映保存的规则',
    async run() {
      const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'knowra-ai-budget-route-'));
      try {
        const context = createPersistentAppContext({
          storageRootDir: directory,
          ownerId: 'demo',
          persistenceDriver: 'local-json',
          databaseUrl: null,
          uploadsDir: path.join(directory, 'uploads')
        });
        const settings = await context.ai.budgetSettings.get();
        await context.ai.budgetSettings.set({
          ...settings,
          rules: {
            ...settings.rules,
            daily: { mode: 'stop', limitMicrounits: 10_000 },
            monthly: { mode: 'stop', limitMicrounits: 10_000 }
          }
        });
        await withServer(context, async origin => {
          const post = async (route, body) => {
            const response = await fetch(`${origin}/api/ai/budget/${route}`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'X-Knowra-AI-Budget': '1' },
              body: JSON.stringify(body)
            });
            return { status: response.status, payload: await response.json() };
          };
          const reserve = (n, extra = {}) =>
            post('reserve', {
              jobId: `job-${n}`,
              attemptId: `attempt-${n}`,
              priceVersion: 'p1',
              reservedMicrounits: 1_000_000,
              ...extra
            });
          const blocked = await reserve(1);
          assert.equal(blocked.status, 409, '保存的每日上限 ¥0.01 生效，¥1 的预留被拒');
          assert.equal(blocked.payload.error.code, 'AI_DAILY_BUDGET_EXCEEDED');
          const forged = await reserve(2, { limits: { daily: null, monthly: null, turn: null } });
          assert.equal(forged.status, 409, '客户端无法用 limits 放宽上限');
          const status = await (
            await fetch(`${origin}/api/ai/budget/status`, { headers: { 'X-Knowra-AI-Budget': '1' } })
          ).json();
          assert.equal(status.data.limitMicrounits, 10_000);
          assert.equal(status.data.monthLimitMicrounits, 10_000);
          await context.ai.budgetSettings.set({
            ...settings,
            rules: { ...settings.rules, daily: { mode: 'off', limitMicrounits: null } }
          });
          assert.equal((await reserve(3)).status, 200, '关闭每日上限后通过');
        });
      } finally {
        fs.rmSync(directory, { recursive: true, force: true });
      }
    }
  },
  {
    name: '预算设置接口：默认值、保存需助手请求头与合法金额；每日上限改为仅提醒后状态不再受 20 元限制，设置损坏时阻止调用',
    async run() {
      const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'knowra-ai-budget-settings-http-'));
      try {
        const context = createPersistentAppContext({
          storageRootDir: directory,
          ownerId: 'demo',
          persistenceDriver: 'local-json',
          databaseUrl: null,
          uploadsDir: path.join(directory, 'uploads')
        });
        context.ai.credentialReference = async () => ({
          provider: 'deepseek',
          modelId: 'deepseek-flash',
          credentialRef: 'synthetic-ref'
        });
        await withServer(context, async origin => {
          const read = async () => (await (await fetch(`${origin}/api/ai/assistant/budget-settings`)).json()).data;
          const initial = await read();
          assert.deepEqual(initial.rules.daily, { mode: 'stop', limitMicrounits: 20_000_000 });
          assert.deepEqual(initial.rules.turn, { mode: 'stop', limitMicrounits: 2_000_000 });
          assert.equal(initial.price, null);
          assert.equal(initial.basePrice.version, reviewedDeepSeekPriceProfile.version);
          assert.equal(
            (await call(origin, '/budget-settings', { rules: initial.rules, price: null }, '0')).status,
            403
          );
          const bad = await call(origin, '/budget-settings', {
            rules: { ...initial.rules, daily: { mode: 'stop', limitMicrounits: -1 } },
            price: null
          });
          assert.equal(bad.status, 422);
          assert.equal(bad.payload.error.code, 'AI_BUDGET_SETTINGS_INVALID');
          const saved = await call(origin, '/budget-settings', {
            rules: { ...initial.rules, daily: { mode: 'warn', limitMicrounits: 5_000_000 } },
            price: null
          });
          assert.equal(saved.status, 200);
          assert.equal(saved.payload.data.rules.daily.mode, 'warn');
          const status = (await (await fetch(`${origin}/api/ai/assistant/status`)).json()).data;
          if (status.budget) {
            assert.equal(status.budget.limitMicrounits, null);
            assert.equal(status.budget.availableMicrounits, null);
          }
          fs.writeFileSync(path.join(directory, 'ai-budget-settings.json'), '{broken');
          const blocked = (await (await fetch(`${origin}/api/ai/assistant/status`)).json()).data;
          assert.equal(blocked.generationAvailable, false);
          assert.match(blocked.unavailableReason, /预算设置/);
        });
      } finally {
        fs.rmSync(directory, { recursive: true, force: true });
      }
    }
  },
  {
    name: '用量与余额接口：用量只读汇总；余额读取需助手请求头，未启用时 503，失败不影响用量',
    async run() {
      const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'knowra-ai-usage-http-'));
      try {
        const context = createPersistentAppContext({
          storageRootDir: directory,
          ownerId: 'demo',
          persistenceDriver: 'local-json',
          databaseUrl: null,
          uploadsDir: path.join(directory, 'uploads')
        });
        await withServer(context, async origin => {
          const usage = await (await fetch(`${origin}/api/ai/assistant/usage`)).json();
          assert.equal(usage.data.location, 'server');
          assert.equal(usage.data.total.requests, 0);
          assert.deepEqual(usage.data.recent, []);
          const cached = await (await fetch(`${origin}/api/ai/assistant/balance`)).json();
          assert.deepEqual(cached.data.inferred, []);
          assert.equal(cached.data.latest, null);
          const rejected = await call(origin, '/balance/refresh', {}, '0');
          assert.equal(rejected.status, 403);
          context.ai.balance = null;
          assert.equal((await fetch(`${origin}/api/ai/assistant/balance`)).status, 503);
          context.ai.balance = {
            view: async () => ({ latest: null, checkedAt: null, inferred: [] }),
            refresh: async () => {
              throw Object.assign(new Error('无法连接 DeepSeek，请检查网络后重试。'), {
                code: 'AI_BALANCE_UNAVAILABLE'
              });
            }
          };
          const offline = await call(origin, '/balance/refresh', {});
          assert.equal(offline.status, 502, '网络故障不应冒充“不支持”的 503');
          assert.equal(offline.payload.error.code, 'AI_BALANCE_UNAVAILABLE');
          assert.match(offline.payload.error.message, /无法连接 DeepSeek/);
          context.ai.balance = null;
          const unsupported = await call(origin, '/balance/refresh', {});
          assert.equal(unsupported.payload.error.code, 'AI_BALANCE_UNSUPPORTED');
          context.ai.balance = {
            view: async () => ({ latest: null, checkedAt: null, inferred: [] }),
            refresh: async () => {
              throw Object.assign(new Error('DeepSeek 拒绝了 API Key，无法读取余额。'), {
                code: 'AI_BALANCE_REJECTED'
              });
            }
          };
          const refused = await call(origin, '/balance/refresh', {});
          assert.equal(refused.status, 422);
          assert.equal(refused.payload.error.code, 'AI_BALANCE_REJECTED');
          assert.equal((await fetch(`${origin}/api/ai/assistant/usage`)).status, 200);
        });
      } finally {
        fs.rmSync(directory, { recursive: true, force: true });
      }
    }
  },
  {
    name: '未核价模型与预算故障阻止真实生成、价格过期仅提示并返回具体能力状态',
    async run() {
      const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'knowra-ai-readiness-'));
      try {
        const context = createPersistentAppContext({
          storageRootDir: directory,
          ownerId: 'demo',
          persistenceDriver: 'local-json',
          databaseUrl: null,
          uploadsDir: path.join(directory, 'uploads')
        });
        context.ai.credentialReference = async () => ({
          provider: 'deepseek',
          modelId: 'other-model',
          credentialRef: 'synthetic-ref'
        });
        await withServer(context, async origin => {
          const wrongModel = (await call(origin, '/status')).payload.data;
          assert.equal(wrongModel.generationAvailable, false);
          assert.match(wrongModel.unavailableReason, /尚未核价/);
          assert.equal(wrongModel.capabilities.writeTools, true);
          assert.equal(wrongModel.capabilities.responseMode, 'polling');
          context.ai.credentialReference = async () => ({
            provider: 'deepseek',
            modelId: 'deepseek-flash',
            credentialRef: 'synthetic-ref'
          });
          context.ai.budgetAuthority.status = () => {
            throw new Error('offline');
          };
          const unavailable = (await call(origin, '/status')).payload.data;
          assert.equal(unavailable.generationAvailable, false);
          assert.match(unavailable.unavailableReason, /预算服务不可用/);
        });
        assert.throws(
          () =>
            quoteWorstCase({
              request: {
                modelId: 'other-model',
                messages: [{ role: 'system', content: 'JSON' }],
                maxTokens: 10,
                tools: []
              },
              priceProfile: reviewedDeepSeekPriceProfile
            }),
          error => error.code === 'AI_PRICE_UNAVAILABLE'
        );
        // 价格档案超过复核日期不再阻止调用，只标记为估算。
        assert.equal(
          quoteWorstCase({
            request: {
              modelId: 'deepseek-flash',
              messages: [{ role: 'system', content: 'JSON' }],
              maxTokens: 10,
              tools: []
            },
            priceProfile: reviewedDeepSeekPriceProfile,
            now: new Date(reviewedDeepSeekPriceProfile.expiresAt)
          }).priceStale,
          true
        );
      } finally {
        fs.rmSync(directory, { recursive: true, force: true });
      }
    }
  },
  {
    name: '助手 HTTP 预览、确认、回答持久恢复与来源回读',
    async run() {
      const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'knowra-ai-assistant-'));
      try {
        const context = createPersistentAppContext({ storageRootDir: directory, ownerId: 'demo' });
        const space = context.http.knowledge.createDefaultKnowledgeSpace({});
        const note = context.http.knowledge.createNote({
          id: 'assistant-note',
          title: '测试笔记',
          rawMarkdown: 'alpha 正文',
          spaceId: space.id
        });
        let source;
        context.ai.credentialReference = async () => ({
          provider: 'deepseek',
          modelId: 'deepseek-flash',
          credentialRef: 'synthetic-ref'
        });
        context.ai.generationAvailable = true;
        context.ai.worker = createAiWorker({
          repository: context.ai.repository,
          budget: context.ai.budgetAuthority,
          gateway: {
            capabilities: () => ({ provider: 'mock' }),
            complete: async () => ({
              content: '合成回答',
              json: { answer: 'alpha', citations: [{ sourceId: source.sourceId, start: 0, end: 5, quote: 'alpha' }] },
              usage: { inputTokens: 10, outputTokens: 5, unknown: false }
            })
          },
          priceProfile,
          verifySources: (job, request) => context.ai.readContext.verifyJobSources(job, request),
          validateResult: (job, result) => context.ai.readContext.validateAnswer({ jobId: job.jobId, result })
        });
        let jobId;
        await withServer(context, async origin => {
          const status = await call(origin, '/status');
          assert.equal(status.payload.data.generationAvailable, true);
          assert.equal(status.payload.data.executionLocation, 'server');
          const preview = await call(origin, '/preview', {
            spaceId: space.id,
            scope: { kind: 'note', noteId: note.id },
            question: 'alpha 是什么？'
          });
          assert.equal(preview.status, 200);
          assert.deepEqual(
            preview.payload.data.sources.map(item => item.text),
            ['alpha 正文']
          );
          source = preview.payload.data.sources[0];
          assert.equal(context.ai.repository.list('aiJob').length, 0);
          assert.equal((await call(origin, '/jobs', { previewId: preview.payload.data.previewId }, '0')).status, 403);
          const stale = await call(origin, '/jobs', {
            previewId: preview.payload.data.previewId,
            scopeHash: preview.payload.data.scopeHash,
            payloadHash: '0',
            idempotencyKey: 'synthetic-01'
          });
          assert.equal(stale.status, 409);
          const created = await call(origin, '/jobs', {
            previewId: preview.payload.data.previewId,
            scopeHash: preview.payload.data.scopeHash,
            payloadHash: preview.payload.data.payloadHash,
            idempotencyKey: 'synthetic-01'
          });
          assert.equal(created.status, 202);
          jobId = created.payload.data.jobId;
          for (let i = 0; i < 30; i++) {
            const task = await call(origin, `/jobs/${jobId}`);
            if (task.payload.data.status === 'succeeded') {
              assert.equal(task.payload.data.result.answer, 'alpha');
              assert.equal(task.payload.data.result.citations[0].noteId, note.id);
              assert.equal(task.payload.data.diagnostics[0].eventKind, 'taskCreated');
              assert.equal(task.payload.data.diagnostics.at(-1).eventKind, 'taskSucceeded');
              assert.equal(
                task.payload.data.diagnostics.some(event => event.eventKind === 'providerResponseReceived'),
                true
              );
              assert.equal(JSON.stringify(task.payload.data.diagnostics).includes('alpha 正文'), false);
              assert.equal(JSON.stringify(task.payload.data.diagnostics).includes('合成回答'), false);
              break;
            }
            await new Promise(resolve => setTimeout(resolve, 10));
            if (i === 29) assert.fail('任务未完成');
          }
        });
        const reopened = createPersistentAppContext({ storageRootDir: directory, ownerId: 'demo' });
        reopened.ai.credentialReference = async () => null;
        await withServer(reopened, async origin => {
          const list = await call(origin, `/jobs?spaceId=${encodeURIComponent(space.id)}`);
          assert.equal(list.payload.data[0].jobId, jobId);
          const task = await call(origin, `/jobs/${jobId}`);
          assert.equal(task.payload.data.question, 'alpha 是什么？');
          assert.equal(task.payload.data.result.answer, 'alpha');
          assert.equal(task.payload.data.sources[0].noteVersionId, source.noteVersionId);
          assert.equal(task.payload.data.diagnostics.at(-1).eventKind, 'taskSucceeded');
        });
      } finally {
        fs.rmSync(directory, { recursive: true, force: true });
      }
    }
  },
  {
    name: '助手 HTTP 将达到输出上限的回答标为截断，并结算已知用量',
    async run() {
      const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'knowra-ai-truncated-'));
      try {
        const context = createPersistentAppContext({ storageRootDir: directory, ownerId: 'demo' });
        const space = context.http.knowledge.createDefaultKnowledgeSpace({});
        context.http.knowledge.createNote({
          id: 'truncated-note',
          title: '测试笔记',
          rawMarkdown: '合成笔记正文',
          spaceId: space.id
        });
        context.ai.credentialReference = async () => ({
          provider: 'deepseek',
          modelId: 'deepseek-flash',
          credentialRef: 'synthetic-ref'
        });
        context.ai.generationAvailable = true;
        context.ai.worker = createAiWorker({
          repository: context.ai.repository,
          budget: context.ai.budgetAuthority,
          gateway: {
            capabilities: () => ({ provider: 'mock' }),
            complete: async () => ({
              content: 'synthetic-incomplete-answer',
              json: null,
              finishReason: 'length',
              truncated: true,
              usage: { inputTokens: 3446, outputTokens: 512, unknown: false }
            })
          },
          priceProfile,
          verifySources: (job, request) => context.ai.readContext.verifyJobSources(job, request),
          validateResult: (job, result) => context.ai.readContext.validateAnswer({ jobId: job.jobId, result })
        });
        await withServer(context, async origin => {
          const preview = (
            await call(origin, '/preview', {
              spaceId: space.id,
              scope: { kind: 'note', noteId: 'truncated-note' },
              question: '请总结笔记'
            })
          ).payload.data;
          const created = await call(origin, '/jobs', {
            previewId: preview.previewId,
            scopeHash: preview.scopeHash,
            payloadHash: preview.payloadHash,
            idempotencyKey: 'truncated-test-1'
          });
          assert.equal(created.status, 202);
          const jobId = created.payload.data.jobId;
          for (let i = 0; i < 30; i++) {
            const task = (await call(origin, `/jobs/${jobId}`)).payload.data;
            if (task.status === 'failed' && task.diagnostics.some(event => event.eventKind === 'taskFailed')) {
              assert.equal(task.result, null);
              assert.equal(
                task.diagnostics.find(event => event.eventKind === 'attemptPrepared').safePayload.maxOutputTokens,
                4096
              );
              assert.equal(task.diagnostics.at(-1).safePayload.code, 'AI_OUTPUT_TRUNCATED');
              assert.equal(
                task.diagnostics.find(event => event.eventKind === 'attemptFailed').safePayload.budgetDisposition,
                'settled'
              );
              assert.equal(JSON.stringify(task.diagnostics).includes('synthetic-incomplete-answer'), false);
              break;
            }
            await new Promise(resolve => setTimeout(resolve, 10));
            if (i === 29) assert.fail('截断诊断未完成');
          }
        });
        const budget = context.ai.budgetAuthority.status('deepseek-primary');
        assert.equal(budget.heldMicrounits, 0);
        assert.equal(budget.spentMicrounits, 10_988);
        assert.equal(context.ai.repository.list('aiUsageRecord')[0].actualMicrounits, 10_988);
      } finally {
        fs.rmSync(directory, { recursive: true, force: true });
      }
    }
  },
  {
    name: '助手 HTTP 在模型任务失败后展示持久错误码，不泄露异常正文',
    async run() {
      const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'knowra-ai-assistant-failure-'));
      try {
        const context = createPersistentAppContext({ storageRootDir: directory, ownerId: 'demo' });
        const space = context.http.knowledge.createDefaultKnowledgeSpace({});
        context.http.knowledge.createNote({
          id: 'failure-note',
          title: '测试笔记',
          rawMarkdown: '合成笔记正文',
          spaceId: space.id
        });
        context.ai.credentialReference = async () => ({
          provider: 'deepseek',
          modelId: 'deepseek-flash',
          credentialRef: 'synthetic-ref'
        });
        context.ai.generationAvailable = true;
        context.ai.worker = {
          async run() {
            throw Object.assign(new Error('synthetic-secret-and-raw-answer'), { code: 'AI_PROVIDER_UNAVAILABLE' });
          }
        };
        let jobId;
        await withServer(context, async origin => {
          const preview = (
            await call(origin, '/preview', {
              spaceId: space.id,
              scope: { kind: 'note', noteId: 'failure-note' },
              question: '合成问题？'
            })
          ).payload.data;
          const created = await call(origin, '/jobs', {
            previewId: preview.previewId,
            scopeHash: preview.scopeHash,
            payloadHash: preview.payloadHash,
            idempotencyKey: 'failure-test-1'
          });
          assert.equal(created.status, 202);
          jobId = created.payload.data.jobId;
          for (let i = 0; i < 30; i++) {
            const task = (await call(origin, `/jobs/${jobId}`)).payload.data;
            if (task.status === 'failed' && task.diagnostics.some(event => event.eventKind === 'taskFailed')) {
              assert.equal(task.diagnostics.at(-1).safePayload.code, 'AI_PROVIDER_UNAVAILABLE');
              assert.equal(JSON.stringify(task.diagnostics).includes('synthetic-secret'), false);
              assert.equal(JSON.stringify(task.diagnostics).includes('合成笔记正文'), false);
              break;
            }
            await new Promise(resolve => setTimeout(resolve, 10));
            if (i === 29) assert.fail('失败诊断未完成');
          }
        });
        const reopened = createPersistentAppContext({ storageRootDir: directory, ownerId: 'demo' });
        await withServer(reopened, async origin => {
          const task = (await call(origin, `/jobs/${jobId}`)).payload.data;
          assert.equal(task.status, 'failed');
          assert.equal(task.diagnostics.at(-1).safePayload.code, 'AI_PROVIDER_UNAVAILABLE');
        });
      } finally {
        fs.rmSync(directory, { recursive: true, force: true });
      }
    }
  },
  {
    name: '助手在外发门禁关闭时只允许预览，开放合成执行后可通过 HTTP 取消',
    async run() {
      const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'knowra-ai-assistant-gate-'));
      try {
        const context = createPersistentAppContext({ storageRootDir: directory, ownerId: 'demo' });
        context.aiLocation = 'local';
        const space = context.http.knowledge.createDefaultKnowledgeSpace({});
        const note = context.http.knowledge.createNote({
          id: 'gated-note',
          title: '门禁',
          rawMarkdown: '正文',
          spaceId: space.id
        });
        context.ai.credentialReference = async () => ({
          provider: 'deepseek',
          modelId: 'deepseek-flash',
          credentialRef: 'synthetic-ref'
        });
        context.ai.generationAvailable = false;
        await withServer(context, async origin => {
          assert.equal((await call(origin, '/status')).payload.data.executionLocation, 'local');
          const preview = await call(origin, '/preview', {
            spaceId: space.id,
            scope: { kind: 'note', noteId: note.id },
            question: '内容？'
          });
          assert.equal(preview.status, 200);
          const created = await call(origin, '/jobs', {
            previewId: preview.payload.data.previewId,
            scopeHash: preview.payload.data.scopeHash,
            payloadHash: preview.payload.data.payloadHash,
            idempotencyKey: 'gated-test-1'
          });
          assert.equal(created.status, 409);
          assert.equal(created.payload.error.code, 'AI_GENERATION_UNAVAILABLE');
          assert.equal(context.ai.repository.list('aiJob').length, 0);
          let entered;
          const sent = new Promise(resolve => {
            entered = resolve;
          });
          context.ai.generationAvailable = true;
          context.ai.worker = createAiWorker({
            repository: context.ai.repository,
            budget: context.ai.budgetAuthority,
            gateway: {
              capabilities: () => ({ provider: 'mock' }),
              complete: ({ signal }) =>
                new Promise((resolve, reject) => {
                  entered();
                  signal.addEventListener('abort', () =>
                    reject(Object.assign(new Error('cancelled'), { code: 'AI_CANCELLED' }))
                  );
                })
            },
            priceProfile,
            verifySources: (job, request) => context.ai.readContext.verifyJobSources(job, request),
            validateResult: (job, result) => context.ai.readContext.validateAnswer({ jobId: job.jobId, result })
          });
          const accepted = await call(origin, '/jobs', {
            previewId: preview.payload.data.previewId,
            scopeHash: preview.payload.data.scopeHash,
            payloadHash: preview.payload.data.payloadHash,
            idempotencyKey: 'gated-test-1'
          });
          assert.equal(accepted.status, 202);
          await sent;
          assert.equal((await call(origin, `/jobs/${accepted.payload.data.jobId}/cancel`, {})).status, 200);
          for (let i = 0; i < 20; i++) {
            if ((await call(origin, `/jobs/${accepted.payload.data.jobId}`)).payload.data.status === 'cancelled') break;
            await new Promise(resolve => setTimeout(resolve, 10));
            if (i === 19) assert.fail('取消未进入终态');
          }
        });
      } finally {
        fs.rmSync(directory, { recursive: true, force: true });
      }
    }
  }
];
