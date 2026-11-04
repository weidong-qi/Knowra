import type { BudgetLimits, PriceProfile } from './boundary-types.ts';

export type BudgetRuleName = 'daily' | 'monthly' | 'turn' | 'balanceFloor';
export type BudgetMode = 'off' | 'warn' | 'stop';
export type BudgetRule = { mode: 'off'; limitMicrounits: null } | { mode: 'warn' | 'stop'; limitMicrounits: number };
/** Date.parse只校验可解析性；外部updatedAt原值不一定是字符串。 */
export type BudgetPriceTimestamp = string | number | boolean | bigint | object;
export interface BudgetPriceSettings {
  inputMicrounitsPerMillion: number;
  inputCacheHitMicrounitsPerMillion?: number | null;
  outputMicrounitsPerMillion: number;
  updatedAt?: BudgetPriceTimestamp | null;
}
/** every只检查数组索引；外部iterator可产出未验证的阈值原值。 */
export type BudgetThreshold = unknown;
export interface BudgetSettings<Threshold = BudgetThreshold> {
  rules: Record<BudgetRuleName, BudgetRule>;
  price: BudgetPriceSettings | null;
  alerts: { thresholds: readonly Threshold[] };
}
export type ReadableBudgetSettings = BudgetSettings<number>;
export interface BudgetSettingsStore {
  get(): Promise<ReadableBudgetSettings>;
}
export interface BudgetSettingsOptions {
  filePath: string;
  now?: () => Date;
}
export interface BudgetBalanceView {
  checkedAt: string | null;
  latest: { balances: { currency: string; totalMicrounits: number }[] } | null;
}
export interface BudgetBalance {
  view(): Promise<BudgetBalanceView>;
  refresh(): Promise<BudgetBalanceView>;
}
export interface BudgetAlerts {
  get(): Promise<{
    overrides: Partial<Record<'daily' | 'monthly', string>>;
    pauses?: Partial<Record<'daily' | 'monthly', string>>;
    invalid: boolean;
  }>;
}
export interface BudgetPolicyOptions {
  settings: BudgetSettingsStore;
  balance?: BudgetBalance | null;
  alerts?: BudgetAlerts | null;
  basePriceProfile: PriceProfile;
  now?: () => Date;
}
export interface BudgetPolicyLimits {
  limits: BudgetLimits;
  paused: ('daily' | 'monthly')[];
}
