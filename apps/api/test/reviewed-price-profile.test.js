import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createFileDataStore } from '../src/infrastructure/file-data-store.js';
import { beijingDay, createJsonBudgetAuthority } from '../src/modules/ai/budget-ledger.js';
import { createJsonAiConversationStore } from '../src/modules/ai/conversation-store.js';
import { createEmptyAiState } from '../src/modules/ai/record-state.ts';
import { createAiAgentWorker } from '../src/modules/ai/agent-worker.js';
import { createAiWorker, quoteWorstCase } from '../src/modules/ai/worker.js';
import { reviewedDeepSeekPriceProfile as profile } from '../src/modules/ai/reviewed-price-profile.ts';
import { aiRecords } from './ai-record-fixtures.js';

const reviewedAt = '2026-10-02T13:58:04.783Z';
// 来自刷新前正式档案；回归必须覆盖其真实截止日，而非模拟远期价格。
const previousCutoff = '2026-10-05T00:00:00.000Z';
const reviewCutoff = '2026-10-09T00:00:00.000Z';
const priceVersion = 'deepseek-flash-cny-2026-10-02';
const accountRef = 'deepseek-primary';
const request = {
  credentialRef: 'credential-reference',
  modelId: 'deepseek-flash',
  messages: [{ role: 'user', content: '合成测试' }],
  maxTokens: 100,
  tools: [],
  format: 'text'
};
const quote = (now, changedRequest = request, priceProfile = profile) =>
  quoteWorstCase({
    request: changedRequest,
    priceProfile,
    now: new Date(now)
  });
const response = usage => ({
  content: '合成回答',
  requestId: 'synthetic-response',
  toolCalls: [],
  finishReason: 'stop',
  truncated: false,
  refused: false,
  usage
});

async function withWorkerStore(run) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'knowra-price-review-'));
  const file = path.join(directory, 'data.json');
  try {
    const store = createFileDataStore(file);
    const records = aiRecords(store.aiRepository.identity());
    for (const [kind, record] of [
      ['scopeSnapshot', records.scope],
      ['contextManifest', records.manifest],
      ['aiGrant', records.grant],
      ['aiJob', records.job]
    ])
      store.aiRepository.insert(kind, record);
    await run(store, records, file);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

function agentFixture(now, usage) {
  const state = createEmptyAiState();
  const adapter = { getState: () => state, runTransaction: operation => operation(), onChange() {} };
  const store = createJsonAiConversationStore(adapter, { now });
  const authority = createJsonBudgetAuthority(adapter);
  const calls = { gateway: 0, reservations: [], settlements: [] };
  const budget = {
    async reserve(input) {
      calls.reservations.push(input);
      return authority.reserve(input);
    },
    async settle(input) {
      calls.settlements.push(input);
      return authority.settle(input);
    }
  };
  const agent = createAiAgentWorker({
    store,
    budget,
    priceProfile: profile,
    now,
    modelSettings: { credentialReference: async () => ({ modelId: 'deepseek-flash', credentialRef: 'synthetic' }) },
    gateway: {
      capabilities: () => ({ provider: 'mock' }),
      async complete() {
        calls.gateway++;
        return response(usage);
      }
    }
  });
  return { store, state, authority, budget, calls, agent };
}

export const reviewedPriceProfileTests = [
  {
    name: '正式核价覆盖原截止日；超过复核日期仍可报价，只标记 priceStale 提示费用为估算',
    run() {
      assert(quote(previousCutoff).reservedMicrounits > 0);
      assert(quote('2026-10-08T23:59:59.999Z').reservedMicrounits > 0);
      assert.equal(profile.version, priceVersion);
      assert.equal(profile.expiresAt, reviewCutoff);
      assert.equal(quote('2026-10-08T23:59:59.999Z').priceStale, false);
      for (const time of [reviewCutoff, '2026-10-09T00:00:00.001Z', '2027-01-01T00:00:00.000Z']) {
        const stale = quote(time);
        assert.equal(stale.priceStale, true);
        assert.equal(stale.reservedMicrounits, quote(reviewedAt).reservedMicrounits);
      }
    }
  },
  {
    name: '正式核价只适用 deepseek-flash，其他模型、缺失或无效档案均拒绝',
    run() {
      for (const modelId of ['deepseek-v4-pro', 'deepseek-v4-flash', 'DeepSeek-V4.1-Flash', '', undefined]) {
        assert.throws(() => quote(reviewedAt, { ...request, modelId }), { code: 'AI_PRICE_UNAVAILABLE' });
      }
      for (const invalid of [
        null,
        {},
        { ...profile, expiresAt: 'invalid-date' },
        { ...profile, inputMicrounitsPerMillion: -1 },
        { ...profile, outputMicrounitsPerMillion: NaN }
      ]) {
        assert.throws(() => quote(reviewedAt, request, invalid), { code: 'AI_PRICE_UNAVAILABLE' });
      }
    }
  },
  {
    name: '正式核价保留高峰未命中金额与两倍预留，工具正文仍纳入报价',
    run() {
      assert.equal(profile.inputMicrounitsPerMillion, 2_000_000);
      assert.equal(profile.outputMicrounitsPerMillion, 8_000_000);
      for (const time of ['2026-10-02T02:00:00.000Z', '2026-10-02T15:00:00.000Z', previousCutoff]) {
        // 固定合成外发体为 143 字节；输入 286、输出 800 微元，再按两倍预留。
        assert.equal(quote(time).inputUpperBound, 143);
        assert.equal(quote(time).reservedMicrounits, 2172);
      }
      const larger = quote(reviewedAt, {
        ...request,
        tools: [{ name: 'notes_read', parameters: { type: 'object', description: 'x'.repeat(1000) } }]
      });
      assert(larger.inputUpperBound > 143);
      assert(larger.reservedMicrounits > 2172);
      assert.throws(
        () => quote(reviewedAt, { ...request, messages: [{ role: 'user', content: 'x'.repeat(100_000) }] }),
        { code: 'AI_REQUEST_LIMIT' }
      );
      assert.throws(() => quote(reviewedAt, { ...request, maxTokens: 20_001 }), { code: 'AI_REQUEST_LIMIT' });
    }
  },
  {
    name: 'Worker 价格档案超过复核日期仍可调用模型并按估算结算，不再阻断',
    async run() {
      await withWorkerStore(async (store, records) => {
        let calls = 0;
        const worker = createAiWorker({
          repository: store.aiRepository,
          budget: store.aiBudgetAuthority,
          priceProfile: profile,
          now: () => new Date('2026-12-01T00:00:00.000Z'),
          gateway: {
            capabilities: () => ({ provider: 'mock' }),
            async complete() {
              calls++;
              throw new Error('合成上游失败');
            }
          }
        });
        await assert.rejects(worker.run(records.job.jobId, request), error => error.code !== 'AI_PRICE_UNAVAILABLE');
        assert.equal(calls, 1);
      });
    }
  },
  {
    name: 'Worker 未知用量按新档案占额，重启保留且日预算与任务上限不退化',
    async run() {
      await withWorkerStore(async (store, records, file) => {
        const worker = createAiWorker({
          repository: store.aiRepository,
          budget: store.aiBudgetAuthority,
          priceProfile: profile,
          now: () => new Date(reviewedAt),
          gateway: {
            capabilities: () => ({ provider: 'mock' }),
            complete: async () =>
              response({
                inputTokens: null,
                outputTokens: null,
                unknown: true
              })
          }
        });
        await worker.run(records.job.jobId, request);
        const usage = store.aiRepository.list('aiUsageRecord')[0];
        assert.equal(usage.priceVersion, priceVersion);
        assert.equal(usage.usageUnknown, true);
        assert.equal(usage.actualMicrounits, null);
        assert.equal(usage.reservedMicrounits, 2172);
        const reopened = createFileDataStore(file);
        const authority = reopened.aiBudgetAuthority;
        const day = beijingDay(new Date(reviewedAt));
        const held = authority.status(accountRef, day);
        assert.equal(held.spentMicrounits, 0);
        assert.equal(held.heldMicrounits, 2172);
        assert.equal(held.availableMicrounits, 20_000_000 - 2172);
        assert.equal(reopened.aiRepository.list('aiUsageRecord')[0].actualMicrounits, null);
        assert.throws(
          () =>
            authority.reserve({
              accountRef,
              day,
              jobId: records.job.jobId,
              attemptId: 'same-job-over-limit',
              priceVersion,
              reservedMicrounits: 2_000_000
            }),
          { code: 'AI_JOB_BUDGET_EXCEEDED' }
        );
        for (let i = 0; authority.status(accountRef, day).availableMicrounits > 0; i++) {
          const available = authority.status(accountRef, day).availableMicrounits;
          authority.reserve({
            accountRef,
            day,
            jobId: `fill-job-${i}`,
            attemptId: `fill-attempt-${i}`,
            priceVersion,
            reservedMicrounits: Math.min(2_000_000, available)
          });
        }
        assert.throws(
          () =>
            authority.reserve({
              accountRef,
              day,
              jobId: 'daily-over-limit',
              attemptId: 'daily-over-limit',
              priceVersion,
              reservedMicrounits: 1
            }),
          { code: 'AI_DAILY_BUDGET_EXCEEDED' }
        );
        assert.equal(createFileDataStore(file).aiBudgetAuthority.status(accountRef, day).heldMicrounits, 20_000_000);
      });
    }
  },
  {
    name: 'Worker 已知用量按 2/8 档结算，超出供应商用量边界仍保守占额',
    async run() {
      for (const exceeded of [false, true])
        await withWorkerStore(async (store, records) => {
          const worker = createAiWorker({
            repository: store.aiRepository,
            budget: store.aiBudgetAuthority,
            priceProfile: profile,
            now: () => new Date(reviewedAt),
            gateway: {
              capabilities: () => ({ provider: 'mock' }),
              complete: async () =>
                response({
                  inputTokens: exceeded ? 100_001 : 10,
                  outputTokens: exceeded ? 0 : 5,
                  unknown: false
                })
            }
          });
          if (exceeded) await assert.rejects(worker.run(records.job.jobId, request), { code: 'AI_USAGE_LIMIT' });
          else await worker.run(records.job.jobId, request);
          const status = store.aiBudgetAuthority.status(accountRef, beijingDay(new Date(reviewedAt)));
          assert.equal(status.spentMicrounits, exceeded ? 0 : 60);
          assert.equal(status.heldMicrounits, exceeded ? 2172 : 0);
          const usage = store.aiRepository.list('aiUsageRecord');
          assert.equal(usage.length, exceeded ? 0 : 1);
          if (!exceeded) {
            assert.equal(usage[0].priceVersion, priceVersion);
            assert.equal(usage[0].actualMicrounits, 60);
          }
        });
    }
  },
  {
    name: '核价版本刷新保留历史未知预留，跨版本仍共享日预算和任务上限',
    async run() {
      await withWorkerStore(async (store, records, file) => {
        const authority = store.aiBudgetAuthority;
        const day = beijingDay(new Date(reviewedAt));
        for (let i = 0; i < 10; i++) {
          authority.reserve({
            accountRef,
            day,
            jobId: `previous-job-${i}`,
            attemptId: `previous-attempt-${i}`,
            priceVersion: 'deepseek-flash-cny-2026-09-27',
            reservedMicrounits: 2_000_000
          });
          authority.settle({ accountRef, attemptId: `previous-attempt-${i}`, disposition: 'unknown' });
        }
        const reopened = createFileDataStore(file);
        const budget = reopened.aiBudgetAuthority;
        assert.equal(budget.status(accountRef, day).availableMicrounits, 0);
        assert.throws(
          () =>
            budget.reserve({
              accountRef,
              day,
              jobId: 'previous-job-0',
              attemptId: 'new-price-retry',
              priceVersion,
              reservedMicrounits: 1
            }),
          { code: 'AI_JOB_BUDGET_EXCEEDED' }
        );
        const worker = createAiWorker({
          repository: reopened.aiRepository,
          budget,
          priceProfile: profile,
          now: () => new Date(reviewedAt),
          gateway: {
            capabilities: () => ({ provider: 'mock' }),
            complete: async () => {
              assert.fail('刷新核价不得绕过旧日预算');
            }
          }
        });
        await assert.rejects(worker.run(records.job.jobId, request), { code: 'AI_DAILY_BUDGET_EXCEEDED' });
        assert.equal(budget.status(accountRef, day).heldMicrounits, 20_000_000);
      });
    }
  },
  {
    name: 'Agent 共用正式核价：超过复核日期仍可执行并正常结算，只记一次提示',
    async run() {
      for (const mode of ['valid', 'stale']) {
        const instant = new Date(mode === 'valid' ? previousCutoff : '2026-12-01T00:00:00.000Z');
        const fixture = agentFixture(() => instant, { inputTokens: 10, outputTokens: 5, unknown: false });
        const conversation = await fixture.store.createConversation({
          ownerId: 'demo',
          actorId: 'demo',
          spaceId: 'space-1'
        });
        const turn = await fixture.store.submitTurn({
          ownerId: 'demo',
          conversationId: conversation.conversationId,
          content: '合成提问',
          idempotencyKey: `price-${mode}`
        });
        await fixture.agent.run(turn.turnId);
        assert.equal(fixture.calls.gateway, 1);
        assert.deepEqual(
          fixture.calls.settlements.map(item => item.disposition),
          ['settled']
        );
        assert.equal(fixture.authority.status(accountRef, beijingDay(instant)).spentMicrounits, 60);
        assert.equal(fixture.state.budgetReservations[0].priceVersion, priceVersion);
        await fixture.agent.close();
      }
    }
  },
  {
    name: 'Agent 未知用量继续占用新档案预留，不能记录为零费用',
    async run() {
      const now = () => new Date(reviewedAt);
      const fixture = agentFixture(now, { inputTokens: null, outputTokens: null, unknown: true });
      const conversation = await fixture.store.createConversation({
        ownerId: 'demo',
        actorId: 'demo',
        spaceId: 'space-1'
      });
      const turn = await fixture.store.submitTurn({
        ownerId: 'demo',
        conversationId: conversation.conversationId,
        content: '合成提问',
        idempotencyKey: 'price-unknown'
      });
      await fixture.agent.run(turn.turnId);
      const reservation = fixture.state.budgetReservations[0];
      assert.equal(reservation.priceVersion, priceVersion);
      assert.equal(reservation.status, 'unknown');
      assert.equal(reservation.actualMicrounits, null);
      assert(reservation.reservedMicrounits > 0);
      const status = fixture.authority.status(accountRef, beijingDay(now()));
      assert.equal(status.heldMicrounits, reservation.reservedMicrounits);
      assert.equal(status.spentMicrounits, 0);
      assert.equal((await fixture.store.listModelAttempts(turn.turnId))[0].status, 'unknown');
      await fixture.agent.close();
    }
  }
];
