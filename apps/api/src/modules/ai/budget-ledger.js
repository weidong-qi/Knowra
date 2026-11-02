import { randomUUID } from 'node:crypto';

export const DAILY_LIMIT_MICROUNITS = 20_000_000;
export const JOB_LIMIT_MICROUNITS = 2_000_000;

function fail(code, message) {
  /** @type {Error & Partial<Pick<import('../../errors/app-error.ts').AppError, 'code'>>} */
  const error = new Error(message);
  error.code = code;
  throw error;
}
function amount(value) {
  return Number.isSafeInteger(value) && value >= 0;
}
function day(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}
const count = value => (Number.isSafeInteger(value) && value >= 0 ? value : null);
// 模型名与会话 ID 只做长度和控制字符检查：会话 ID 可能含中文等字符（如“会话/已导入”），不能因此拒绝结算。
const label = value =>
  typeof value === 'string' &&
  value.length >= 1 &&
  value.length <= 128 &&
  !Array.from(value).some(character => character.charCodeAt(0) <= 31 || character.charCodeAt(0) === 127)
    ? value
    : null;

/**
 * 用量明细只含模型名、token 数和所属对话 ID，不含任何对话内容；旧账本没有该字段，视为未记录。
 * 明细只用于展示，所以这里只清洗、不拒绝：付费调用已经发生，明细异常绝不能让结算失败而继续占用预算。
 */
export function normalizeUsage(usage) {
  if (!usage || typeof usage !== 'object' || Array.isArray(usage)) return null;
  const inputTokens = count(usage.inputTokens);
  const cacheHitTokens = count(usage.cacheHitTokens);
  return {
    modelId: label(usage.modelId),
    inputTokens,
    outputTokens: count(usage.outputTokens),
    cacheHitTokens:
      cacheHitTokens !== null && inputTokens !== null && cacheHitTokens > inputTokens ? null : cacheHitTokens,
    conversationId: label(usage.conversationId)
  };
}

export function beijingDay(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(now);
}

export function validateBudgetState(state) {
  // 只有“字段不存在”（旧版本账本）才补空集合；显式的 null 或其他类型是损坏，必须报错，
  // 否则损坏的月汇总会被静默清空，累计费用随之丢失，下一次写盘还会覆盖原文件。
  if (state.budgetDays === undefined) state.budgetDays = [];
  if (state.budgetReservations === undefined) state.budgetReservations = [];
  if (state.budgetMonths === undefined) state.budgetMonths = [];
  if (
    !Array.isArray(state.budgetDays) ||
    !Array.isArray(state.budgetReservations) ||
    !Array.isArray(state.budgetMonths)
  )
    fail('AI_BUDGET_INVALID', '预算账本结构无效。');
  const monthKeys = new Set();
  for (const row of state.budgetMonths) {
    if (
      !row.accountRef ||
      !/^\d{4}-\d{2}$/.test(row.month) ||
      ![row.requests, row.spentMicrounits, row.inputTokens, row.outputTokens, row.cacheHitTokens].every(amount) ||
      monthKeys.has(`${row.accountRef}:${row.month}`)
    )
      fail('AI_BUDGET_INVALID', '预算月汇总无效。');
    monthKeys.add(`${row.accountRef}:${row.month}`);
  }
  const keys = new Set();
  for (const row of state.budgetDays) {
    if (
      !row.accountRef ||
      !day(row.day) ||
      !amount(row.spentMicrounits) ||
      !amount(row.heldMicrounits) ||
      (row.archivedSpentMicrounits !== undefined && !amount(row.archivedSpentMicrounits)) ||
      keys.has(`${row.accountRef}:${row.day}`)
    )
      fail('AI_BUDGET_INVALID', '预算日账本无效。');
    keys.add(`${row.accountRef}:${row.day}`);
  }
  const attempts = new Set();
  const reservationIds = new Set();
  for (const row of state.budgetReservations) {
    if (
      !row.reservationId ||
      !row.accountRef ||
      !day(row.day) ||
      !row.jobId ||
      !row.attemptId ||
      !amount(row.reservedMicrounits) ||
      !['held', 'settled', 'unknown', 'released'].includes(row.status) ||
      (row.status === 'settled' && (!amount(row.actualMicrounits) || row.actualMicrounits > row.reservedMicrounits)) ||
      (row.status !== 'settled' && row.actualMicrounits !== null) ||
      (row.usage !== undefined && row.usage !== null && (typeof row.usage !== 'object' || Array.isArray(row.usage))) ||
      !keys.has(`${row.accountRef}:${row.day}`) ||
      attempts.has(`${row.accountRef}:${row.attemptId}`) ||
      reservationIds.has(row.reservationId)
    ) {
      fail('AI_BUDGET_INVALID', '预算预留记录无效。');
    }
    attempts.add(`${row.accountRef}:${row.attemptId}`);
    reservationIds.add(row.reservationId);
  }
  for (const row of state.budgetDays) {
    const entries = state.budgetReservations.filter(item => item.accountRef === row.accountRef && item.day === row.day);
    if (
      row.heldMicrounits !==
        entries
          .filter(item => ['held', 'unknown'].includes(item.status))
          .reduce((sum, item) => sum + item.reservedMicrounits, 0) ||
      // 日已花费 = 已折叠进月汇总的部分 + 仍保留明细的已结算请求；折叠只丢明细，不改日账本的金额。
      row.spentMicrounits !==
        (row.archivedSpentMicrounits ?? 0) +
          entries.filter(item => item.status === 'settled').reduce((sum, item) => sum + item.actualMicrounits, 0)
    ) {
      fail('AI_BUDGET_INVALID', '预算日账本与预留记录不一致。');
    }
  }
  return state;
}

/** 未传 limits 时沿用改造前的默认：每日 20 元、单回合 2 元、无月上限；传入的 null 表示该规则不限制预留。 */
export const DEFAULT_LIMITS = Object.freeze({
  daily: DAILY_LIMIT_MICROUNITS,
  monthly: null,
  turn: JOB_LIMIT_MICROUNITS
});

function checkLimits(limits) {
  if (limits === undefined) return DEFAULT_LIMITS;
  if (
    !limits ||
    typeof limits !== 'object' ||
    Object.keys(limits).some(key => !['daily', 'monthly', 'turn'].includes(key)) ||
    !['daily', 'monthly', 'turn'].every(
      key => limits[key] === null || (Number.isSafeInteger(limits[key]) && limits[key] >= 1)
    )
  ) {
    fail('AI_BUDGET_REQUEST_INVALID', '预算上限参数无效。');
  }
  return limits;
}

// 预算统计只看日账本：折叠只丢请求明细，日账本（含折叠进月汇总的金额 archivedSpentMicrounits）永久保留，
// 所以无论系统时钟怎样，某一天、某个月的已花费都是准确的，不依赖明细是否还在。
const monthTotals = (state, accountRef, date) =>
  state.budgetDays
    .filter(row => row.accountRef === accountRef && row.day.startsWith(date.slice(0, 7)))
    .reduce((sum, row) => ({ spent: sum.spent + row.spentMicrounits, held: sum.held + row.heldMicrounits }), {
      spent: 0,
      held: 0
    });

/** limitMicrounits / availableMicrounits 为 null 表示当日规则不是“达到即停”，不限制调用。 */
export function budgetStatus(state, accountRef, date = beijingDay(), limits) {
  const { daily, monthly } = checkLimits(limits);
  const row = state.budgetDays.find(item => item.accountRef === accountRef && item.day === date);
  const spentMicrounits = row?.spentMicrounits ?? 0;
  const heldMicrounits = row?.heldMicrounits ?? 0;
  const month = monthTotals(state, accountRef, date);
  return {
    accountRef,
    day: date,
    limitMicrounits: daily,
    spentMicrounits,
    heldMicrounits,
    availableMicrounits: daily === null ? null : Math.max(0, daily - spentMicrounits - heldMicrounits),
    monthLimitMicrounits: monthly,
    monthSpentMicrounits: month.spent,
    monthHeldMicrounits: month.held,
    monthAvailableMicrounits: monthly === null ? null : Math.max(0, monthly - month.spent - month.held)
  };
}

export function reserveBudget(state, input) {
  const { accountRef, jobId, attemptId, priceVersion, reservedMicrounits } = input ?? {};
  const { daily: dailyLimit, monthly: monthlyLimit, turn: turnLimit } = checkLimits(input?.limits);
  const date = input?.day ?? beijingDay();
  if (
    ![accountRef, jobId, attemptId, priceVersion].every(
      value => typeof value === 'string' && /^[a-zA-Z0-9_.:-]{1,128}$/.test(value)
    ) ||
    !day(date) ||
    !amount(reservedMicrounits) ||
    reservedMicrounits < 1 ||
    reservedMicrounits > JOB_LIMIT_MICROUNITS
  ) {
    // 单次请求最坏费用上限是始终保留的技术护栏
    fail('AI_BUDGET_REQUEST_INVALID', '预算预留参数无效。');
  }
  const existing = state.budgetReservations.find(row => row.accountRef === accountRef && row.attemptId === attemptId);
  if (existing) {
    if (
      existing.jobId !== jobId ||
      existing.priceVersion !== priceVersion ||
      existing.reservedMicrounits !== reservedMicrounits
    ) {
      fail('AI_BUDGET_CONFLICT', '尝试 ID 已绑定其他预算请求。');
    }
    return structuredClone(existing);
  }
  const jobTotal = state.budgetReservations
    .filter(row => row.accountRef === accountRef && row.jobId === jobId)
    .reduce((sum, row) => sum + row.reservedMicrounits, 0);
  if (turnLimit !== null && jobTotal + reservedMicrounits > turnLimit)
    fail('AI_JOB_BUDGET_EXCEEDED', `单次回合预留超过 ${(turnLimit / 1_000_000).toFixed(2)} 元上限。`);
  let daily = state.budgetDays.find(row => row.accountRef === accountRef && row.day === date);
  if (!daily) {
    daily = { accountRef, day: date, spentMicrounits: 0, heldMicrounits: 0 };
    state.budgetDays.push(daily);
  }
  if (dailyLimit !== null && daily.spentMicrounits + daily.heldMicrounits + reservedMicrounits > dailyLimit) {
    fail('AI_DAILY_BUDGET_EXCEEDED', '北京时间当日预算不足。');
  }
  if (monthlyLimit !== null) {
    const month = monthTotals(state, accountRef, date);
    if (month.spent + month.held + reservedMicrounits > monthlyLimit)
      fail('AI_MONTHLY_BUDGET_EXCEEDED', '本月预算不足。');
  }
  daily.heldMicrounits += reservedMicrounits;
  const record = {
    reservationId: randomUUID(),
    accountRef,
    day: date,
    jobId,
    attemptId,
    priceVersion,
    reservedMicrounits,
    actualMicrounits: null,
    status: 'held',
    createdAt: new Date().toISOString(),
    settledAt: null
  };
  state.budgetReservations.push(record);
  return structuredClone(record);
}

/** @param {Parameters<typeof reserveBudget>[0]} state
 * @param {import('./boundary-types.ts').BudgetSettlement} [input] */
export function settleBudget(
  state,
  { accountRef, attemptId, actualMicrounits = null, disposition = 'unknown', usage } = {}
) {
  const detail = normalizeUsage(usage);
  const row = state.budgetReservations.find(item => item.accountRef === accountRef && item.attemptId === attemptId);
  if (!row) fail('AI_BUDGET_NOT_FOUND', '预算预留不存在。');
  if (row.status !== 'held' && !(row.status === 'unknown' && ['settled', 'released'].includes(disposition))) {
    if (row.status === disposition && row.actualMicrounits === actualMicrounits) return structuredClone(row);
    fail('AI_BUDGET_CONFLICT', '预算预留已结算。');
  }
  if (
    !['settled', 'unknown', 'released'].includes(disposition) ||
    (disposition === 'settled' && !amount(actualMicrounits)) ||
    (disposition !== 'settled' && actualMicrounits !== null) ||
    (disposition === 'settled' && actualMicrounits > row.reservedMicrounits)
  ) {
    fail('AI_BUDGET_SETTLEMENT_INVALID', '预算结算无效或超过预留额。');
  }
  const daily = state.budgetDays.find(item => item.accountRef === row.accountRef && item.day === row.day);
  if (disposition !== 'unknown') daily.heldMicrounits -= row.reservedMicrounits;
  if (disposition === 'settled') daily.spentMicrounits += actualMicrounits;
  row.status = disposition;
  row.actualMicrounits = actualMicrounits;
  if (detail) row.usage = detail;
  row.settledAt = new Date().toISOString();
  return structuredClone(row);
}

const RECENT_LIMIT = 50;
const DETAIL_KEEP_DAYS = 90;
const UNKNOWN_LIMIT = 100;

const shiftDay = (value, days) =>
  new Date(Date.parse(`${value}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

/**
 * 用量明细只保留 90 天：更早已结算的请求折叠进“月汇总”（笔数、费用、token），保证累计不变；
 * 未结算（占用中、结果未知）的预留永远不裁剪，因为它们仍占用额度。日账本永久保留（每天一行，很小），
 * 所以裁剪只影响请求明细的保留，预算统计与上限判断不受系统时钟影响。
 * 基准日取“今天”与“账本中最新一天”的较早者，并对明显的时间跳变不裁剪（尽力而为：连续两天都错的时钟无法识别，
 * 此时最多提前丢失请求明细，金额统计不受影响）。
 * 返回被折叠的请求数。
 */
export function pruneBudgetState(state, accountRef, today = beijingDay()) {
  const days = state.budgetDays.filter(row => row.accountRef === accountRef).map(row => row.day);
  if (days.length === 0) return 0;
  const newest = days.reduce((a, b) => (a > b ? a : b));
  // 时间跳变保护：账本最新日同样来自系统时钟。若最新一天比此前的最新一天晚出 90 天以上，视为可能的时钟异常，
  // 这一次不裁剪；只有之后又出现更晚的日期（说明时间确实在持续推进）才继续折叠。
  const previous = days.filter(day => day < newest).reduce((a, b) => (a > b ? a : b), '');
  if (previous && shiftDay(previous, DETAIL_KEEP_DAYS) < newest) return 0;
  const cutoff = shiftDay(newest < today ? newest : today, -DETAIL_KEEP_DAYS);
  const old = state.budgetReservations.filter(
    row => row.accountRef === accountRef && row.day < cutoff && ['settled', 'released'].includes(row.status)
  );
  if (old.length === 0) return 0;
  state.budgetMonths ??= [];
  let folded = 0;
  for (const row of old) {
    const daily = state.budgetDays.find(item => item.accountRef === accountRef && item.day === row.day);
    if (row.status === 'settled') {
      const month = row.day.slice(0, 7);
      let entry = state.budgetMonths.find(item => item.accountRef === accountRef && item.month === month);
      if (!entry) {
        entry = {
          accountRef,
          month,
          requests: 0,
          spentMicrounits: 0,
          inputTokens: 0,
          outputTokens: 0,
          cacheHitTokens: 0
        };
        state.budgetMonths.push(entry);
      }
      entry.requests += 1;
      entry.spentMicrounits += row.actualMicrounits;
      const detail = normalizeUsage(row.usage); // 折叠进月汇总前同样清洗，损坏的明细不会污染累计
      entry.inputTokens += detail?.inputTokens ?? 0;
      entry.outputTokens += detail?.outputTokens ?? 0;
      entry.cacheHitTokens += detail?.cacheHitTokens ?? 0;
      daily.archivedSpentMicrounits = (daily.archivedSpentMicrounits ?? 0) + row.actualMicrounits;
      folded += 1;
    }
  }
  const gone = new Set(old);
  state.budgetReservations = state.budgetReservations.filter(row => !gone.has(row));
  return folded;
}
const emptyTotals = () => ({
  requests: 0,
  spentMicrounits: 0,
  unknownRequests: 0,
  unknownMicrounits: 0,
  inputTokens: 0,
  outputTokens: 0,
  cacheHitTokens: 0
});

/**
 * 用量汇总：只读，不拦截任何请求。今日/本月按北京时间自然日归属，累计覆盖账本内全部记录。
 * 已结算的请求按实际费用计入；结果未知的请求单独计数，其预留额仍占用额度，不计入“已花费”。
 */
export function usageSummary(state, accountRef, date = beijingDay(), limit = RECENT_LIMIT) {
  const month = date.slice(0, 7);
  const periods = { today: emptyTotals(), month: emptyTotals(), total: emptyTotals() };
  // 已折叠的月汇总只计入累计（以及仍落在当前月内的部分）。
  const archive = (state.budgetMonths ?? []).filter(row => row.accountRef === accountRef);
  for (const row of archive) {
    const targets = [periods.total, ...(row.month === month ? [periods.month] : [])];
    for (const totals of targets) {
      totals.requests += row.requests;
      totals.spentMicrounits += row.spentMicrounits;
      totals.inputTokens += row.inputTokens;
      totals.outputTokens += row.outputTokens;
      totals.cacheHitTokens += row.cacheHitTokens;
    }
  }
  const rows = state.budgetReservations.filter(
    row => row.accountRef === accountRef && row.status !== 'held' && row.status !== 'released'
  );
  for (const row of rows) {
    // 读取时统一清洗：账本里已有的明细字段可能被损坏或旧版写入，汇总与展示不能因此出现字符串拼接、NaN 或崩溃。
    const detail = normalizeUsage(row.usage);
    const targets = [periods.total];
    if (row.day === date) targets.push(periods.today);
    if (row.day.startsWith(month)) targets.push(periods.month);
    for (const totals of targets) {
      totals.requests += 1;
      if (row.status === 'settled') totals.spentMicrounits += row.actualMicrounits;
      else {
        totals.unknownRequests += 1;
        totals.unknownMicrounits += row.reservedMicrounits;
      }
      totals.inputTokens += detail?.inputTokens ?? 0;
      totals.outputTokens += detail?.outputTokens ?? 0;
      totals.cacheHitTokens += detail?.cacheHitTokens ?? 0;
    }
  }
  // 当天已折叠的部分只剩金额（明细已不在）：计入今日已花费，与预算统计一致。
  // 适配器可能只提供预留记录（如 PostgreSQL 的用量查询），日账本缺失时按没有折叠处理。
  periods.today.spentMicrounits +=
    (state.budgetDays ?? []).find(row => row.accountRef === accountRef && row.day === date)?.archivedSpentMicrounits ??
    0;
  // 先倒序再稳定排序：同一毫秒内结算的请求，后写入的排前面。
  const view = row => ({
    attemptId: row.attemptId,
    day: row.day,
    at: row.settledAt ?? row.createdAt,
    status: row.status,
    costMicrounits: row.status === 'settled' ? row.actualMicrounits : row.reservedMicrounits,
    modelId: normalizeUsage(row.usage)?.modelId ?? null,
    inputTokens: normalizeUsage(row.usage)?.inputTokens ?? null,
    outputTokens: normalizeUsage(row.usage)?.outputTokens ?? null,
    cacheHitTokens: normalizeUsage(row.usage)?.cacheHitTokens ?? null,
    conversationId: normalizeUsage(row.usage)?.conversationId ?? null,
    priceVersion: row.priceVersion
  });
  const unknown = rows
    .filter(row => row.status === 'unknown')
    .toSorted((a, b) => (a.settledAt ?? a.createdAt).localeCompare(b.settledAt ?? b.createdAt))
    .slice(0, UNKNOWN_LIMIT)
    .map(row => ({ ...view(row), reservedMicrounits: row.reservedMicrounits }));
  const recent = rows
    .toReversed()
    .toSorted((a, b) => (b.settledAt ?? b.createdAt).localeCompare(a.settledAt ?? a.createdAt))
    .slice(0, limit)
    .map(view);
  return {
    accountRef,
    currency: 'CNY',
    day: date,
    ...periods,
    recent,
    unknown,
    archive: archive.map(({ month, requests, spentMicrounits }) => ({ month, requests, spentMicrounits }))
  };
}

/** 导出用的全部明细（升序）与月汇总。 */
export function usageRows(state, accountRef) {
  const rows = state.budgetReservations
    .filter(row => row.accountRef === accountRef && ['settled', 'unknown'].includes(row.status))
    .toSorted((a, b) => (a.settledAt ?? a.createdAt).localeCompare(b.settledAt ?? b.createdAt));
  return {
    rows: rows.map(row => ({
      at: row.settledAt ?? row.createdAt,
      day: row.day,
      status: row.status,
      costMicrounits: row.status === 'settled' ? row.actualMicrounits : row.reservedMicrounits,
      modelId: normalizeUsage(row.usage)?.modelId ?? null,
      inputTokens: normalizeUsage(row.usage)?.inputTokens ?? null,
      outputTokens: normalizeUsage(row.usage)?.outputTokens ?? null,
      cacheHitTokens: normalizeUsage(row.usage)?.cacheHitTokens ?? null,
      conversationId: normalizeUsage(row.usage)?.conversationId ?? null,
      priceVersion: row.priceVersion,
      attemptId: row.attemptId
    })),
    months: (state.budgetMonths ?? [])
      .filter(row => row.accountRef === accountRef)
      .toSorted((a, b) => a.month.localeCompare(b.month))
  };
}

export function createJsonBudgetAuthority({ getState, runTransaction, onChange }) {
  return {
    status: (accountRef, date, limits) => budgetStatus(getState(), accountRef, date, limits),
    usage: (accountRef, date) => usageSummary(getState(), accountRef, date),
    usageRows: accountRef => usageRows(getState(), accountRef),
    reserve: input =>
      runTransaction(() => {
        const result = reserveBudget(getState(), input);
        onChange();
        return result;
      }),
    settle: input =>
      runTransaction(() => {
        const result = settleBudget(getState(), input);
        pruneBudgetState(getState(), input.accountRef);
        onChange();
        return result;
      })
  };
}
