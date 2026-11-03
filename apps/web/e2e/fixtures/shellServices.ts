import type { Page } from '@playwright/test';

/** 外壳会主动读取的只读 AI 状态，全部为合成数据，不启动真实 API。 */
export async function mockShellServices(page: Page) {
  const totals = { requests: 0, spentMicrounits: 0, unknownRequests: 0, unknownMicrounits: 0, inputTokens: 0, outputTokens: 0, cacheHitTokens: 0 };
  const rules = Object.fromEntries(['daily', 'monthly', 'turn', 'balanceFloor'].map(key => [key, { mode: 'off', limitMicrounits: null }]));
  const dataByPath: Record<string, unknown> = {
    '/api/storage/attachments': [],
    '/api/storage/attachments/cleanup': { items: [], pending: 0 },
    '/api/ai/assistant/status': { provider: 'deepseek', modelId: 'deepseek-flash', configured: false, executionLocation: 'server', generationAvailable: false, unavailableReason: '合成只读状态', budget: null },
    '/api/ai/assistant/alerts': { day: '2026-10-01', location: 'server', alerts: [], rules: [], overrides: [], pauses: [] },
    '/api/ai/capabilities': { contractVersion: 1, knowledgeExtraction: { available: false, executionMode: 'unavailable', executionLocation: 'server', canStart: false, canReadJobs: false, reasonCode: 'NOT_CONFIGURED', message: '合成只读状态' } },
    '/api/ai/features': { knowledgeProposals: false },
    '/api/ai/assistant/budget-settings': { rules, price: null, alerts: { thresholds: [50, 80, 100] } },
    '/api/ai/assistant/balance': { location: 'server', checkedAt: null, latest: null, inferred: [] },
    '/api/ai/assistant/usage': { currency: 'CNY', day: '2026-10-01', location: 'server', today: totals, month: totals, total: totals, recent: [], unknown: [], archive: [] }
  };
  for (const [path, data] of Object.entries(dataByPath)) {
    await page.route(url => url.pathname === path, route => route.request().method() === 'GET'
      ? route.fulfill({ json: { data } }) : route.fallback());
  }
}
