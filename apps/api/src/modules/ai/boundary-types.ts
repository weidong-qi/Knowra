import type { createAiAccessService } from './access-service.ts';
import type { createAiGateway } from './gateway.ts';
import type { AiAnswerResult, AiJob, AiRecordRepositoryPort } from './record-types.ts';
import type { createJsonBudgetAuthority } from './budget-ledger.ts';
import type { createBudgetPolicy } from './budget-policy.ts';
import type { createModelSettingsService } from './model-settings.ts';
import type { createAiConversationStore } from './conversation-store.ts';
import type { createNoteActionService } from './action-service.ts';
import type { createAgentKnowledgeCommitService } from './agent-knowledge-commit.ts';
import type { createKnowledgeModule } from '../knowledge/index.js';
import type { createAiAccessStore } from './access-records.ts';

export type AccessService = ReturnType<typeof createAiAccessService>;
export type Gateway = ReturnType<typeof createAiGateway>;
export type GatewayResult = Awaited<ReturnType<Gateway['complete']>>;
export interface PriceProfile {
  version: string;
  modelId?: string;
  expiresAt: string;
  inputMicrounitsPerMillion: number;
  outputMicrounitsPerMillion: number;
  inputCacheHitMicrounitsPerMillion?: number | null;
}
export interface BudgetLimits {
  daily: number | null;
  monthly: number | null;
  turn: number | null;
}
export interface WorkerOptions {
  repository?: Pick<
    AiRecordRepositoryPort,
    'identity' | 'get' | 'list' | 'insert' | 'replace' | 'appendEvent' | 'listEvents'
  >;
  budget?: Pick<ReturnType<typeof createJsonBudgetAuthority>, 'reserve' | 'settle'>;
  gateway?: Gateway;
  priceProfile?: PriceProfile;
  accountRef?: string;
  workerId?: string;
  now?: () => Date;
  allowExternal?: boolean;
  authorizeAttempt?: (attemptId: string) => void;
  revokeAttempt?: (attemptId: string) => void;
  verifySources?: ReturnType<typeof import('./read-context-service.ts').createAiReadContextService>['verifyJobSources'];
  validateResult?: (job: Pick<AiJob, 'jobId'>, result: GatewayResult) => Promise<AiAnswerResult>;
  logger?: Pick<Console, 'warn' | 'error'>;
  policy?: ReturnType<typeof createBudgetPolicy>;
  limits?: BudgetLimits;
}
export interface CandidateReference {
  noteId: string;
  noteVersionId: string;
  contentHash: string;
}
export interface CandidateSource {
  searchCandidates(input: {
    query: string;
    limit: number;
    authorized: CandidateReference[];
    signal: AbortSignal;
  }): Promise<{
    candidates: (CandidateReference & { start: number; end: number; score: number })[];
    truncated: boolean;
  }>;
}
export interface RetrievalOptions {
  access?: AccessService;
  candidateSource?: CandidateSource | null;
  candidateTimeoutMs?: number;
}
export interface KeywordSearchOptions {
  access?: AccessService;
  maxCandidates?: number;
  maxNoteChars?: number;
  maxScanNotes?: number;
  maxScanChars?: number;
}
export interface AgentWorkerOptions {
  store?: ReturnType<typeof createAiConversationStore>;
  access?: AccessService;
  modelSettings?: ReturnType<typeof createModelSettingsService>;
  budget?: WorkerOptions['budget'];
  gateway?: Gateway;
  priceProfile?: PriceProfile;
  policy?: WorkerOptions['policy'];
  allowExternal?: boolean;
  authorizeAttempt?: WorkerOptions['authorizeAttempt'];
  revokeAttempt?: WorkerOptions['revokeAttempt'];
  accountRef?: string;
  now?: () => Date;
  logger?: Pick<Console, 'warn' | 'error'>;
  retrievalCandidates?: CandidateSource;
  actions?: ReturnType<typeof createNoteActionService>;
  webSearchAdapter?: Parameters<typeof import('./assistant-tools.ts').createAssistantWebSearch>[0];
  annotations?: ReturnType<typeof createKnowledgeModule>['repositories']['contentAnnotationRepository'];
  knowledgeProposals?: boolean | (() => boolean);
  knowledgeCommit?: ReturnType<typeof createAgentKnowledgeCommitService>;
}
export interface CapabilityProbeOptions {
  gateway?: Gateway;
  credentialRef?: string;
  modelId?: string;
}
export interface McpKnowledgeReadOptions {
  knowledge?: ReturnType<typeof createKnowledgeModule>;
  ownerId?: string;
  accessStore?: ReturnType<typeof createAiAccessStore>;
  knowledgeCommit?: ReturnType<typeof createAgentKnowledgeCommitService>;
}
export interface BudgetSettlement {
  accountRef?: string;
  attemptId?: string;
  actualMicrounits?: number | null;
  disposition?: string;
  usage?: {
    modelId?: string;
    conversationId?: string;
    inputTokens?: number;
    outputTokens?: number;
    cacheHitTokens?: number | null;
  };
}
export interface RuntimeOptions {
  modelSettings?: ReturnType<typeof createModelSettingsService>;
  repository?: WorkerOptions['repository'];
  accessStore?: ReturnType<typeof createAiAccessStore>;
  conversationStore?: AgentWorkerOptions['store'];
  budgetAuthority?: ReturnType<typeof createJsonBudgetAuthority>;
  priceProfile?: PriceProfile;
  actionStore?: Parameters<typeof createNoteActionService>[0]['store'];
  coreOperationStore?: Parameters<typeof createNoteActionService>[0]['core'];
  knowledge?: ReturnType<typeof createKnowledgeModule>;
  asyncDomain?: boolean;
  maintenanceGate?: Parameters<
    typeof import('../../infrastructure/maintenance-gate.ts').wrapHandlersWithMaintenanceGate
  >[1];
  authorizePaidCall?: Parameters<typeof createAiGateway>[0]['authorizePaidCall'];
  fetchImpl?: typeof fetch;
  allowExternal?: boolean;
  contextSources?: import('./access-service-types.ts').ReadRepositories;
  verifySources?: WorkerOptions['verifySources'];
  validateResult?: WorkerOptions['validateResult'];
  knowledgeProposals?: AgentWorkerOptions['knowledgeProposals'];
  providerAdapter?: Parameters<typeof createAiGateway>[0]['adapter'];
  retrievalCandidates?: CandidateSource;
  webSearchAdapter?: AgentWorkerOptions['webSearchAdapter'];
  uploadsDir?: string;
  balanceFile?: string;
  budgetSettingsFile?: string;
  budgetAlertsFile?: string;
}
export interface ProviderMessage {
  type: string;
  id?: number;
  request?: Parameters<
    ReturnType<typeof import('./infrastructure/providers/deepseek-adapter.ts').createDeepSeekAdapter>['complete']
  >[0];
  result?: unknown;
  error?: { code?: string; message?: string; retryable?: boolean; httpStatus?: number };
  rssBytes?: number;
  cpuMs?: number;
}
export interface WorkerMessage extends ProviderMessage {
  jobId?: string;
  priceProfile?: PriceProfile;
  budgetLimits?: BudgetLimits;
  allowExternal?: boolean;
}
export interface ExtractionGatewayOptions extends NonNullable<
  Parameters<typeof import('../knowledge/application/knowledge-extraction-contract.ts').prepareKnowledgeExtraction>[0]
> {
  maxTokens?: number;
}
export interface ExtractionGatewayResultOptions {
  extractionRequest?: ReturnType<
    typeof import('../knowledge/application/knowledge-extraction-contract.ts').prepareKnowledgeExtraction
  >;
  result?: Pick<GatewayResult, 'refused' | 'truncated' | 'finishReason' | 'toolCalls' | 'content'>;
}
export interface ToolOutcome {
  sourceRefs: import('./access-service-types.ts').SourceReference[];
  truncated: boolean;
  fallback: boolean;
  inspected: number;
  actionId?: string;
  catalog?: boolean;
  progress?: boolean;
  external?: { hits: unknown };
  errorCode?: string;
  hint?: string;
}
export interface GatewayOptions {
  adapter: Omit<
    ReturnType<typeof import('./infrastructure/providers/deepseek-adapter.ts').createDeepSeekAdapter>,
    'complete'
  > & {
    deferredSendValidation?: boolean;
    complete(
      request: import('./infrastructure/providers/deepseek-adapter.ts').ProviderRequest,
      control?: { verifyBeforeSend?: () => unknown; onSend?: () => void; expiresAt?: number }
    ): Promise<unknown>;
  };
  resolveCredential?: (reference: string) => Promise<{ apiKey: string; modelId: string }>;
  authorizePaidCall?: (request: { budgetAttemptId?: string }) => boolean | Promise<boolean>;
}
export interface ProposalInput {
  access: AccessService;
  grantId: string;
  args: unknown;
  sourceRefs: import('./access-service-types.ts').SourceReference[];
  turnId: string;
  callId: string;
}
export interface KnowledgeProposalOptions extends ProposalInput {
  commit?: {
    find: () => Promise<{
      requestId: string;
      candidates: object[];
      citedRanges?: { noteId: string; start: number; end: number }[];
    } | null>;
    save: (
      plan: Awaited<ReturnType<typeof import('./knowledge-propose-tool.ts').buildKnowledgeProposalPlan>>
    ) => Promise<void | import('../../infrastructure/core-operation-types.ts').CoreOperationReceipt>;
  } | null;
}
