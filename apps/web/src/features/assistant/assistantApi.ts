import { apiClient } from '@study-accelerator/web-core';

export interface AssistantStatus {
  provider: 'deepseek' | 'mock';
  simulation?: boolean;
  modelId: string | null;
  configured: boolean;
  executionLocation: 'local' | 'server';
  generationAvailable: boolean;
  unavailableReason: string | null;
  /** 价格档案超过复核日期时的提示：仍可使用，但显示的费用为估算。 */
  priceNotice?: string | null;
  budget: { day: string; limitMicrounits: number | null; availableMicrounits: number | null;
    spentMicrounits: number; heldMicrounits: number } | null;
  capabilities: { readScopes: Array<'note' | 'folder'>; actions: Array<'answer' | 'cancel'>;
    responseMode: 'polling'; writeTools: false; providerAdvertised: Record<string, boolean> | null;
    providerVerified: boolean };
}

export interface UsageTotals {
  requests: number; spentMicrounits: number; unknownRequests: number; unknownMicrounits: number;
  inputTokens: number; outputTokens: number; cacheHitTokens: number;
}

export interface UsageRecord {
  attemptId: string; day: string; at: string; status: 'settled' | 'unknown';
  costMicrounits: number; modelId: string | null; inputTokens: number | null; outputTokens: number | null;
  cacheHitTokens: number | null; conversationId: string | null; priceVersion: string;
}

export interface AssistantUsage {
  currency: 'CNY'; day: string; location: 'local' | 'server';
  today: UsageTotals; month: UsageTotals; total: UsageTotals; recent: UsageRecord[];
  /** 全部结果未知的请求（最多 100 条），含按最坏情况占用的预留额。 */
  unknown: Array<UsageRecord & { reservedMicrounits: number }>;
  /** 90 天前的明细已折叠成月汇总，累计金额不变。 */
  archive: Array<{ month: string; requests: number; spentMicrounits: number }>;
}

export interface BalanceRow {
  currency: 'CNY' | 'USD'; totalMicrounits: number; grantedMicrounits: number; toppedUpMicrounits: number;
}

export interface AssistantBalance {
  location: 'local' | 'server'; checkedAt: string | null; saved?: boolean;
  latest: { at: string; isAvailable: boolean; balances: BalanceRow[] } | null;
  inferred: Array<{ currency: 'CNY' | 'USD'; sinceAt: string; snapshots: number; consumedMicrounits: number;
    addedMicrounits: number; currentMicrounits: number }>;
}

export type BudgetMode = 'off' | 'warn' | 'stop';
export type BudgetRuleName = 'daily' | 'monthly' | 'turn' | 'balanceFloor';
export interface BudgetRule { mode: BudgetMode; limitMicrounits: number | null }
export interface CustomPrice {
  inputMicrounitsPerMillion: number; inputCacheHitMicrounitsPerMillion: number | null;
  outputMicrounitsPerMillion: number; updatedAt?: string | null;
}
export interface BudgetSettings {
  rules: Record<BudgetRuleName, BudgetRule>;
  price: CustomPrice | null;
  alerts: { thresholds: number[] };
  basePrice?: { version: string; inputMicrounitsPerMillion: number; outputMicrounitsPerMillion: number; reviewedUntil: string } | null;
  location?: 'local' | 'server';
}

export interface BudgetAlert {
  id: string; rule: 'daily' | 'monthly'; threshold: number; period: string; mode: BudgetMode;
  usedMicrounits: number; limitMicrounits: number; notified: boolean; dismissed: boolean;
}
export interface BudgetAlerts {
  day: string; location: 'local' | 'server'; alerts: BudgetAlert[];
  /** 每条规则的实际拦截状态，与提醒阈值无关（阈值不含 100% 时也要能看到已被拦截）。 */
  rules: Array<{ rule: 'daily' | 'monthly'; mode: BudgetMode; period: string; usedMicrounits: number; limitMicrounits: number; blocked: boolean }>;
  overrides: Array<{ rule: 'daily' | 'monthly'; period: string }>;
  /** 用户在当前周期暂停了 AI（周期结束自动恢复，不改预算设置）。 */
  pauses: Array<{ rule: 'daily' | 'monthly'; period: string }>;
  /** 暂停/提醒状态文件损坏：AI 已被阻止，需要用户重置。 */
  stateInvalid?: boolean;
}

export interface AssistantSource {
  sourceId: string;
  noteId: string;
  noteVersionId: string;
  contentHash?: string;
  start: number;
  end: number;
}

export interface AssistantPreview {
  previewId: string;
  expiresAt: string;
  scopeHash: string;
  payloadHash: string;
  recipient: string;
  spaceId: string;
  sources: Array<AssistantSource & { text: string }>;
  omissions: string[];
  estimatedInputTokens: number;
}

export interface AssistantJob {
  jobId: string;
  spaceId: string;
  question: string | null;
  status: 'pending' | 'running' | 'retrying' | 'cancelling' | 'cancelled' | 'succeeded' | 'failed';
  phase: string;
  modelId: string;
  createdAt: string;
  updatedAt: string;
  result?: { answer: string; citations: AssistantSource[] } | null;
  sources?: AssistantSource[];
  omissions?: string[];
  diagnostics?: Array<{ sequence: number; eventKind: string; createdAt: string;
    safePayload: Record<string, string | number | boolean> }>;
}

const root = '/api/ai/assistant';
const mutation = { 'X-Knowra-AI-Assistant': '1' };
const data = async <T>(url: string, options?: Parameters<typeof apiClient.requestJson>[1]) => (
  await apiClient.requestJson<{ data: T }>(url, options)).data;

export const assistantApi = {
  usage: () => data<AssistantUsage>('/api/ai/assistant/usage'),
  resolveUnknown: (value: { attemptId: string; disposition: 'released' | 'settled'; actualMicrounits?: number }) => data<AssistantUsage>('/api/ai/assistant/usage/resolve', {
    method: 'POST', headers: { 'X-Knowra-AI-Assistant': '1', 'Content-Type': 'application/json' }, body: JSON.stringify(value) }),
  exportUsage: async () => {
    const response = await fetch('/api/ai/assistant/usage/export');
    if (!response.ok) throw new Error('导出失败，请稍后重试。');
    return response.text();
  },
  budgetSettings: () => data<BudgetSettings>('/api/ai/assistant/budget-settings'),
  saveBudgetSettings: (value: Pick<BudgetSettings, 'rules' | 'price' | 'alerts'>) => data<BudgetSettings>('/api/ai/assistant/budget-settings', {
    method: 'POST', headers: { 'X-Knowra-AI-Assistant': '1', 'Content-Type': 'application/json' }, body: JSON.stringify(value) }),
  alerts: () => data<BudgetAlerts>('/api/ai/assistant/alerts'),
  markAlerts: (ids: string[], kind: 'notified' | 'dismissed') => data<BudgetAlerts>('/api/ai/assistant/alerts/mark', {
    method: 'POST', headers: { 'X-Knowra-AI-Assistant': '1', 'Content-Type': 'application/json' }, body: JSON.stringify({ ids, kind }) }),
  pauseRule: (rule: 'daily' | 'monthly') => data<BudgetAlerts>('/api/ai/assistant/alerts/pause', {
    method: 'POST', headers: { 'X-Knowra-AI-Assistant': '1', 'Content-Type': 'application/json' }, body: JSON.stringify({ rule }) }),
  resumeRule: (rule: 'daily' | 'monthly') => data<BudgetAlerts>('/api/ai/assistant/alerts/resume', {
    method: 'POST', headers: { 'X-Knowra-AI-Assistant': '1', 'Content-Type': 'application/json' }, body: JSON.stringify({ rule }) }),
  allowRule: (rule: 'daily' | 'monthly') => data<BudgetAlerts>('/api/ai/assistant/alerts/allow', {
    method: 'POST', headers: { 'X-Knowra-AI-Assistant': '1', 'Content-Type': 'application/json' }, body: JSON.stringify({ rule }) }),
  balance: () => data<AssistantBalance>('/api/ai/assistant/balance'),
  refreshBalance: () => data<AssistantBalance>('/api/ai/assistant/balance/refresh', {
    method: 'POST', headers: { 'X-Knowra-AI-Assistant': '1' } }),
  status: () => data<AssistantStatus>(`${root}/status`),
  list: (spaceId: string) => data<AssistantJob[]>(`${root}/jobs?spaceId=${encodeURIComponent(spaceId)}`),
  get: (jobId: string) => data<AssistantJob>(`${root}/jobs/${encodeURIComponent(jobId)}`),
  listLegacy: (spaceId: string) => data<AssistantJob[]>(`/api/ai/conversations/legacy-jobs?spaceId=${encodeURIComponent(spaceId)}`),
  getLegacy: (jobId: string) => data<AssistantJob>(`/api/ai/conversations/legacy-jobs/${encodeURIComponent(jobId)}`),
  preview: (input: { spaceId: string; scope: { kind: 'note'; noteId: string } | { kind: 'folder'; folderId: string }; question: string }) =>
    data<AssistantPreview>(`${root}/preview`, { method: 'POST', headers: mutation, body: JSON.stringify(input) }),
  start: (preview: AssistantPreview, idempotencyKey: string) => data<AssistantJob>(`${root}/jobs`, {
    method: 'POST', headers: mutation, body: JSON.stringify({ previewId: preview.previewId,
      scopeHash: preview.scopeHash, payloadHash: preview.payloadHash, idempotencyKey })
  }),
  cancel: (jobId: string) => data<AssistantJob>(`${root}/jobs/${encodeURIComponent(jobId)}/cancel`, {
    method: 'POST', headers: mutation
  })
};
