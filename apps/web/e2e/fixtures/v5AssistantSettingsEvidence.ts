import type { Page } from '@playwright/test';
import type { AssistantBalance, AssistantUsage, BudgetAlerts, BudgetSettings } from '../../src/features/assistant/assistantApi';
import type { ModelSettingsStatus } from '../../src/features/settings/modelSettings';
import { mockMobileEvidence } from '../mobile-evidence.fixture';

const totals = { requests: 0, spentMicrounits: 0, unknownRequests: 0, unknownMicrounits: 0,
  inputTokens: 0, outputTokens: 0, cacheHitTokens: 0 };
const usage: AssistantUsage = { currency: 'CNY', day: '2026-10-10', location: 'server',
  today: totals, month: totals, total: totals, recent: [], unknown: [], archive: [] };
const balance: AssistantBalance = { location: 'server', checkedAt: null, latest: null, inferred: [] };
const alerts: BudgetAlerts = { day: '2026-10-10', location: 'server', alerts: [], rules: [], overrides: [], pauses: [] };
const model: ModelSettingsStatus = { provider: 'deepseek', modelId: 'deepseek-flash', configured: false,
  supportedModelIds: ['deepseek-flash'], modelSupported: true, connected: false, modelAvailable: false };
const budget: BudgetSettings = { location: 'server', price: null, alerts: { thresholds: [50, 80, 100] },
  basePrice: { version: 'synthetic-evidence-only', inputMicrounitsPerMillion: 2_000_000,
    outputMicrounitsPerMillion: 8_000_000, reviewedUntil: '2026-10-10T00:00:00.000Z' },
  rules: { daily: { mode: 'stop', limitMicrounits: 20_000_000 }, monthly: { mode: 'off', limitMicrounits: null },
    turn: { mode: 'stop', limitMicrounits: 2_000_000 }, balanceFloor: { mode: 'off', limitMicrounits: null } } };

/** 继承全 context HTTP/WebSocket 阻断；新增端点也必须同源且仅返回无密钥合成数据。 */
export async function mockV5AssistantSettingsEvidence(page: Page) {
  const network = await mockMobileEvidence(page);
  const dataByPath: Record<string, unknown> = {
    '/api/ai/model-settings': model,
    '/api/ai/assistant/usage': usage,
    '/api/ai/assistant/balance': balance,
    '/api/ai/assistant/budget-settings': budget,
    '/api/ai/assistant/alerts': alerts,
    '/api/ai/assistant/status': { provider: 'mock', simulation: true, modelId: 'synthetic-evidence-only', configured: true,
      executionLocation: 'server', generationAvailable: true, unavailableReason: null, budget: null,
      capabilities: { readScopes: ['note', 'folder'], actions: ['answer', 'cancel'], responseMode: 'polling',
        writeTools: false, providerAdvertised: null, providerVerified: false } }
  };
  await page.context().route('**/*', async route => {
    const request = route.request(), url = new URL(request.url()), method = request.method(), path = url.pathname;
    // 必须先校验 origin，避免新端点 mock 遮蔽已有外网阻断。
    if (url.origin !== 'http://127.0.0.1:5173' || !path.startsWith('/api/')) return route.fallback();
    const syntheticConversationWrite = method === 'POST' && (path === '/api/ai/conversations'
      || /^\/api\/ai\/conversations\/[^/]+\/messages$/.test(path));
    if (method !== 'GET' && !syntheticConversationWrite) {
      network.requests.push(`${method} ${path}`); network.blocked.push(`${method} ${path}`);
      return route.abort('blockedbyclient');
    }
    if (!(path in dataByPath)) return route.fallback();
    network.requests.push(`${method} ${path}`);
    return route.fulfill({ json: { data: dataByPath[path] } });
  });
  return network;
}
