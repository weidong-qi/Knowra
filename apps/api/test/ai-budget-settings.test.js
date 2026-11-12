import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  budgetStatus,
  pruneBudgetState,
  reserveBudget,
  settleBudget,
  usageRows,
  usageSummary,
  validateBudgetState
} from '../src/modules/ai/budget-ledger.ts';
import { usageCsv } from '../src/modules/ai/usage-export.ts';
import { createBudgetPolicy } from '../src/modules/ai/budget-policy.ts';
import {
  createBudgetSettingsStore,
  DEFAULT_BUDGET_SETTINGS,
  effectivePriceProfile,
  enforcedLimits,
  normalizeBudgetSettings
} from '../src/modules/ai/budget-settings.ts';
import { actualCostMicrounits } from '../src/modules/ai/worker.js';
import { createBudgetAlertStore, evaluateAlerts } from '../src/modules/ai/budget-alerts.ts';
import { createIsolatedAiWorker } from '../src/modules/ai/isolated-worker.js';
import { createPostgresBudgetAuthority } from '../src/modules/ai/postgres-budget-authority.ts';

const account = 'deepseek-primary';
const reserve = (state, n, amount, extra = {}) =>
  reserveBudget(state, {
    accountRef: account,
    jobId: `job-${extra.job ?? n}`,
    attemptId: `a-${n}`,
    priceVersion: 'p1',
    reservedMicrounits: amount,
    day: extra.day ?? '2026-10-08',
    limits: extra.limits
  });
const base = {
  version: 'base-v1',
  modelId: 'deepseek-flash',
  expiresAt: '2026-10-09T00:00:00.000Z',
  inputMicrounitsPerMillion: 2_000_000,
  outputMicrounitsPerMillion: 8_000_000
};
const settings = (rules = {}, price = null) => ({
  rules: { ...structuredClone(DEFAULT_BUDGET_SETTINGS.rules), ...rules },
  price
});
const temp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'knowra-budget-settings-'));

export const aiBudgetSettingsTests = [
  {
    name: '预算设置：默认等同改造前的规则；非法模式、金额与未知字段被拒，关闭时清空金额',
    run() {
      assert.deepEqual(enforcedLimits(DEFAULT_BUDGET_SETTINGS), { daily: 20_000_000, monthly: null, turn: 2_000_000 });
      const off = normalizeBudgetSettings(settings({ daily: { mode: 'off', limitMicrounits: 5 } }));
      assert.deepEqual(off.rules.daily, { mode: 'off', limitMicrounits: null });
      assert.equal(enforcedLimits(off).daily, null);
      assert.equal(
        enforcedLimits(normalizeBudgetSettings(settings({ daily: { mode: 'warn', limitMicrounits: 5_000_000 } })))
          .daily,
        null,
        '仅提醒不限制预留'
      );
      for (const bad of [
        settings({ daily: { mode: 'kill', limitMicrounits: 1 } }),
        settings({ daily: { mode: 'stop', limitMicrounits: 0 } }),
        settings({ daily: { mode: 'stop', limitMicrounits: 1.5 } }),
        settings({ daily: { mode: 'stop' } }),
        { rules: {}, price: null },
        { ...settings(), extra: 1 },
        settings({}, { inputMicrounitsPerMillion: -1, outputMicrounitsPerMillion: 1 }),
        settings(
          {},
          {
            inputMicrounitsPerMillion: 1_000_000,
            inputCacheHitMicrounitsPerMillion: 2_000_000,
            outputMicrounitsPerMillion: 1
          }
        )
      ]) {
        assert.throws(() => normalizeBudgetSettings(bad), { code: 'AI_BUDGET_SETTINGS_INVALID' });
      }
    }
  },
  {
    name: '账本按设置执行：每日/月/回合上限只在“达到即停”时限制预留；单次请求最坏上限始终保留',
    run() {
      const state = { budgetDays: [], budgetReservations: [] };
      reserve(state, 1, 2_000_000, { limits: { daily: 3_000_000, monthly: null, turn: null } });
      assert.throws(() => reserve(state, 2, 2_000_000, { limits: { daily: 3_000_000, monthly: null, turn: null } }), {
        code: 'AI_DAILY_BUDGET_EXCEEDED'
      });
      // 日上限关闭后可继续超过原 3 元
      reserve(state, 3, 2_000_000, { limits: { daily: null, monthly: null, turn: null } });
      // 回合上限：同一任务多次预留累计
      assert.throws(
        () => reserve(state, 4, 1_500_000, { job: 3, limits: { daily: null, monthly: null, turn: 3_000_000 } }),
        { code: 'AI_JOB_BUDGET_EXCEEDED' }
      );
      reserve(state, 5, 1_500_000, { job: 3, limits: { daily: null, monthly: null, turn: null } });
      // 月上限跨天累计
      assert.throws(
        () =>
          reserve(state, 6, 1_000_000, { day: '2026-10-20', limits: { daily: null, monthly: 6_000_000, turn: null } }),
        { code: 'AI_MONTHLY_BUDGET_EXCEEDED' }
      );
      reserve(state, 7, 1_000_000, { day: '2026-11-01', limits: { daily: null, monthly: 6_000_000, turn: null } });
      assert.throws(() => reserve(state, 8, 2_000_001, { limits: { daily: null, monthly: null, turn: null } }), {
        code: 'AI_BUDGET_REQUEST_INVALID'
      });
      assert.throws(() => reserve(state, 9, 1, { limits: { daily: 0, monthly: null, turn: null } }), {
        code: 'AI_BUDGET_REQUEST_INVALID'
      });
      assert.throws(() => reserve(state, 9, 1, { limits: { daily: 1, extra: 1 } }), {
        code: 'AI_BUDGET_REQUEST_INVALID'
      });
      const status = budgetStatus(state, account, '2026-10-08', { daily: null, monthly: 6_000_000, turn: null });
      assert.equal(status.limitMicrounits, null);
      assert.equal(status.availableMicrounits, null);
      assert.equal(status.monthSpentMicrounits + status.monthHeldMicrounits, 5_500_000);
      assert.equal(status.monthAvailableMicrounits, 500_000);
      assert.equal(budgetStatus(state, account, '2026-10-08').limitMicrounits, 20_000_000, '未传 limits 沿用默认');
    }
  },
  {
    name: '自定义单价叠加在档案上：版本带 +custom，命中价按命中 token 结算，实际费用不超过按未命中价的预留',
    run() {
      const custom = {
        inputMicrounitsPerMillion: 1_000_000,
        inputCacheHitMicrounitsPerMillion: 100_000,
        outputMicrounitsPerMillion: 4_000_000,
        updatedAt: '2026-10-08T00:00:00.000Z'
      };
      const profile = effectivePriceProfile(base, custom);
      assert.equal(profile.version, 'base-v1+custom');
      assert.equal(profile.modelId, 'deepseek-flash');
      assert.equal(effectivePriceProfile(base, null), base);
      // 1000 输入（600 命中）、50 输出：400*1 + 600*0.1 + 50*4 = 660 微元
      assert.equal(actualCostMicrounits({ inputTokens: 1000, outputTokens: 50, cacheHitTokens: 600 }, profile), 660);
      assert.equal(
        actualCostMicrounits({ inputTokens: 1000, outputTokens: 50, cacheHitTokens: null }, profile),
        1000 + 200,
        '命中数未知按未命中价'
      );
      assert.equal(
        actualCostMicrounits({ inputTokens: 1000, outputTokens: 50, cacheHitTokens: 600 }, base),
        2000 + 400,
        '无命中价的档案不分命中'
      );
    }
  },
  {
    name: '设置存储：缺失用默认；保存后读回；损坏或越界时拒绝而不是回到默认；文件 0600',
    async run() {
      const dir = temp();
      try {
        const file = path.join(dir, 'ai-budget-settings.json');
        const store = createBudgetSettingsStore({ filePath: file, now: () => new Date('2026-10-08T01:00:00.000Z') });
        assert.deepEqual(await store.get(), DEFAULT_BUDGET_SETTINGS);
        const saved = await store.set(
          settings(
            { monthly: { mode: 'warn', limitMicrounits: 100_000_000 } },
            { inputMicrounitsPerMillion: 1_000_000, outputMicrounitsPerMillion: 2_000_000 }
          )
        );
        assert.equal(saved.price.updatedAt, '2026-10-08T01:00:00.000Z');
        assert.deepEqual(await store.get(), saved);
        assert.equal(fs.statSync(file).mode & 0o777, 0o600);
        await assert.rejects(store.set({ rules: {} }), { code: 'AI_BUDGET_SETTINGS_INVALID' });
        assert.deepEqual(await store.get(), saved, '无效保存不改动原设置');
        fs.writeFileSync(file, '{"rules":{"daily":{"mode":"stop","limitMicrounits":-5}}}');
        await assert.rejects(store.get(), { code: 'AI_BUDGET_SETTINGS_INVALID' });
        assert.match(fs.readFileSync(file, 'utf8'), /-5/, '原文件保留');
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    }
  },
  {
    name: '余额下限为“达到即停”时：低于下限拒绝；读不到余额且无新快照拒绝；仅提醒不拦截',
    async run() {
      const dir = temp();
      try {
        const store = createBudgetSettingsStore({ filePath: path.join(dir, 's.json') });
        let clock = Date.parse('2026-10-08T00:00:00.000Z');
        const view = (total, at) => ({
          checkedAt: at,
          latest: {
            at,
            isAvailable: true,
            balances: [{ currency: 'CNY', totalMicrounits: total, grantedMicrounits: 0, toppedUpMicrounits: total }]
          }
        });
        let live = view(50_000_000, new Date(clock).toISOString());
        let refreshError = null;
        const balance = {
          view: async () => live,
          refresh: async () => {
            if (refreshError) throw refreshError;
            return live;
          }
        };
        const policy = createBudgetPolicy({
          settings: store,
          balance,
          basePriceProfile: base,
          now: () => new Date(clock)
        });
        await policy.snapshot(); // 默认下限关闭
        await store.set(settings({ balanceFloor: { mode: 'stop', limitMicrounits: 10_000_000 } }));
        assert.equal((await policy.snapshot()).limits.daily, 20_000_000);
        live = view(9_000_000, new Date(clock).toISOString());
        await assert.rejects(policy.snapshot(), { code: 'AI_BALANCE_BELOW_FLOOR' });
        assert.equal(await policy.balanceBelowFloor(await store.get()), true);
        clock += 10 * 60_000;
        refreshError = new Error('offline');
        live = view(50_000_000, new Date(clock - 10 * 60_000).toISOString());
        assert.equal(
          (await policy.snapshot()).settings.rules.balanceFloor.mode,
          'stop',
          '快照一小时内且读不到新余额时凭旧快照放行'
        );
        clock += 2 * 3600_000;
        await assert.rejects(policy.snapshot(), { code: 'AI_BALANCE_FLOOR_UNVERIFIED' });
        await store.set(settings({ balanceFloor: { mode: 'warn', limitMicrounits: 10_000_000 } }));
        await policy.snapshot();
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    }
  },
  {
    name: '预算快照随自定义单价变化，设置损坏时整体拒绝付费调用',
    async run() {
      const dir = temp();
      try {
        const file = path.join(dir, 's.json');
        const store = createBudgetSettingsStore({ filePath: file });
        const policy = createBudgetPolicy({ settings: store, basePriceProfile: base });
        assert.equal((await policy.snapshot()).profile, base);
        await store.set(settings({}, { inputMicrounitsPerMillion: 1_000_000, outputMicrounitsPerMillion: 2_000_000 }));
        assert.equal((await policy.snapshot()).profile.version, 'base-v1+custom');
        fs.writeFileSync(file, 'not json');
        await assert.rejects(policy.snapshot(), { code: 'AI_BUDGET_SETTINGS_INVALID' });
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    }
  },
  {
    name: '提醒阈值：默认 50/80/100，去重排序，非法值被拒；旧设置缺省阈值时用默认',
    run() {
      assert.deepEqual(normalizeBudgetSettings(settings()).alerts.thresholds, [50, 80, 100]);
      assert.deepEqual(
        normalizeBudgetSettings({ ...settings(), alerts: { thresholds: [90, 30, 90] } }).alerts.thresholds,
        [30, 90]
      );
      for (const bad of [[0], [101], [1.5], ['50'], [1, 2, 3, 4, 5, 6, 7], 'x']) {
        assert.throws(() => normalizeBudgetSettings({ ...settings(), alerts: { thresholds: bad } }), {
          code: 'AI_BUDGET_SETTINGS_INVALID'
        });
      }
      assert.throws(() => normalizeBudgetSettings({ ...settings(), alerts: { thresholds: [50], extra: 1 } }), {
        code: 'AI_BUDGET_SETTINGS_INVALID'
      });
    }
  },
  {
    name: '提醒评估：只看每日/每月且规则未关闭，已用含占用的预留，整数比较；每个周期每个阈值一个标识',
    run() {
      const cfg = normalizeBudgetSettings(
        settings({
          daily: { mode: 'warn', limitMicrounits: 10_000_000 },
          monthly: { mode: 'stop', limitMicrounits: 100_000_000 }
        })
      );
      const status = {
        spentMicrounits: 4_000_000,
        heldMicrounits: 1_000_000,
        monthSpentMicrounits: 79_000_000,
        monthHeldMicrounits: 0
      };
      const result = evaluateAlerts({ settings: cfg, status, day: '2026-10-08' });
      assert.deepEqual(
        result.alerts.map(item => item.id),
        ['daily:2026-10-08:50', 'monthly:2026-10:50']
      );
      const hundred = evaluateAlerts({
        settings: cfg,
        status: { ...status, spentMicrounits: 10_000_000, heldMicrounits: 0 },
        day: '2026-10-08'
      });
      assert.deepEqual(
        hundred.alerts.filter(item => item.rule === 'daily').map(item => item.threshold),
        [50, 80, 100]
      );
      const off = normalizeBudgetSettings(settings({ daily: { mode: 'off', limitMicrounits: null } }));
      assert.equal(
        evaluateAlerts({ settings: off, status, day: '2026-10-08' }).alerts.some(item => item.rule === 'daily'),
        false
      );
    }
  },
  {
    name: '提醒状态：标记通知/关闭只记一次，放行只在当月/当日有效，无效输入被拒，损坏文件按无记录处理',
    async run() {
      const dir = temp();
      try {
        const file = path.join(dir, 'a.json');
        const store = createBudgetAlertStore({ filePath: file });
        await store.mark(['daily:2026-10-08:80'], 'notified', '2026-10-08');
        await store.mark(['daily:2026-10-08:80'], 'dismissed', '2026-10-08');
        assert.deepEqual((await store.get()).marks['daily:2026-10-08:80'], { notified: true, dismissed: true });
        for (const bad of [[], ['x'], ['daily:2026-10-08:80'], Array(25).fill('daily:2026-10-08:80')]) {
          if (Array.isArray(bad) && bad.length === 1 && bad[0] === 'daily:2026-10-08:80')
            await assert.rejects(store.mark(bad, 'seen', '2026-10-08'), { code: 'AI_BUDGET_ALERT_INVALID' });
          else await assert.rejects(store.mark(bad, 'notified', '2026-10-08'), { code: 'AI_BUDGET_ALERT_INVALID' });
        }
        await assert.rejects(store.allow('daily', '2026-10-07', '2026-10-08'), { code: 'AI_BUDGET_ALERT_INVALID' });
        await assert.rejects(store.allow('turn', '2026-10-08', '2026-10-08'), { code: 'AI_BUDGET_ALERT_INVALID' });
        await store.allow('monthly', '2026-10', '2026-10-08');
        const cfg = normalizeBudgetSettings(settings());
        const status = { spentMicrounits: 0, heldMicrounits: 0, monthSpentMicrounits: 0, monthHeldMicrounits: 0 };
        assert.deepEqual(
          evaluateAlerts({ settings: cfg, status, overrides: (await store.get()).overrides, day: '2026-10-20' })
            .overrides,
          [{ rule: 'monthly', period: '2026-10' }]
        );
        assert.deepEqual(
          evaluateAlerts({ settings: cfg, status, overrides: (await store.get()).overrides, day: '2026-11-01' })
            .overrides,
          [],
          '下个月放行自动失效'
        );
        fs.writeFileSync(file, 'garbage');
        assert.deepEqual(
          await store.get(),
          { marks: {}, overrides: {}, pauses: {}, invalid: true },
          '损坏必须被识别，不能当作没有记录'
        );
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    }
  },
  {
    name: '放行让“达到即停”的规则在当前周期内不再限制预留，周期之外不影响',
    async run() {
      const dir = temp();
      try {
        const settingsStore = createBudgetSettingsStore({ filePath: path.join(dir, 's.json') });
        const alerts = createBudgetAlertStore({ filePath: path.join(dir, 'a.json') });
        let clock = Date.parse('2026-10-08T04:00:00.000Z');
        const policy = createBudgetPolicy({
          settings: settingsStore,
          alerts,
          basePriceProfile: base,
          now: () => new Date(clock)
        });
        assert.equal((await policy.snapshot()).limits.daily, 20_000_000);
        await alerts.allow('daily', '2026-10-08', '2026-10-08');
        assert.equal((await policy.snapshot()).limits.daily, null);
        assert.equal((await policy.view()).limits.turn, 2_000_000, '单次回合上限不受放行影响');
        clock += 24 * 3600_000;
        assert.equal((await policy.snapshot()).limits.daily, 20_000_000, '第二天恢复拦截');
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    }
  },
  {
    name: '明细保留 90 天：更早已结算的折叠为月汇总且累计不变；未知请求永不裁剪；基准取今天与账本最新日的较早者',
    run() {
      const state = { budgetDays: [], budgetReservations: [], budgetMonths: [] };
      const call = (n, day, disposition, actual, usage) => {
        reserve(state, n, 1_000_000, { day });
        settleBudget(state, { accountRef: account, attemptId: `a-${n}`, disposition, actualMicrounits: actual, usage });
      };
      call(1, '2026-05-02', 'settled', 300_000, {
        modelId: 'deepseek-flash',
        inputTokens: 100,
        outputTokens: 10,
        cacheHitTokens: 40
      });
      call(2, '2026-05-20', 'settled', 200_000, { inputTokens: 50, outputTokens: 5 });
      call(3, '2026-05-21', 'unknown', null, { modelId: 'deepseek-flash' });
      call(4, '2026-06-01', 'released', null);
      call(5, '2026-09-30', 'settled', 400_000);
      call(6, '2026-10-08', 'settled', 100_000);
      const before = usageSummary(state, account, '2026-10-08');
      // 时钟被误调到很远的未来：基准取账本最新日，不会把 90 天内的明细折叠掉。
      assert.equal(
        pruneBudgetState(structuredClone(state), account, '2030-01-01'),
        2,
        '基准是账本最新日 2026-10-08，只折叠 5 月的两条'
      );
      assert.equal(
        pruneBudgetState(structuredClone(state), account, '2026-06-10'),
        0,
        '今天比账本最新日更早时以今天为基准，五月数据仍在 90 天内'
      );
      const folded = pruneBudgetState(state, account, '2026-10-08');
      assert.equal(folded, 2);
      validateBudgetState(state);
      assert.deepEqual(state.budgetMonths, [
        {
          accountRef: account,
          month: '2026-05',
          requests: 2,
          spentMicrounits: 500_000,
          inputTokens: 150,
          outputTokens: 15,
          cacheHitTokens: 40
        }
      ]);
      assert.equal(
        state.budgetReservations.some(row => row.attemptId === 'a-3'),
        true,
        '结果未知的请求保留'
      );
      assert.equal(
        state.budgetReservations.some(row => row.attemptId === 'a-4'),
        false,
        '已释放的早期请求直接丢弃'
      );
      assert.equal(
        state.budgetDays.find(row => row.day === '2026-05-02').archivedSpentMicrounits,
        300_000,
        '日账本保留，折叠的金额记在 archivedSpentMicrounits'
      );
      assert.equal(budgetStatus(state, account, '2026-05-02').spentMicrounits, 300_000, '折叠不改变某一天的已花费');
      assert.equal(
        state.budgetDays.some(row => row.day === '2026-05-21'),
        true,
        '仍有未知预留的日账本保留'
      );
      const after = usageSummary(state, account, '2026-10-08');
      assert.equal(after.total.spentMicrounits, before.total.spentMicrounits, '折叠不改变累计费用');
      assert.equal(after.total.requests, before.total.requests);
      assert.equal(after.total.inputTokens, before.total.inputTokens);
      assert.equal(after.unknown.length, 1);
      assert.deepEqual(after.archive, [{ month: '2026-05', requests: 2, spentMicrounits: 500_000 }]);
      assert.equal(pruneBudgetState(state, account, '2026-10-08'), 0, '重复裁剪无变化');
    }
  },
  {
    name: '手动处理未知请求：释放后不再占用额度，按金额结算计入花费，已处理的不能再改；超过预留额被拒',
    run() {
      const state = { budgetDays: [], budgetReservations: [] };
      for (const n of [1, 2, 3]) {
        reserve(state, n, 1_000_000);
        settleBudget(state, { accountRef: account, attemptId: `a-${n}`, disposition: 'unknown' });
      }
      assert.equal(budgetStatus(state, account, '2026-10-08').heldMicrounits, 3_000_000);
      settleBudget(state, { accountRef: account, attemptId: 'a-1', disposition: 'released' });
      settleBudget(state, { accountRef: account, attemptId: 'a-2', disposition: 'settled', actualMicrounits: 250_000 });
      assert.throws(
        () =>
          settleBudget(state, {
            accountRef: account,
            attemptId: 'a-3',
            disposition: 'settled',
            actualMicrounits: 1_000_001
          }),
        { code: 'AI_BUDGET_SETTLEMENT_INVALID' }
      );
      const status = budgetStatus(state, account, '2026-10-08');
      assert.deepEqual([status.heldMicrounits, status.spentMicrounits], [1_000_000, 250_000]);
      assert.throws(() => settleBudget(state, { accountRef: account, attemptId: 'a-2', disposition: 'released' }), {
        code: 'AI_BUDGET_CONFLICT'
      });
      validateBudgetState(state);
    }
  },
  {
    name: 'CSV 导出：含 BOM 与表头，只含数字和 ID；以公式符号开头的值加前缀；月汇总行附在末尾',
    run() {
      const state = {
        budgetDays: [],
        budgetReservations: [],
        budgetMonths: [
          {
            accountRef: account,
            month: '2026-05',
            requests: 2,
            spentMicrounits: 500_000,
            inputTokens: 150,
            outputTokens: 15,
            cacheHitTokens: 40
          }
        ]
      };
      reserve(state, 1, 1_000_000);
      settleBudget(state, {
        accountRef: account,
        attemptId: 'a-1',
        disposition: 'settled',
        actualMicrounits: 123_456,
        usage: {
          modelId: 'deepseek-flash',
          inputTokens: 10,
          outputTokens: 2,
          cacheHitTokens: 4,
          conversationId: '-evil'
        }
      });
      reserve(state, 2, 1_000_000);
      settleBudget(state, { accountRef: account, attemptId: 'a-2', disposition: 'unknown' });
      const csv = usageCsv(usageRows(state, account));
      assert.equal(csv.charCodeAt(0), 0xfeff);
      const lines = csv.slice(1).trimEnd().split('\r\n');
      assert.equal(lines.length, 4);
      assert.match(lines[0], /^时间,北京日期,状态,模型/);
      assert.match(lines[1], /,已结算,deepseek-flash,10,2,4,0\.123456,'-evil,/);
      assert.match(lines[2], /结果未知\(按预留占用\)/);
      assert.match(lines[2], /1\.000000/);
      assert.match(lines[3], /^2026-05 月汇总\(明细已折叠\),2026-05,2 次请求,,150,15,40,0\.500000/);
    }
  },
  {
    name: '已有损坏的用量明细：折叠进月汇总与 CSV 导出前同样清洗，不产生 NaN 或字符串拼接',
    run() {
      const state = { budgetDays: [], budgetReservations: [], budgetMonths: [] };
      for (const [n, day] of [
        [1, '2026-05-02'],
        [3, '2026-10-07'],
        [2, '2026-10-08']
      ]) {
        // 10-07 与 10-08 连续，时间推进可信
        reserve(state, n, 1_000_000, { day });
        settleBudget(state, {
          accountRef: account,
          attemptId: `a-${n}`,
          disposition: 'settled',
          actualMicrounits: 1000,
          usage: { inputTokens: 10, outputTokens: 1 }
        });
      }
      state.budgetReservations[0].usage = { inputTokens: '10', outputTokens: { x: 1 }, cacheHitTokens: -1 };
      state.budgetReservations[1].usage = { inputTokens: 'x', modelId: 7 };
      assert.equal(pruneBudgetState(state, account, '2026-10-08'), 1);
      assert.deepEqual(
        [state.budgetMonths[0].inputTokens, state.budgetMonths[0].outputTokens, state.budgetMonths[0].cacheHitTokens],
        [0, 0, 0]
      );
      const csv = usageCsv(usageRows(state, account));
      assert.equal(/NaN|undefined|\[object/.test(csv), false);
      validateBudgetState(state);
    }
  },
  {
    name: '余额下限状态判断只凭新鲜快照：过期的低余额快照不封锁助手，调用前检查才联网刷新',
    async run() {
      const dir = temp();
      try {
        const store = createBudgetSettingsStore({ filePath: path.join(dir, 's.json') });
        await store.set(settings({ balanceFloor: { mode: 'stop', limitMicrounits: 10_000_000 } }));
        let clock = Date.parse('2026-10-08T05:00:00.000Z');
        const at = ms => new Date(clock - ms).toISOString();
        const view = (total, checkedAt) => ({
          checkedAt,
          latest: {
            at: checkedAt,
            isAvailable: true,
            balances: [{ currency: 'CNY', totalMicrounits: total, grantedMicrounits: 0, toppedUpMicrounits: total }]
          }
        });
        let live = view(9_000_000, at(2 * 3600_000)); // 两小时前的低余额，其后用户可能已充值
        let refreshed = 0;
        const balance = {
          view: async () => live,
          refresh: async () => {
            refreshed += 1;
            live = view(50_000_000, at(0));
            return live;
          }
        };
        const policy = createBudgetPolicy({
          settings: store,
          balance,
          basePriceProfile: base,
          now: () => new Date(clock)
        });
        const current = await store.get();
        assert.equal(await policy.balanceBelowFloor(current), false, '过期快照不作为封锁依据');
        await policy.snapshot(); // 调用前检查联网刷新到 ¥50，放行
        assert.equal(refreshed, 1);
        live = view(9_000_000, at(60_000));
        assert.equal(await policy.balanceBelowFloor(current), true, '新鲜的低余额快照仍如实提示');
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    }
  },
  {
    name: '执行器在等待预算策略期间被关闭：不再启动任务进程',
    async run() {
      let release;
      const gate = new Promise(resolve => {
        release = resolve;
      });
      let spawned = 0;
      const worker = createIsolatedAiWorker({
        repository: {},
        budget: {},
        gateway: {},
        modelSettings: {},
        readContext: null,
        priceProfile: base,
        allowExternal: true,
        policy: {
          snapshot: async () => {
            await gate;
            return { profile: base, limits: { daily: 1, monthly: null, turn: null } };
          }
        },
        spawn: () => {
          spawned += 1;
          throw new Error('must not spawn');
        }
      });
      const running = worker.run('job-1', { mode: 'hang' });
      await new Promise(resolve => setTimeout(resolve, 10));
      await worker.close();
      release();
      await assert.rejects(running, { code: 'AI_GENERATION_UNAVAILABLE' });
      assert.equal(spawned, 0);
    }
  },
  {
    name: '暂停只在当前周期有效且不改写设置：暂停后付费调用被拒，放行或恢复可解除，次日自动恢复',
    async run() {
      const dir = temp();
      try {
        const settingsStore = createBudgetSettingsStore({ filePath: path.join(dir, 's.json') });
        const alerts = createBudgetAlertStore({ filePath: path.join(dir, 'a.json') });
        let clock = Date.parse('2026-10-08T04:00:00.000Z');
        const policy = createBudgetPolicy({
          settings: settingsStore,
          alerts,
          basePriceProfile: base,
          now: () => new Date(clock)
        });
        const before = JSON.stringify(await settingsStore.get());
        await policy.snapshot();
        await alerts.pause('daily', '2026-10-08', '2026-10-08');
        await assert.rejects(policy.snapshot(), { code: 'AI_PAUSED_BY_USER' });
        assert.deepEqual((await policy.view()).paused, ['daily']);
        assert.equal(JSON.stringify(await settingsStore.get()), before, '暂停不改写预算设置');
        await assert.rejects(alerts.pause('daily', '2026-10-07', '2026-10-08'), { code: 'AI_BUDGET_ALERT_INVALID' });
        await alerts.resume('daily', '2026-10-08', '2026-10-08');
        await policy.snapshot();
        await alerts.pause('daily', '2026-10-08', '2026-10-08');
        await alerts.allow('daily', '2026-10-08', '2026-10-08'); // 放行同时解除暂停
        assert.equal((await policy.snapshot()).limits.daily, null);
        await alerts.pause('daily', '2026-10-08', '2026-10-08'); // 再次暂停会取消放行
        assert.deepEqual((await alerts.get()).overrides, {});
        clock += 24 * 3600_000;
        await policy.snapshot(); // 第二天自动恢复
        const status = { spentMicrounits: 0, heldMicrounits: 0, monthSpentMicrounits: 0, monthHeldMicrounits: 0 };
        assert.deepEqual(
          evaluateAlerts({
            settings: normalizeBudgetSettings(settings()),
            status,
            pauses: { daily: '2026-10-08' },
            day: '2026-10-08'
          }).pauses,
          [{ rule: 'daily', period: '2026-10-08' }]
        );
        assert.deepEqual(
          evaluateAlerts({
            settings: normalizeBudgetSettings(settings()),
            status,
            pauses: { daily: '2026-10-08' },
            day: '2026-10-09'
          }).pauses,
          []
        );
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    }
  },
  {
    name: '暂停状态文件损坏时 fail closed：不能被当作“没有暂停”，只有显式重置才恢复；旧版文件缺 pauses 仍有效',
    async run() {
      const dir = temp();
      try {
        const file = path.join(dir, 'a.json');
        const settingsStore = createBudgetSettingsStore({ filePath: path.join(dir, 's.json') });
        const alerts = createBudgetAlertStore({ filePath: file });
        const policy = createBudgetPolicy({
          settings: settingsStore,
          alerts,
          basePriceProfile: base,
          now: () => new Date('2026-10-08T04:00:00.000Z')
        });
        assert.equal((await alerts.get()).invalid, false, '文件不存在是正常的空状态');
        fs.writeFileSync(file, JSON.stringify({ marks: {}, overrides: {} })); // 旧版本没有 pauses 字段
        assert.equal((await alerts.get()).invalid, false);
        await policy.snapshot();
        for (const bad of [
          '{not json',
          '{"marks":{},"overrides":{},"pauses":null}',
          '{"pauses":{"daily":5}}',
          '{"overrides":[]}',
          '[]',
          'null',
          '{"marks":{"a":1}}'
        ]) {
          fs.writeFileSync(file, bad);
          assert.equal((await alerts.get()).invalid, true, bad);
          await assert.rejects(policy.snapshot(), { code: 'AI_BUDGET_ALERTS_INVALID' }, `${bad} 时付费调用被拒`);
          await assert.rejects(
            alerts.mark(['daily:2026-10-08:50'], 'dismissed', '2026-10-08'),
            { code: 'AI_BUDGET_ALERTS_INVALID' },
            '不能借关闭横幅覆盖损坏的文件'
          );
          assert.equal(fs.readFileSync(file, 'utf8'), bad, '拒绝时保留原文件');
        }
        fs.writeFileSync(file, '{"pauses":{"daily":"2026-10-08"}}');
        await assert.rejects(policy.snapshot(), { code: 'AI_PAUSED_BY_USER' });
        fs.writeFileSync(file, '{not json');
        await alerts.resume('daily', '2026-10-08', '2026-10-08'); // 显式重置
        assert.equal((await alerts.get()).invalid, false);
        await policy.snapshot();
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    }
  },
  {
    name: '规则拦截状态独立于提醒阈值：阈值不含 100% 或为空时，用量达到“达到即停”的上限仍标记为已拦截；仅提醒、关闭、已放行不算拦截',
    run() {
      const rulesOf = (config, status, extra = {}) =>
        evaluateAlerts({ settings: normalizeBudgetSettings(config), status, day: '2026-10-08', ...extra });
      const full = {
        spentMicrounits: 20_000_000,
        heldMicrounits: 0,
        monthSpentMicrounits: 30_000_000,
        monthHeldMicrounits: 0
      };
      const only80 = {
        ...settings({ monthly: { mode: 'stop', limitMicrounits: 100_000_000 } }),
        alerts: { thresholds: [80] }
      };
      const a = rulesOf(only80, full);
      assert.deepEqual(
        a.alerts.map(item => item.threshold),
        [80],
        '提醒只有 80%'
      );
      assert.deepEqual(
        a.rules.map(item => [item.rule, item.blocked, item.usedMicrounits, item.limitMicrounits]),
        [
          ['daily', true, 20_000_000, 20_000_000],
          ['monthly', false, 30_000_000, 100_000_000]
        ]
      );
      assert.equal(
        rulesOf({ ...settings(), alerts: { thresholds: [] } }, full).rules[0].blocked,
        true,
        '阈值为空也如实显示已拦截'
      );
      assert.equal(
        rulesOf(settings({ daily: { mode: 'warn', limitMicrounits: 20_000_000 } }), full).rules.find(
          item => item.rule === 'daily'
        ).blocked,
        false,
        '仅提醒不拦截'
      );
      assert.equal(
        rulesOf(settings({ daily: { mode: 'off', limitMicrounits: null } }), full).rules.some(
          item => item.rule === 'daily'
        ),
        false,
        '关闭的规则不出现'
      );
      assert.equal(
        rulesOf(settings(), full, { overrides: { daily: '2026-10-08' } }).rules[0].blocked,
        false,
        '当日已放行'
      );
      assert.equal(
        rulesOf(settings(), full, { overrides: { daily: '2026-10-07' } }).rules[0].blocked,
        true,
        '昨天的放行不算数'
      );
      assert.equal(rulesOf(settings(), { ...full, spentMicrounits: 19_999_999 }).rules[0].blocked, false);
    }
  },
  {
    name: '时钟跳到未来后结算：不立即折叠近期明细；月汇总金额仍计入预算统计；时间持续推进后才折叠',
    run() {
      const state = { budgetDays: [], budgetReservations: [], budgetMonths: [] };
      const call = (n, day, actual) => {
        reserve(state, n, 1_000_000, { day });
        settleBudget(state, {
          accountRef: account,
          attemptId: `a-${n}`,
          disposition: 'settled',
          actualMicrounits: actual
        });
      };
      call(1, '2026-10-07', 300_000);
      call(2, '2026-10-08', 200_000);
      // 系统时钟被误调到 2030 年，随后发生了一次结算。
      call(3, '2030-01-01', 10);
      assert.equal(
        pruneBudgetState(state, account, '2030-01-01'),
        0,
        '最新日比此前最新日晚出 90 天以上：疑似时钟异常，不裁剪'
      );
      assert.equal(state.budgetReservations.length, 3);
      call(4, '2030-01-01', 10);
      assert.equal(pruneBudgetState(state, account, '2030-01-01'), 0, '同一异常日内再次结算仍不裁剪');
      // 时钟恢复正确：基准取今天，同样不裁剪，预算统计保持。
      assert.equal(pruneBudgetState(state, account, '2026-10-09'), 0);
      assert.equal(budgetStatus(state, account, '2026-10-08').monthSpentMicrounits, 500_000);
      // 时间确实持续推进（出现更晚的日期）后才折叠：只丢请求明细，日账本与月汇总金额都在。
      call(5, '2030-01-02', 10);
      assert.equal(pruneBudgetState(state, account, '2030-01-02'), 2);
      validateBudgetState(state);
      assert.equal(state.budgetMonths.find(row => row.month === '2026-10').spentMicrounits, 500_000);
      assert.equal(
        budgetStatus(state, account, '2026-10-20', { daily: null, monthly: 1_000_000, turn: null })
          .monthSpentMicrounits,
        500_000,
        '折叠后当月预算统计不变（也不重复计入）'
      );
      assert.throws(
        () =>
          reserve(state, 6, 600_000, { day: '2026-10-20', limits: { daily: null, monthly: 1_000_000, turn: null } }),
        { code: 'AI_MONTHLY_BUDGET_EXCEEDED' }
      );
      assert.equal(usageSummary(state, account, '2026-10-20').month.spentMicrounits, 500_000, '用量汇总与预算统计一致');
      // 复审场景：连续两个错误日期绕过了跳变保护、近期明细被折叠；时钟恢复后当日已花费仍然准确，日上限不会被突破。
      assert.equal(
        budgetStatus(state, account, '2026-10-08').spentMicrounits,
        200_000,
        '恢复时钟后某天的已花费仍是 ¥0.20，而不是 0'
      );
      assert.throws(
        () => reserve(state, 7, 200_000, { day: '2026-10-08', limits: { daily: 300_000, monthly: null, turn: null } }),
        { code: 'AI_DAILY_BUDGET_EXCEEDED' }
      );
      assert.equal(
        usageSummary(state, account, '2026-10-08').today.spentMicrounits,
        200_000,
        '今日用量汇总同样包含已折叠的金额'
      );
    }
  },
  {
    name: '月汇总损坏不会被静默清空：显式 null 或非数组报错，只有字段缺失（旧账本）才补空',
    run() {
      for (const bad of [null, {}, 'x', 0]) {
        assert.throws(
          () => validateBudgetState({ budgetDays: [], budgetReservations: [], budgetMonths: bad }),
          { code: 'AI_BUDGET_INVALID' },
          String(bad)
        );
      }
      assert.throws(() => validateBudgetState({ budgetDays: null, budgetReservations: [], budgetMonths: [] }), {
        code: 'AI_BUDGET_INVALID'
      });
      const legacy = validateBudgetState({ budgetDays: [], budgetReservations: [] });
      assert.deepEqual(legacy.budgetMonths, []);
      assert.throws(
        () =>
          validateBudgetState({
            budgetDays: [],
            budgetReservations: [],
            budgetMonths: [
              {
                accountRef: account,
                month: '2026-05',
                requests: 1,
                spentMicrounits: -1,
                inputTokens: 0,
                outputTokens: 0,
                cacheHitTokens: 0
              }
            ]
          }),
        { code: 'AI_BUDGET_INVALID' }
      );
    }
  },
  {
    name: '等待余额刷新期间用户点了暂停：这次调用不能继续；发送前最后复核同样拦截',
    async run() {
      const dir = temp();
      try {
        const settingsStore = createBudgetSettingsStore({ filePath: path.join(dir, 's.json') });
        await settingsStore.set(settings({ balanceFloor: { mode: 'stop', limitMicrounits: 10_000_000 } }));
        const alerts = createBudgetAlertStore({ filePath: path.join(dir, 'a.json') });
        let release;
        const gate = new Promise(resolve => {
          release = resolve;
        });
        const stale = new Date('2026-10-08T01:00:00.000Z').toISOString();
        const fresh = {
          checkedAt: '2026-10-08T05:00:00.000Z',
          latest: {
            at: '2026-10-08T05:00:00.000Z',
            isAvailable: true,
            balances: [
              { currency: 'CNY', totalMicrounits: 50_000_000, grantedMicrounits: 0, toppedUpMicrounits: 50_000_000 }
            ]
          }
        };
        const balance = {
          view: async () => ({ checkedAt: stale, latest: null }),
          refresh: async () => {
            await gate;
            return fresh;
          }
        };
        const policy = createBudgetPolicy({
          settings: settingsStore,
          alerts,
          balance,
          basePriceProfile: base,
          now: () => new Date('2026-10-08T05:00:00.000Z')
        });
        const waiting = policy.snapshot(); // 余额过期，正在联网刷新
        await new Promise(resolve => setTimeout(resolve, 10));
        await alerts.pause('daily', '2026-10-08', '2026-10-08'); // 等待期间用户暂停
        release();
        await assert.rejects(waiting, { code: 'AI_PAUSED_BY_USER' }, '等待结束后必须重新读取暂停状态');
        await alerts.resume('daily', '2026-10-08', '2026-10-08');
        await policy.assertRunnable();
        await alerts.pause('daily', '2026-10-08', '2026-10-08');
        await assert.rejects(policy.assertRunnable(), { code: 'AI_PAUSED_BY_USER' });
        fs.writeFileSync(path.join(dir, 'a.json'), '{bad');
        await assert.rejects(policy.assertRunnable(), { code: 'AI_BUDGET_ALERTS_INVALID' });
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    }
  },
  {
    name: 'PostgreSQL 适配器的用量汇总、导出与状态在只给预留记录时可用（不依赖日账本或月汇总），损坏的明细按未记录处理',
    async run() {
      // 假的 Prisma 客户端：按 SQL 里的表名返回列名与真实表一致的行；真实数据库测试需要 KNOWRA_SYNC_TEST_DATABASE_URL。
      const reservation = (n, status, actual, usage) => ({
        reservation_id: `r-${n}`,
        account_ref: account,
        beijing_day: '2026-10-08',
        job_id: `job-${n}`,
        attempt_id: `a-${n}`,
        price_version: 'p1',
        reserved_microunits: 1_000_000n,
        actual_microunits: actual === null ? null : BigInt(actual),
        status,
        created_at: `2026-10-08T0${n}:00:00.000Z`,
        settled_at: `2026-10-08T0${n}:00:01.000Z`,
        usage_detail: usage
      });
      const rows = [
        reservation(
          1,
          'settled',
          300_000,
          JSON.stringify({
            modelId: 'deepseek-flash',
            inputTokens: 100,
            outputTokens: 10,
            cacheHitTokens: 40,
            conversationId: '会话/已导入'
          })
        ),
        reservation(2, 'unknown', null, '{损坏'),
        reservation(3, 'settled', 100_000, null)
      ];
      const client = {
        $transaction: async () => {
          throw new Error('unused');
        },
        $queryRawUnsafe: async sql =>
          sql.includes('ai_budget_reservations')
            ? rows
            : [{ beijing_day: '2026-10-08', spent_microunits: 400_000n, held_microunits: 1_000_000n }]
      };
      const authority = createPostgresBudgetAuthority(client);
      const summary = await authority.usage(account, '2026-10-08');
      assert.deepEqual(
        [
          summary.today.requests,
          summary.today.spentMicrounits,
          summary.today.unknownRequests,
          summary.total.inputTokens,
          summary.total.cacheHitTokens
        ],
        [3, 400_000, 1, 100, 40]
      );
      assert.deepEqual(summary.archive, []);
      assert.equal(summary.recent.find(row => row.attemptId === 'a-1').conversationId, '会话/已导入');
      assert.equal(summary.recent.find(row => row.attemptId === 'a-2').modelId, null, '损坏的明细按未记录处理');
      assert.deepEqual(
        summary.unknown.map(row => row.attemptId),
        ['a-2']
      );
      const exported = await authority.usageRows(account);
      assert.equal(exported.rows.length, 3);
      assert.deepEqual(exported.months, []);
      assert.equal(usageCsv(exported).includes('NaN'), false);
      const status = await authority.status(account, '2026-10-08');
      assert.deepEqual(
        [status.spentMicrounits, status.heldMicrounits, status.monthSpentMicrounits],
        [400_000, 1_000_000, 400_000]
      );
      // 纯函数本身也不能假定日账本一定存在
      assert.doesNotThrow(() => usageSummary({ budgetReservations: [] }, account, '2026-10-08'));
    }
  }
];
