import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { AppError } from '../../errors/app-error.ts';
import type { PriceProfile } from './boundary-types.ts';
import type {
  BudgetMode,
  BudgetPriceSettings,
  BudgetPriceTimestamp,
  BudgetRule,
  BudgetRuleName,
  BudgetSettings,
  BudgetSettingsOptions,
  BudgetThreshold,
  ReadableBudgetSettings
} from './budget-types.ts';

interface RawBudgetSettings {
  rules?: Record<string, unknown> | null;
  price?: unknown;
  alerts?: unknown;
}
interface RawBudgetRule {
  mode?: unknown;
  limitMicrounits?: unknown;
}
interface RawBudgetPrice {
  inputMicrounitsPerMillion?: unknown;
  inputCacheHitMicrounitsPerMillion?: unknown;
  outputMicrounitsPerMillion?: unknown;
  updatedAt?: unknown;
}

export const RULE_NAMES: BudgetRuleName[] = ['daily', 'monthly', 'turn', 'balanceFloor'];
export const MODES: BudgetMode[] = ['off', 'warn', 'stop'];
const MAX_LIMIT = 100_000_000_000; // 十万元，防止误输入
const MAX_PRICE = 1_000_000_000; // 每百万 token 一千元

/** 默认值与改造前的写死行为一致：每日 20 元、单次回合 2 元，均为“达到即停”。 */
export const DEFAULT_BUDGET_SETTINGS: Readonly<ReadableBudgetSettings> = Object.freeze({
  rules: Object.freeze({
    daily: Object.freeze({ mode: 'stop', limitMicrounits: 20_000_000 }),
    monthly: Object.freeze({ mode: 'off', limitMicrounits: null }),
    turn: Object.freeze({ mode: 'stop', limitMicrounits: 2_000_000 }),
    balanceFloor: Object.freeze({ mode: 'off', limitMicrounits: null })
  }),
  price: null,
  alerts: Object.freeze({ thresholds: Object.freeze([50, 80, 100]) })
});

const invalid = (message: string) => Object.assign(new Error(message), { code: 'AI_BUDGET_SETTINGS_INVALID' });
const money = (value: unknown): value is number =>
  Number.isSafeInteger(value) && (value as number) >= 1 && (value as number) <= MAX_LIMIT;
const price = (value: unknown): value is number =>
  Number.isSafeInteger(value) && (value as number) >= 0 && (value as number) <= MAX_PRICE;

/** 校验并规范化；未知字段、非法模式或金额一律拒绝。 */
export function normalizeBudgetSettings(input: unknown): BudgetSettings {
  if (
    !input ||
    typeof input !== 'object' ||
    Array.isArray(input) ||
    Object.keys(input).some(key => !['rules', 'price', 'alerts'].includes(key)) ||
    !(input as RawBudgetSettings).rules ||
    typeof (input as RawBudgetSettings).rules !== 'object'
  ) {
    throw invalid('预算设置格式无效。');
  }
  const rules: Partial<Record<BudgetRuleName, BudgetRule>> = {};
  for (const name of RULE_NAMES) {
    const rule = (input as RawBudgetSettings).rules![name] as RawBudgetRule | null | undefined;
    if (
      !rule ||
      typeof rule !== 'object' ||
      Object.keys(rule).some(key => !['mode', 'limitMicrounits'].includes(key)) ||
      !MODES.includes(rule.mode as BudgetMode)
    )
      throw invalid('预算规则无效。');
    if (rule.mode === 'off') rules[name] = { mode: 'off', limitMicrounits: null };
    else if (money(rule.limitMicrounits))
      rules[name] = { mode: rule.mode as 'warn' | 'stop', limitMicrounits: rule.limitMicrounits };
    else throw invalid('预算金额无效。');
  }
  if (Object.keys((input as RawBudgetSettings).rules!).some(key => !RULE_NAMES.includes(key as BudgetRuleName)))
    throw invalid('预算规则无效。');
  let custom: BudgetPriceSettings | null = null;
  if ((input as RawBudgetSettings).price !== null && (input as RawBudgetSettings).price !== undefined) {
    const {
      inputMicrounitsPerMillion,
      inputCacheHitMicrounitsPerMillion = null,
      outputMicrounitsPerMillion,
      updatedAt
    } = (input as RawBudgetSettings).price as RawBudgetPrice;
    if (
      typeof (input as RawBudgetSettings).price !== 'object' ||
      Array.isArray((input as RawBudgetSettings).price) ||
      Object.keys((input as RawBudgetSettings).price as object).some(
        key =>
          ![
            'inputMicrounitsPerMillion',
            'inputCacheHitMicrounitsPerMillion',
            'outputMicrounitsPerMillion',
            'updatedAt'
          ].includes(key)
      ) ||
      !price(inputMicrounitsPerMillion) ||
      !price(outputMicrounitsPerMillion) ||
      (inputCacheHitMicrounitsPerMillion !== null &&
        (!price(inputCacheHitMicrounitsPerMillion) || inputCacheHitMicrounitsPerMillion > inputMicrounitsPerMillion)) ||
      (updatedAt !== undefined && !Number.isFinite((Date.parse as (value: unknown) => number)(updatedAt)))
    )
      throw invalid('自定义单价无效。');
    custom = {
      inputMicrounitsPerMillion,
      inputCacheHitMicrounitsPerMillion: inputCacheHitMicrounitsPerMillion as number | null,
      outputMicrounitsPerMillion,
      updatedAt: (updatedAt as BudgetPriceTimestamp | undefined) ?? null
    };
  }
  // 提醒阈值：1–100 的整数百分比，去重排序，最多 6 个；缺省（旧文件、旧客户端）用默认值。
  let thresholds: BudgetThreshold[] = [...DEFAULT_BUDGET_SETTINGS.alerts.thresholds];
  if ((input as RawBudgetSettings).alerts !== undefined) {
    const list = ((input as RawBudgetSettings).alerts as { thresholds?: unknown } | null | undefined)?.thresholds;
    if (
      !(input as RawBudgetSettings).alerts ||
      typeof (input as RawBudgetSettings).alerts !== 'object' ||
      Object.keys((input as RawBudgetSettings).alerts as object).some(key => key !== 'thresholds') ||
      !Array.isArray(list) ||
      list.length > 6 ||
      !list.every((value: unknown) => Number.isInteger(value) && (value as number) >= 1 && (value as number) <= 100)
    ) {
      throw invalid('提醒阈值无效。');
    }
    // 比较继续使用原a-b的JS语义；视图不验证或转换iterator产出的原值。
    thresholds = [...new Set(list as BudgetThreshold[])].sort((a, b) => (a as number) - (b as number));
  }
  // RULE_NAMES的四条规则均已在原循环中填入。
  return { rules: rules as BudgetSettings['rules'], price: custom, alerts: { thresholds } };
}

/** 把用户单价叠加到已核对的价格档案上；版本号带自定义标记，使账本能区分。 */
export function effectivePriceProfile<Profile extends PriceProfile>(
  base: Profile,
  custom: BudgetPriceSettings | null | undefined
) {
  if (!custom) return base;
  const updated = custom.updatedAt ?? new Date(0).toISOString();
  return {
    ...base,
    version: `${base.version}+custom`,
    expiresAt: new Date(
      (Date.parse as (value: BudgetPriceTimestamp) => number)(updated) + 30 * 24 * 3600_000
    ).toISOString(),
    inputMicrounitsPerMillion: custom.inputMicrounitsPerMillion,
    outputMicrounitsPerMillion: custom.outputMicrounitsPerMillion,
    inputCacheHitMicrounitsPerMillion: custom.inputCacheHitMicrounitsPerMillion
  };
}

/** 账本实际执行的上限：只有“达到即停”的规则才限制预留，其余为 null。 */
export function enforcedLimits(settings: Pick<BudgetSettings, 'rules'>) {
  const stop = (name: 'daily' | 'monthly' | 'turn') =>
    settings.rules[name].mode === 'stop' ? settings.rules[name].limitMicrounits : null;
  return { daily: stop('daily'), monthly: stop('monthly'), turn: stop('turn') };
}

/**
 * 预算设置存储。文件缺失按默认值；文件损坏或无效时抛错（fail closed），不静默回到默认值，
 * 否则用户设置的更严格上限会被悄悄放宽。
 */
export function createBudgetSettingsStore({ filePath, now = () => new Date() }: BudgetSettingsOptions) {
  if (!path.isAbsolute(filePath ?? '')) throw new TypeError('预算设置需要绝对路径。');
  let writing: Promise<BudgetSettings | void> = Promise.resolve();
  async function get(): Promise<ReadableBudgetSettings> {
    let raw;
    try {
      raw = await fs.readFile(filePath, 'utf8');
    } catch (error) {
      if ((error as Partial<AppError> | null | undefined)?.code === 'ENOENT')
        return structuredClone(DEFAULT_BUDGET_SETTINGS);
      throw Object.assign(new Error('预算设置无法读取，已阻止模型调用。'), { code: 'AI_BUDGET_SETTINGS_INVALID' });
    }
    try {
      // 原JSON解析产生稠密数组；成功校验后的阈值仅为number，null仍走原失败路径。
      return normalizeBudgetSettings(JSON.parse(raw)) as ReadableBudgetSettings;
    } catch {
      throw Object.assign(new Error('预算设置文件已损坏，已阻止模型调用；原文件已保留。'), {
        code: 'AI_BUDGET_SETTINGS_INVALID'
      });
    }
  }
  async function set(input: unknown) {
    const next = normalizeBudgetSettings(input);
    if (next.price) next.price.updatedAt = now().toISOString();
    const run = writing.then(async () => {
      await fs.mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
      const temp = `${filePath}.${randomUUID()}.tmp`;
      try {
        await fs.writeFile(temp, JSON.stringify(next), { mode: 0o600, flag: 'wx' });
        await fs.rename(temp, filePath);
      } finally {
        await fs.rm(temp, { force: true }).catch(() => undefined);
      }
      return next;
    });
    writing = run.catch(() => undefined);
    return run;
  }
  return { get, set };
}
