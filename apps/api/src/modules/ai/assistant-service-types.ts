import type { AiAwaitable, AiJob, AiRecordRepositoryPort } from './record-types.ts';
import type { GatewayResult, PriceProfile } from './boundary-types.ts';
import type { GatewayRequest, createAiGateway } from './gateway.ts';
import type { createAiReadContextService } from './read-context-service.ts';
import type { createJsonBudgetAuthority } from './budget-ledger.ts';
import type { createBudgetPolicy } from './budget-policy.ts';
import type { createBudgetSettingsStore } from './budget-settings.ts';
import type { createBudgetAlertStore } from './budget-alerts.ts';
import type { createBalanceService } from './balance-service.ts';

type ReadContext = ReturnType<typeof createAiReadContextService>;
type BudgetAuthority = ReturnType<typeof createJsonBudgetAuthority>;
// 历史不受支持的模型配置可没有 credentialRef；prepareRead 保留原校验。
export interface AssistantReference {
  modelId: string;
  credentialRef?: string;
}
export interface AssistantPreview {
  prepared: Awaited<ReturnType<ReadContext['prepareRead']>>;
  expiresAt: number;
  credentialRef?: string;
}
export interface AssistantStartInput {
  previewId?: string;
  scopeHash?: string;
  payloadHash?: string;
  idempotencyKey?: string;
}
export interface AssistantRuntime {
  unavailableReason?: string | null;
  repository?: Pick<
    AiRecordRepositoryPort,
    'identity' | 'get' | 'list' | 'insert' | 'replace' | 'listEvents' | 'appendEvent'
  > | null;
  readContext?: Pick<ReadContext, 'prepareRead' | 'authorizeRead'> | null;
  worker?: {
    run(jobId: string, request: GatewayRequest): Promise<GatewayResult | void>;
    cancel(jobId: string): Promise<AiJob>;
  } | null;
  generationAvailable?: boolean | ((modelId: string) => boolean);
  credentialReference?: () => AiAwaitable<AssistantReference | null>;
  priceProfile?: PriceProfile | null;
  gateway?: Pick<ReturnType<typeof createAiGateway>, 'capabilities'> | null;
  actions?: object | null;
  budgetAuthority?:
    | {
        [Method in 'status' | 'usage' | 'usageRows' | 'settle']: (
          ...args: Parameters<BudgetAuthority[Method]>
        ) => AiAwaitable<ReturnType<BudgetAuthority[Method]>>;
      }
    | null;
  budgetPolicy?: Pick<ReturnType<typeof createBudgetPolicy>, 'view' | 'balanceBelowFloor'> | null;
  budgetSettings?: Pick<ReturnType<typeof createBudgetSettingsStore>, 'get' | 'set'> | null;
  budgetAlerts?: Pick<ReturnType<typeof createBudgetAlertStore>, 'get' | 'mark' | 'allow' | 'pause' | 'resume'> | null;
  balance?: Pick<ReturnType<typeof createBalanceService>, 'refresh' | 'view'> | null;
}
export interface AiAssistantOptions {
  getRuntime?: () => AssistantRuntime | null | undefined;
  ownerId: string;
  location?: string;
  now?: () => Date;
  logger?: Partial<Pick<Console, 'warn' | 'error'>>;
}
