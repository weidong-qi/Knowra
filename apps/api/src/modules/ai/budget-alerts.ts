import type { ReadableBudgetSettings } from './budget-types.ts';
import type { AppError } from '../../errors/app-error.ts';
import type { budgetStatus } from './budget-ledger.ts';
type AlertRule = 'daily' | 'monthly';
interface AlertMark {
  notified?: unknown;
  dismissed?: unknown;
}
interface AlertState {
  marks: Record<string, AlertMark>;
  overrides: Partial<Record<AlertRule, string>>;
  pauses: Partial<Record<AlertRule, string>>;
  invalid: boolean;
}
interface AlertEvaluation {
  settings: ReadableBudgetSettings;
  status: ReturnType<typeof budgetStatus>;
  marks?: AlertState['marks'];
  overrides?: AlertState['overrides'];
  pauses?: AlertState['pauses'];
  day: string;
}
interface BudgetAlertStoreOptions {
  filePath: string;
}
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export const ALERT_RULES: AlertRule[] = ['daily', 'monthly'];
const ID_PATTERN = /^(daily|monthly):(\d{4}-\d{2}(?:-\d{2})?):(\d{1,3})$/;
const KEEP_DAYS = 70;
const invalid = (message: string) => Object.assign(new Error(message), { code: 'AI_BUDGET_ALERT_INVALID' });

export const periodOf = (rule: string, day: string) => (rule === 'daily' ? day : day.slice(0, 7));

/**
 * 计算当前周期内已越过的提醒阈值。只看“每日”“每月”两条规则，且规则不是“关闭”时才提醒；
 * 已用额度 = 已结算 + 仍占用的预留（与拦截口径一致）。金额与阈值均为整数，按乘法比较避免浮点误差。
 */
export function evaluateAlerts({ settings, status, marks = {}, overrides = {}, pauses = {}, day }: AlertEvaluation) {
  const alerts = [];
  const rows = {
    daily: { used: status.spentMicrounits + status.heldMicrounits },
    monthly: { used: status.monthSpentMicrounits + status.monthHeldMicrounits }
  };
  for (const rule of ALERT_RULES) {
    const config = settings.rules[rule];
    if (config.mode === 'off') continue;
    const period = periodOf(rule, day);
    for (const threshold of settings.alerts.thresholds) {
      if (rows[rule].used * 100 < threshold * config.limitMicrounits) continue;
      const id = `${rule}:${period}:${threshold}`;
      alerts.push({
        id,
        rule,
        threshold,
        period,
        mode: config.mode,
        usedMicrounits: rows[rule].used,
        limitMicrounits: config.limitMicrounits,
        notified: Boolean(marks[id]?.notified),
        dismissed: Boolean(marks[id]?.dismissed)
      });
    }
  }
  // 每条规则的实际拦截状态，独立于提醒阈值：只要“达到即停”且已用额不低于上限（且未放行），就是已被拦截。
  const rules = ALERT_RULES.filter(rule => settings.rules[rule].mode !== 'off').map(rule => {
    const config = settings.rules[rule];
    const allowedNow = overrides[rule] === periodOf(rule, day);
    return {
      rule,
      mode: config.mode,
      period: periodOf(rule, day),
      usedMicrounits: rows[rule].used,
      limitMicrounits: config.limitMicrounits,
      blocked: config.mode === 'stop' && !allowedNow && rows[rule].used >= config.limitMicrounits
    };
  });
  const allowed = ALERT_RULES.filter(rule => overrides[rule] === periodOf(rule, day)).map(rule => ({
    rule,
    period: overrides[rule]
  }));
  const paused = ALERT_RULES.filter(rule => pauses[rule] === periodOf(rule, day)).map(rule => ({
    rule,
    period: pauses[rule]
  }));
  return { day, alerts, rules, overrides: allowed, pauses: paused };
}

/**
 * 提醒状态：每个周期每个阈值只提醒一次（notified），用户可关闭横幅（dismissed），
 * 并可对当前周期放行被“达到即停”拦截的规则（overrides，周期结束自动失效）。
 * 这些只是提示与便利，文件缺失或损坏时按“没有记录”处理，不影响任何拦截。
 */
export function createBudgetAlertStore({ filePath }: BudgetAlertStoreOptions) {
  if (!path.isAbsolute(filePath ?? '')) throw new TypeError('预算提醒需要绝对路径。');
  let queue: Promise<unknown> = Promise.resolve();
  const plain = (value: unknown): value is Record<string, unknown> =>
    value !== null && typeof value === 'object' && !Array.isArray(value);
  const periodValue = (value: unknown) => typeof value === 'string' && /^\d{4}-\d{2}(-\d{2})?$/.test(value);
  // 严格读取：缺文件按空状态；无法读取、无法解析或结构不对记为 invalid（并给出空状态），而不是悄悄当作“没有暂停”。
  // 暂停状态承担拦截职责，损坏时调用方必须阻止付费调用；只有明确的“暂停/恢复/放行”操作才会重置它。
  async function load(): Promise<AlertState> {
    const empty = { marks: {}, overrides: {}, pauses: {}, invalid: false };
    let raw;
    try {
      raw = await fs.readFile(filePath, 'utf8');
    } catch (error) {
      return (error as AppError | null)?.code === 'ENOENT' ? empty : { ...empty, invalid: true };
    }
    try {
      const parsed: unknown = JSON.parse(raw);
      if (!plain(parsed)) throw new Error('invalid');
      // 只有“字段不存在”按空处理（旧版本文件没有 pauses）；null、数组等一律视为损坏。
      const part = (key: string) => (parsed[key] === undefined ? {} : parsed[key]);
      const [marks, overrides, pauses] = [part('marks'), part('overrides'), part('pauses')];
      if (
        !plain(marks) ||
        !plain(overrides) ||
        !plain(pauses) ||
        !Object.values(overrides).every(periodValue) ||
        !Object.values(pauses).every(periodValue) ||
        !Object.values(marks).every(plain)
      )
        throw new Error('invalid');
      return {
        marks: marks as AlertState['marks'],
        overrides: overrides as AlertState['overrides'],
        pauses: pauses as AlertState['pauses'],
        invalid: false
      };
    } catch {
      return { ...empty, invalid: true };
    }
  }
  async function save(state: AlertState, today: string) {
    // 只保留近期周期的标记，避免文件无限增长。
    const cutoff = new Date(Date.parse(`${today}T00:00:00Z`) - KEEP_DAYS * 24 * 3600_000).toISOString().slice(0, 10);
    const marks = Object.fromEntries(
      Object.entries(state.marks).filter(([id]) => {
        const period = ID_PATTERN.exec(id)?.[2];
        return period && `${period}${period.length === 7 ? '-31' : ''}` >= cutoff;
      })
    );
    await fs.mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
    const temp = `${filePath}.${randomUUID()}.tmp`;
    try {
      await fs.writeFile(temp, JSON.stringify({ marks, overrides: state.overrides, pauses: state.pauses }), {
        mode: 0o600,
        flag: 'wx'
      });
      await fs.rename(temp, filePath);
    } finally {
      await fs.rm(temp, { force: true }).catch(() => undefined);
    }
  }
  const serial = <T>(work: () => Promise<T>): Promise<T> => {
    const run = queue.then(work);
    queue = run.catch(() => undefined);
    return run;
  };
  return {
    get: () => serial(load),
    /** 标记提醒：kind 为 notified（已推送系统通知）或 dismissed（已关闭横幅）。 */
    mark: (ids: unknown, kind: string, today: string) =>
      serial(async () => {
        if (
          !Array.isArray(ids) ||
          ids.length === 0 ||
          ids.length > 24 ||
          !ids.every(id => typeof id === 'string' && ID_PATTERN.test(id)) ||
          !['notified', 'dismissed'].includes(kind)
        )
          throw invalid('提醒标记无效。');
        const state = await load();
        // 状态损坏时不能借“关闭横幅”之名悄悄覆盖文件（会同时抹掉暂停）；必须先显式重置。
        if (state.invalid)
          throw Object.assign(new Error('预算提醒状态文件已损坏，请先在费用提醒处重置。'), {
            code: 'AI_BUDGET_ALERTS_INVALID'
          });
        for (const id of ids) state.marks[id] = { ...state.marks[id], [kind]: true };
        await save(state, today);
      }),
    /** 放行：当前周期内不再因该规则拦截；同时解除该周期的暂停。 */
    allow: (rule: AlertRule, period: string, today: string) =>
      serial(async () => {
        if (!ALERT_RULES.includes(rule) || period !== periodOf(rule, today)) throw invalid('放行请求无效。');
        const state = await load();
        state.overrides[rule] = period;
        delete state.pauses[rule];
        await save(state, today);
      }),
    /** 暂停：到当前周期结束前不再发起付费调用，周期结束自动恢复；不改写用户的预算设置。 */
    pause: (rule: AlertRule, period: string, today: string) =>
      serial(async () => {
        if (!ALERT_RULES.includes(rule) || period !== periodOf(rule, today)) throw invalid('暂停请求无效。');
        const state = await load();
        state.pauses[rule] = period;
        delete state.overrides[rule];
        await save(state, today);
      }),
    /** 恢复：提前解除当前周期的暂停。 */
    resume: (rule: AlertRule, period: string, today: string) =>
      serial(async () => {
        if (!ALERT_RULES.includes(rule) || period !== periodOf(rule, today)) throw invalid('恢复请求无效。');
        const state = await load();
        delete state.pauses[rule];
        await save(state, today);
      })
  };
}
