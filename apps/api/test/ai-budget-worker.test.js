import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createFileDataStore } from '../src/infrastructure/file-data-store.js';
import {
  beijingDay,
  reserveBudget,
  settleBudget,
  usageSummary,
  validateBudgetState
} from '../src/modules/ai/budget-ledger.js';
import { createAiWorker, quoteWorstCase } from '../src/modules/ai/worker.js';
import { createServer } from '../src/server.js';
import { createRemoteBudgetAuthority } from '../src/modules/ai/remote-budget-authority.js';
import { createAiRuntime } from '../src/modules/ai/runtime.js';
import { aiRecords } from './ai-record-fixtures.js';
import { reviewedPriceProfileTests } from './reviewed-price-profile.test.js';

function withStore(run) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'knowra-ai-worker-'));
  const file = path.join(directory, 'data.json');
  const cleanup = () => fs.rmSync(directory, { recursive: true, force: true });
  try {
    const result = run(createFileDataStore(file), file);
    if (result?.then) return result.finally(cleanup);
    cleanup();
    return result;
  } catch (error) {
    cleanup();
    throw error;
  }
}
const at = () => new Date('2026-09-26T00:00:00.000Z');
const profile = {
  version: 'test-price-v1',
  expiresAt: '2030-01-01T00:00:00.000Z',
  inputMicrounitsPerMillion: 2_000_000,
  outputMicrounitsPerMillion: 8_000_000
};
const request = {
  credentialRef: 'credential-reference',
  modelId: 'deepseek-flash',
  messages: [{ role: 'user', content: '合成测试' }],
  maxTokens: 100,
  tools: [],
  format: 'text'
};

export const aiBudgetWorkerTests = [
  ...reviewedPriceProfileTests,
  {
    name: '用量汇总：今日/本月/累计分开统计，未知请求单独计数，明细只含数字与 ID，旧账本无明细仍可读',
    async run() {
      const state = { budgetDays: [], budgetReservations: [] };
      const account = 'deepseek-primary';
      const call = (n, day, disposition, actual, usage) => {
        reserveBudget(state, {
          accountRef: account,
          jobId: `job-${n}`,
          attemptId: `a-${n}`,
          priceVersion: 'p1',
          reservedMicrounits: 1_000_000,
          day
        });
        return settleBudget(state, {
          accountRef: account,
          attemptId: `a-${n}`,
          disposition,
          actualMicrounits: actual,
          usage
        });
      };
      call(1, '2026-09-30', 'settled', 400_000, {
        modelId: 'deepseek-flash',
        inputTokens: 1000,
        outputTokens: 50,
        cacheHitTokens: 600,
        conversationId: 'c-1'
      });
      call(2, '2026-10-02', 'settled', 100_000);
      call(3, '2026-10-08', 'settled', 300_000, {
        modelId: 'deepseek-flash',
        inputTokens: 200,
        outputTokens: 20,
        cacheHitTokens: null,
        conversationId: 'c-2'
      });
      call(4, '2026-10-08', 'unknown', null, { modelId: 'deepseek-flash' });
      reserveBudget(state, {
        accountRef: account,
        jobId: 'job-5',
        attemptId: 'a-5',
        priceVersion: 'p1',
        reservedMicrounits: 1_000_000,
        day: '2026-10-08'
      });
      validateBudgetState(state);
      const summary = usageSummary(state, account, '2026-10-08');
      assert.deepEqual(
        [
          summary.today.requests,
          summary.today.spentMicrounits,
          summary.today.unknownRequests,
          summary.today.unknownMicrounits
        ],
        [2, 300_000, 1, 1_000_000]
      );
      assert.deepEqual([summary.month.requests, summary.month.spentMicrounits], [3, 400_000]);
      assert.deepEqual(
        [
          summary.total.requests,
          summary.total.spentMicrounits,
          summary.total.inputTokens,
          summary.total.cacheHitTokens
        ],
        [4, 800_000, 1200, 600]
      );
      assert.equal(summary.recent.length, 4, '进行中的预留不算作已发生的用量');
      assert.equal(summary.recent[0].attemptId, 'a-4');
      assert.deepEqual(Object.keys(summary.recent[2]).sort(), [
        'at',
        'attemptId',
        'cacheHitTokens',
        'conversationId',
        'costMicrounits',
        'day',
        'inputTokens',
        'modelId',
        'outputTokens',
        'priceVersion',
        'status'
      ]);
      assert.equal(summary.recent.find(row => row.attemptId === 'a-2').modelId, null, '未带明细的结算仍计入汇总');
      // 用量明细只清洗不拒绝：异常明细不能让结算失败；多余字段（如对话内容）被丢弃；会话 ID 可含中文。
      const odd = settleBudget(state, {
        accountRef: account,
        attemptId: 'a-5',
        disposition: 'released',
        usage: {
          inputTokens: -1,
          outputTokens: 7,
          content: '对话内容',
          conversationId: '会话/已导入',
          modelId: 'x'.repeat(200)
        }
      });
      assert.deepEqual(odd.usage, {
        modelId: null,
        inputTokens: null,
        outputTokens: 7,
        cacheHitTokens: null,
        conversationId: '会话/已导入'
      });
      assert.equal(JSON.stringify(odd).includes('对话内容'), false);
      assert.throws(
        () =>
          validateBudgetState({
            ...structuredClone(state),
            budgetReservations: state.budgetReservations.map(row => ({ ...row, usage: 'x' }))
          }),
        { code: 'AI_BUDGET_INVALID' }
      );
    }
  },
  {
    name: '预算预留覆盖完整外发体，工具定义过大与已确认 payload 变化均拒绝',
    async run() {
      const plain = quoteWorstCase({ request, priceProfile: profile, now: at() });
      const withTool = quoteWorstCase({
        request: {
          ...request,
          tools: [{ name: 'notes_read', parameters: { type: 'object', description: 'x'.repeat(1000) } }]
        },
        priceProfile: profile,
        now: at()
      });
      assert(withTool.inputUpperBound > plain.inputUpperBound);
      assert(withTool.reservedMicrounits > plain.reservedMicrounits);
      assert.notEqual(withTool.payloadHash, plain.payloadHash);
      assert.throws(
        () =>
          quoteWorstCase({
            request: {
              ...request,
              tools: [{ name: 'notes_read', parameters: { type: 'object', description: 'x'.repeat(100_000) } }]
            },
            priceProfile: profile,
            now: at()
          }),
        { code: 'AI_REQUEST_LIMIT' }
      );
      await withStore(async store => {
        const records = aiRecords(store.aiRepository.identity());
        for (const [kind, record] of [
          ['scopeSnapshot', records.scope],
          ['contextManifest', records.manifest],
          ['aiGrant', records.grant],
          ['aiJob', records.job]
        ])
          store.aiRepository.insert(kind, record);
        const worker = createAiWorker({
          repository: store.aiRepository,
          budget: store.aiBudgetAuthority,
          gateway: {
            capabilities: () => ({ provider: 'mock' }),
            complete: async () => {
              throw new Error('must not send');
            }
          },
          priceProfile: profile,
          now: at
        });
        await assert.rejects(
          worker.run(records.job.jobId, { ...request, messages: [{ role: 'user', content: '变更后的内容' }] }),
          { code: 'AI_PAYLOAD_STALE' }
        );
        assert.equal(store.aiRepository.list('aiJobAttempt').length, 0);
        assert.equal(store.aiBudgetAuthority.status('deepseek-primary', '2026-09-26').heldMicrounits, 0);
      });
    }
  },
  {
    name: '真实 adapter 只有 Worker 已预留的短期票据可调用，凭据读取在预算之后',
    async run() {
      await withStore(async store => {
        const records = aiRecords(store.aiRepository.identity());
        for (const [kind, record] of [
          ['scopeSnapshot', records.scope],
          ['contextManifest', records.manifest],
          ['aiGrant', records.grant],
          ['aiJob', records.job]
        ])
          store.aiRepository.insert(kind, record);
        let reads = 0;
        let calls = 0;
        const runtime = createAiRuntime({
          repository: store.aiRepository,
          budgetAuthority: store.aiBudgetAuthority,
          priceProfile: profile,
          allowExternal: true,
          verifySources: async () => {},
          validateResult: async () => {},
          modelSettings: {
            credentialReference: () => 'credential-reference',
            async resolveCredential() {
              reads++;
              return { apiKey: 'synthetic-key', modelId: 'deepseek-flash' };
            }
          },
          fetchImpl: async () => {
            calls++;
            assert(store.aiBudgetAuthority.status('deepseek-primary', beijingDay(new Date())).heldMicrounits > 0);
            return new Response(
              JSON.stringify({
                id: 'synthetic-response',
                model: 'deepseek-flash',
                usage: { prompt_tokens: 2, completion_tokens: 2 },
                choices: [{ finish_reason: 'stop', message: { content: '合成成功' } }]
              }),
              { status: 200 }
            );
          }
        });
        await assert.rejects(runtime.gateway.complete(request), { code: 'AI_BUDGET_NOT_AUTHORIZED' });
        assert.equal(reads, 0);
        assert.equal((await runtime.worker.run(records.job.jobId, request)).content, '合成成功');
        assert.equal(reads, 1);
        assert.equal(calls, 1);
        await assert.rejects(runtime.gateway.complete(request), { code: 'AI_BUDGET_NOT_AUTHORIZED' });
      });
    }
  },
  {
    name: '预算预留跨北京时间零点时停止发送并释放旧日额度',
    async run() {
      await withStore(async store => {
        const records = aiRecords(store.aiRepository.identity());
        for (const [kind, record] of [
          ['scopeSnapshot', records.scope],
          ['contextManifest', records.manifest],
          ['aiGrant', records.grant],
          ['aiJob', records.job]
        ])
          store.aiRepository.insert(kind, record);
        let instant = new Date('2026-09-25T15:59:59.000Z');
        let calls = 0;
        const budget = {
          reserve: async input => {
            const result = store.aiBudgetAuthority.reserve(input);
            instant = new Date('2026-09-25T16:00:00.000Z');
            return result;
          },
          settle: input => store.aiBudgetAuthority.settle(input)
        };
        const worker = createAiWorker({
          repository: store.aiRepository,
          budget,
          gateway: {
            capabilities: () => ({ provider: 'mock' }),
            async complete() {
              calls++;
              return {};
            }
          },
          priceProfile: profile,
          now: () => instant
        });
        await assert.rejects(worker.run(records.job.jobId, request), { code: 'AI_BUDGET_DAY_CHANGED' });
        assert.equal(calls, 0);
        assert.equal(store.aiBudgetAuthority.status('deepseek-primary', '2026-09-25').heldMicrounits, 0);
        assert.equal(store.aiBudgetAuthority.status('deepseek-primary', '2026-09-26').spentMicrounits, 0);
      });
    }
  },
  {
    name: '快照之后、发送之前用户暂停：Worker 不发送，并释放已预留的额度',
    async run() {
      await withStore(async store => {
        const records = aiRecords(store.aiRepository.identity());
        for (const [kind, record] of [
          ['scopeSnapshot', records.scope],
          ['contextManifest', records.manifest],
          ['aiGrant', records.grant],
          ['aiJob', records.job]
        ])
          store.aiRepository.insert(kind, record);
        let calls = 0,
          snapshots = 0;
        const paused = Object.assign(new Error('AI 已暂停'), { code: 'AI_PAUSED_BY_USER' });
        const policy = {
          snapshot: async () => {
            snapshots += 1;
            return { profile, limits: { daily: 20_000_000, monthly: null, turn: 2_000_000 } };
          },
          assertRunnable: async () => {
            throw paused;
          }
        }; // 快照通过之后用户点了暂停
        const worker = createAiWorker({
          repository: store.aiRepository,
          budget: store.aiBudgetAuthority,
          gateway: {
            capabilities: () => ({ provider: 'mock' }),
            async complete() {
              calls++;
              return {};
            }
          },
          priceProfile: profile,
          policy,
          now: at
        });
        await assert.rejects(worker.run(records.job.jobId, request), { code: 'AI_PAUSED_BY_USER' });
        assert.equal(snapshots, 1);
        assert.equal(calls, 0, '没有发送任何模型请求');
        assert.equal(store.aiBudgetAuthority.status('deepseek-primary', '2026-09-26').heldMicrounits, 0, '预留已释放');
      });
    }
  },
  {
    name: '远端预算回执日期或账户不匹配时不读取密钥且释放预留',
    async run() {
      await withStore(async store => {
        const records = aiRecords(store.aiRepository.identity());
        for (const [kind, record] of [
          ['scopeSnapshot', records.scope],
          ['contextManifest', records.manifest],
          ['aiGrant', records.grant],
          ['aiJob', records.job]
        ])
          store.aiRepository.insert(kind, record);
        let calls = 0;
        const budget = {
          reserve: async input => ({ ...store.aiBudgetAuthority.reserve(input), day: '2026-09-27' }),
          settle: input => store.aiBudgetAuthority.settle(input)
        };
        const worker = createAiWorker({
          repository: store.aiRepository,
          budget,
          gateway: {
            capabilities: () => ({ provider: 'deepseek' }),
            async complete() {
              calls++;
              return {};
            }
          },
          priceProfile: profile,
          now: at,
          allowExternal: true,
          verifySources: async () => {},
          validateResult: async () => {}
        });
        await assert.rejects(worker.run(records.job.jobId, request), { code: 'AI_BUDGET_INVALID' });
        assert.equal(calls, 0);
        assert.equal(store.aiBudgetAuthority.status('deepseek-primary', '2026-09-26').heldMicrounits, 0);
      });
    }
  },
  {
    name: '云端预算 HTTP 与远端客户端共用权威账本，错误和断网均拒绝执行',
    async run() {
      await withStore(async store => {
        const server = createServer({
          appContext: { http: { aiBudget: store.aiBudgetAuthority } },
          logger: { error() {} }
        });
        await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
        try {
          const origin = `http://127.0.0.1:${server.address().port}`;
          const requestBudget = async (route, body, header = '1') => {
            const response = await fetch(`${origin}/api/ai/budget/${route}`, {
              method: body ? 'POST' : 'GET',
              headers: { 'X-Knowra-AI-Budget': header, ...(body ? { 'Content-Type': 'application/json' } : {}) },
              ...(body ? { body: JSON.stringify(body) } : {})
            });
            const payload = await response.json();
            if (!response.ok) throw Object.assign(new Error(payload.error?.message), { code: payload.error?.code });
            return payload.data;
          };
          await assert.rejects(requestBudget('status', null, '0'), { code: 'AI_BUDGET_REQUEST_REJECTED' });
          const remote = createRemoteBudgetAuthority(requestBudget);
          const reserved = await remote.reserve({
            jobId: 'remote-job',
            attemptId: 'remote-attempt',
            reservedMicrounits: 200_000,
            priceVersion: 'test-price'
          });
          assert.equal(reserved.accountRef, 'deepseek-primary');
          assert.equal((await remote.status()).heldMicrounits, 200_000);
          await remote.settle({ attemptId: 'remote-attempt', disposition: 'unknown' });
          assert.equal((await remote.status()).heldMicrounits, 200_000);
          const offline = createRemoteBudgetAuthority(() =>
            Promise.reject(Object.assign(new Error('offline'), { code: 'AI_BUDGET_UNAVAILABLE' }))
          );
          await assert.rejects(offline.reserve({}), { code: 'AI_BUDGET_UNAVAILABLE' });
        } finally {
          await new Promise(resolve => server.close(resolve));
        }
      });
    }
  },
  {
    name: '预算账本跨调用者共享北京日 20 元，重试幂等、未知用量占额且重启保留',
    run() {
      withStore((store, file) => {
        const a = store.aiBudgetAuthority;
        assert.equal(beijingDay(new Date('2026-09-25T16:00:00.000Z')), '2026-09-26');
        for (let i = 0; i < 10; i++)
          a.reserve({
            accountRef: 'deepseek-primary',
            jobId: `job-${i}`,
            attemptId: `attempt-${i}`,
            priceVersion: 'v1',
            reservedMicrounits: 2_000_000,
            day: '2026-09-26'
          });
        const before = a.status('deepseek-primary', '2026-09-26');
        assert.equal(before.availableMicrounits, 0);
        assert.equal(
          a.reserve({
            accountRef: 'deepseek-primary',
            jobId: 'job-0',
            attemptId: 'attempt-0',
            priceVersion: 'v1',
            reservedMicrounits: 2_000_000,
            day: '2026-09-26'
          }).attemptId,
          'attempt-0'
        );
        assert.throws(
          () =>
            a.reserve({
              accountRef: 'deepseek-primary',
              jobId: 'job-99',
              attemptId: 'attempt-99',
              priceVersion: 'v1',
              reservedMicrounits: 1,
              day: '2026-09-26'
            }),
          { code: 'AI_DAILY_BUDGET_EXCEEDED' }
        );
        a.settle({ accountRef: 'deepseek-primary', attemptId: 'attempt-0', disposition: 'unknown' });
        assert.equal(a.status('deepseek-primary', '2026-09-26').availableMicrounits, 0);
        a.settle({
          accountRef: 'deepseek-primary',
          attemptId: 'attempt-0',
          disposition: 'settled',
          actualMicrounits: 2_000_000
        });
        assert.equal(a.status('deepseek-primary', '2026-09-26').availableMicrounits, 0);
        a.settle({
          accountRef: 'deepseek-primary',
          attemptId: 'attempt-1',
          disposition: 'settled',
          actualMicrounits: 500_000
        });
        assert.equal(a.status('deepseek-primary', '2026-09-26').availableMicrounits, 1_500_000);
        assert.equal(
          createFileDataStore(file).aiBudgetAuthority.status('deepseek-primary', '2026-09-26').spentMicrounits,
          2_500_000
        );
        assert.throws(
          () =>
            a.reserve({
              accountRef: 'deepseek-primary',
              jobId: 'job-0',
              attemptId: 'retry-0',
              priceVersion: 'v1',
              reservedMicrounits: 1,
              day: '2026-09-26'
            }),
          { code: 'AI_JOB_BUDGET_EXCEEDED' }
        );
        const corrupt = JSON.parse(fs.readFileSync(file, 'utf8'));
        corrupt.aiRuntime.budgetDays[0].heldMicrounits = 0;
        fs.writeFileSync(file, JSON.stringify(corrupt));
        const degraded = createFileDataStore(file);
        assert.equal(degraded.aiRepository, null);
        assert.equal(degraded.aiBudgetAuthority, null);
        assert.equal(degraded.aiRuntimeError?.code, 'AI_BUDGET_INVALID');
      });
    }
  },
  {
    name: 'Worker 合成调用领取一次、结算真实用量、拒绝重复运行',
    async run() {
      await withStore(async store => {
        const records = aiRecords(store.aiRepository.identity());
        for (const [kind, record] of [
          ['scopeSnapshot', records.scope],
          ['contextManifest', records.manifest],
          ['aiGrant', records.grant],
          ['aiJob', records.job]
        ])
          store.aiRepository.insert(kind, record);
        const gateway = {
          capabilities: () => ({ provider: 'mock' }),
          complete: async () => ({
            content: '合成回答',
            requestId: 'provider-request',
            usage: { inputTokens: 10, outputTokens: 5, unknown: false }
          })
        };
        const worker = createAiWorker({
          repository: store.aiRepository,
          budget: store.aiBudgetAuthority,
          gateway,
          priceProfile: profile,
          now: at
        });
        await assert.rejects(worker.run(records.job.jobId, { ...request, tools: [{ name: 'notes_create' }] }), {
          code: 'AI_REQUEST_INVALID'
        });
        const result = await worker.run(records.job.jobId, request);
        assert.equal(result.content, '合成回答');
        assert.equal(store.aiRepository.get('aiJob', records.job.jobId).status, 'succeeded');
        assert.equal(store.aiRepository.list('aiJobAttempt').length, 1);
        assert.equal(store.aiRepository.list('aiUsageRecord')[0].actualMicrounits, 60);
        assert.equal(store.aiBudgetAuthority.status('deepseek-primary', '2026-09-26').spentMicrounits, 60);
        const events = store.aiRepository.listEvents(records.job.jobId);
        assert.deepEqual(
          events.map(event => event.eventKind),
          [
            'attemptPrepared',
            'budgetReserved',
            'providerRequestStarted',
            'providerResponseReceived',
            'budgetSettled',
            'resultValidated',
            'taskSucceeded'
          ]
        );
        assert.equal(events[3].safePayload.responseId, 'provider-request');
        assert.equal(events[3].safePayload.inputTokens, 10);
        assert.equal(events[4].safePayload.actualMicrounits, 60);
        assert.equal(JSON.stringify(events).includes('合成回答'), false);
        assert.equal(JSON.stringify(events).includes('合成测试'), false);
        await assert.rejects(worker.run(records.job.jobId, request), { code: 'AI_JOB_NOT_RUNNABLE' });
      });
    }
  },
  {
    name: 'Worker 校验失败仍按供应商已知用量结算，不保存原始回答',
    async run() {
      await withStore(async (store, file) => {
        const records = aiRecords(store.aiRepository.identity());
        for (const [kind, record] of [
          ['scopeSnapshot', records.scope],
          ['contextManifest', records.manifest],
          ['aiGrant', records.grant],
          ['aiJob', records.job]
        ])
          store.aiRepository.insert(kind, record);
        const worker = createAiWorker({
          repository: store.aiRepository,
          budget: store.aiBudgetAuthority,
          gateway: {
            capabilities: () => ({ provider: 'mock' }),
            complete: async () => ({
              content: 'synthetic-raw-answer',
              requestId: 'provider-request',
              finishReason: 'stop',
              usage: { inputTokens: 10, outputTokens: 5, unknown: false }
            })
          },
          priceProfile: profile,
          now: at,
          validateResult: async () => {
            throw Object.assign(new Error('synthetic-raw-answer'), { code: 'AI_CITATION_INVALID' });
          }
        });
        await assert.rejects(worker.run(records.job.jobId, request), { code: 'AI_CITATION_INVALID' });
        const events = createFileDataStore(file).aiRepository.listEvents(records.job.jobId);
        assert.equal(events.at(-1).eventKind, 'attemptFailed');
        assert.deepEqual(
          {
            stage: events.at(-1).safePayload.stage,
            code: events.at(-1).safePayload.code,
            disposition: events.at(-1).safePayload.budgetDisposition
          },
          { stage: 'resultValidation', code: 'AI_CITATION_INVALID', disposition: 'settled' }
        );
        assert.equal(events.at(-2).eventKind, 'budgetSettled');
        assert.equal(events.at(-2).safePayload.actualMicrounits, 60);
        assert.equal(events.at(-3).safePayload.outputTokens, 5);
        assert.equal(JSON.stringify(events).includes('synthetic-raw-answer'), false);
        assert.equal(JSON.stringify(events).includes('合成测试'), false);
        assert.equal(store.aiBudgetAuthority.status('deepseek-primary', '2026-09-26').heldMicrounits, 0);
        assert.equal(store.aiBudgetAuthority.status('deepseek-primary', '2026-09-26').spentMicrounits, 60);
        assert.equal(store.aiRepository.list('aiUsageRecord')[0].actualMicrounits, 60);
      });
    }
  },
  {
    name: 'Worker 失败后显式重试最多四次，未知费用仍占日预算',
    async run() {
      await withStore(async store => {
        const records = aiRecords(store.aiRepository.identity());
        for (const [kind, record] of [
          ['scopeSnapshot', records.scope],
          ['contextManifest', records.manifest],
          ['aiGrant', records.grant],
          ['aiJob', records.job]
        ])
          store.aiRepository.insert(kind, record);
        let calls = 0;
        const gateway = {
          capabilities: () => ({ provider: 'mock' }),
          async complete() {
            calls++;
            if (calls === 1)
              throw Object.assign(new Error('provider-secret-body'), {
                code: 'AI_RATE_LIMITED',
                retryable: true,
                httpStatus: 429
              });
            return {
              content: '恢复后的合成回答',
              requestId: 'second',
              usage: { inputTokens: 1, outputTokens: 1, unknown: false }
            };
          }
        };
        const worker = createAiWorker({
          repository: store.aiRepository,
          budget: store.aiBudgetAuthority,
          gateway,
          priceProfile: profile,
          now: at
        });
        await assert.rejects(worker.run(records.job.jobId, request), { code: 'AI_RATE_LIMITED' });
        assert.equal(store.aiRepository.get('aiJob', records.job.jobId).status, 'failed');
        const failed = store.aiRepository.listEvents(records.job.jobId).at(-1);
        assert.equal(failed.safePayload.stage, 'providerResponse');
        assert.equal(failed.safePayload.code, 'AI_RATE_LIMITED');
        assert.equal(failed.safePayload.httpStatus, 429);
        assert.equal(JSON.stringify(failed).includes('provider-secret-body'), false);
        assert(store.aiBudgetAuthority.status('deepseek-primary', '2026-09-26').heldMicrounits > 0);
        await worker.run(records.job.jobId, request);
        assert.equal(store.aiRepository.list('aiJobAttempt').length, 2);
        assert.equal(store.aiRepository.get('aiJob', records.job.jobId).status, 'succeeded');
        assert.equal(calls, 2);
      });
    }
  },
  {
    name: '另一进程在预算预留期间取消任务，Worker 不发送模型请求并释放未使用额度',
    async run() {
      await withStore(async store => {
        const records = aiRecords(store.aiRepository.identity());
        for (const [kind, record] of [
          ['scopeSnapshot', records.scope],
          ['contextManifest', records.manifest],
          ['aiGrant', records.grant],
          ['aiJob', records.job]
        ])
          store.aiRepository.insert(kind, record);
        let entered;
        let release;
        const reserved = new Promise(resolve => {
          entered = resolve;
        });
        const continueReserve = new Promise(resolve => {
          release = resolve;
        });
        const budget = {
          reserve: async input => {
            const result = store.aiBudgetAuthority.reserve(input);
            entered();
            await continueReserve;
            return result;
          },
          settle: input => store.aiBudgetAuthority.settle(input)
        };
        let calls = 0;
        const gateway = {
          capabilities: () => ({ provider: 'mock' }),
          async complete() {
            calls++;
            return {};
          }
        };
        const first = createAiWorker({
          repository: store.aiRepository,
          budget,
          gateway,
          priceProfile: profile,
          now: at
        });
        const second = createAiWorker({
          repository: store.aiRepository,
          budget,
          gateway,
          priceProfile: profile,
          now: at
        });
        const pending = first.run(records.job.jobId, request);
        await reserved;
        await second.cancel(records.job.jobId);
        release();
        await assert.rejects(pending, { code: 'AI_CANCELLED' });
        assert.equal(calls, 0);
        assert.equal(store.aiRepository.get('aiJob', records.job.jobId).status, 'cancelled');
        assert.equal(store.aiBudgetAuthority.status('deepseek-primary', '2026-09-26').heldMicrounits, 0);
      });
    }
  },
  {
    name: 'Worker 取消在途请求，迟到结果不接纳；重启恢复超时预留为未知',
    async run() {
      await withStore(async store => {
        const records = aiRecords(store.aiRepository.identity());
        for (const [kind, record] of [
          ['scopeSnapshot', records.scope],
          ['contextManifest', records.manifest],
          ['aiGrant', records.grant],
          ['aiJob', records.job]
        ])
          store.aiRepository.insert(kind, record);
        let entered;
        const started = new Promise(resolve => {
          entered = resolve;
        });
        const gateway = {
          capabilities: () => ({ provider: 'mock' }),
          complete: ({ signal }) =>
            new Promise((resolve, reject) => {
              entered();
              signal.addEventListener('abort', () =>
                reject(Object.assign(new Error('cancelled'), { code: 'AI_CANCELLED' }))
              );
            })
        };
        const worker = createAiWorker({
          repository: store.aiRepository,
          budget: store.aiBudgetAuthority,
          gateway,
          priceProfile: profile,
          now: at
        });
        const pending = worker.run(records.job.jobId, request);
        await started;
        await worker.cancel(records.job.jobId);
        await assert.rejects(pending, { code: 'AI_CANCELLED' });
        assert.equal(store.aiRepository.get('aiJob', records.job.jobId).status, 'cancelled');
        assert.equal(store.aiBudgetAuthority.status('deepseek-primary', '2026-09-26').spentMicrounits, 0);
        assert(store.aiBudgetAuthority.status('deepseek-primary', '2026-09-26').heldMicrounits > 0);
        const retry = aiRecords(store.aiRepository.identity(), 'retry');
        for (const [kind, record] of [
          ['scopeSnapshot', retry.scope],
          ['contextManifest', retry.manifest],
          ['aiGrant', retry.grant]
        ])
          store.aiRepository.insert(kind, record);
        store.aiRepository.insert('aiJob', { ...retry.job, status: 'running' });
        store.aiRepository.insert('aiJobAttempt', {
          ...retry.attempt,
          status: 'sent',
          leaseExpiresAt: '2026-09-25T00:00:00.000Z'
        });
        store.aiBudgetAuthority.reserve({
          accountRef: 'deepseek-primary',
          jobId: retry.job.jobId,
          attemptId: retry.attempt.attemptId,
          priceVersion: profile.version,
          reservedMicrounits: 10_000,
          day: '2026-09-26'
        });
        assert.equal(await worker.recover(), 1);
        assert.equal(store.aiRepository.get('aiJob', retry.job.jobId).status, 'failed');
        assert.equal(store.aiRepository.get('aiJobAttempt', retry.attempt.attemptId).deliveryUncertain, true);
        const stale = aiRecords(store.aiRepository.identity(), 'stale');
        for (const [kind, record] of [
          ['scopeSnapshot', stale.scope],
          ['contextManifest', stale.manifest],
          ['aiGrant', stale.grant]
        ])
          store.aiRepository.insert(kind, record);
        store.aiRepository.insert('aiJob', { ...stale.job, status: 'running' });
        store.aiRepository.rotateEpoch();
        assert.equal(await worker.recover(), 0);
        assert.equal(store.aiRepository.get('aiJob', stale.job.jobId).status, 'running');
      });
    }
  },
  {
    name: '读取用量汇总时清洗已有明细：token 被写成字符串、负数或超限时按未记录处理，不产生 NaN 或字符串拼接',
    run() {
      const state = { budgetDays: [], budgetReservations: [] };
      const account = 'deepseek-primary';
      for (const n of [1, 2]) {
        reserveBudget(state, {
          accountRef: account,
          jobId: `job-${n}`,
          attemptId: `a-${n}`,
          priceVersion: 'p1',
          reservedMicrounits: 1_000_000,
          day: '2026-10-08'
        });
        settleBudget(state, {
          accountRef: account,
          attemptId: `a-${n}`,
          disposition: 'settled',
          actualMicrounits: 1000,
          usage: { inputTokens: 10, outputTokens: 1 }
        });
      }
      // 模拟账本里已存在的损坏明细（旧版本或手工改动）：仍是对象，所以通过账本校验。
      state.budgetReservations[0].usage = {
        inputTokens: '10',
        outputTokens: -3,
        cacheHitTokens: { x: 1 },
        modelId: 42,
        conversationId: ['a']
      };
      state.budgetReservations[1].usage = { inputTokens: 5, outputTokens: 2, cacheHitTokens: 99 };
      validateBudgetState(state);
      const summary = usageSummary(state, account, '2026-10-08');
      assert.deepEqual(
        [summary.total.inputTokens, summary.total.outputTokens, summary.total.cacheHitTokens],
        [5, 2, 0]
      );
      for (const value of Object.values(summary.total)) assert.equal(typeof value, 'number');
      const bad = summary.recent.find(row => row.attemptId === 'a-1');
      assert.deepEqual(
        [bad.inputTokens, bad.outputTokens, bad.cacheHitTokens, bad.modelId, bad.conversationId],
        [null, null, null, null, null]
      );
      assert.equal(
        summary.recent.find(row => row.attemptId === 'a-2').cacheHitTokens,
        null,
        '命中数超过输入数时视为未记录'
      );
    }
  }
];
