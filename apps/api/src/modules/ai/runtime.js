import { createMcpKnowledgeReadService } from './mcp-knowledge-read.ts';
import { wrapHandlersWithMaintenanceGate } from '../../infrastructure/maintenance-gate.ts';
import { createNoteActionService } from './action-service.ts';
import { createAiGateway } from './gateway.ts';
import { createDeepSeekAdapter } from './infrastructure/providers/deepseek-adapter.ts';
import { createIsolatedDeepSeekAdapter } from './isolated-provider.ts';
import { createAiWorker } from './worker.ts';
import { createIsolatedAiWorker } from './isolated-worker.ts';
import { createAiReadContextService } from './read-context-service.ts';
import { createAiAccessService } from './access-service.ts';
import { createAiConversationService } from './conversation-service.ts';
import { createAiAgentWorker } from './agent-worker.ts';
import { createAgentKnowledgeCommitService } from './agent-knowledge-commit.ts';
import { createConversationAttachmentService } from './conversation-attachments.ts';
import { createBalanceService } from './balance-service.ts';
import { createBudgetSettingsStore } from './budget-settings.ts';
import { createBudgetPolicy } from './budget-policy.ts';
import { createBudgetAlertStore } from './budget-alerts.ts';
import { createAiTranslationService } from './translation-service.ts';

/** 生成入口由 AI-01-04 的预算服务注入 authorizePaidCall 后才可启用。 */
/** @param {import('./boundary-types.ts').RuntimeOptions} [options] */
export function createAiRuntime({
  modelSettings,
  repository = null,
  accessStore = null,
  conversationStore = null,
  budgetAuthority = null,
  priceProfile = null,
  actionStore = null,
  coreOperationStore = null,
  knowledge = null,
  asyncDomain = false,
  maintenanceGate = null,
  authorizePaidCall,
  fetchImpl,
  allowExternal = false,
  contextSources = null,
  verifySources = null,
  knowledgeProposals = false,
  validateResult = null,
  providerAdapter = null,
  retrievalCandidates = null,
  webSearchAdapter = null,
  uploadsDir = null,
  balanceFile = null,
  budgetSettingsFile = null,
  budgetAlertsFile = null
} = {}) {
  if (!modelSettings || typeof modelSettings.resolveCredential !== 'function')
    throw new TypeError('Model settings service is required');
  const activeAttempts = new Set();
  const gateway = createAiGateway({
    adapter: providerAdapter ?? (fetchImpl ? createDeepSeekAdapter({ fetchImpl }) : createIsolatedDeepSeekAdapter()),
    resolveCredential: reference => modelSettings.resolveCredential(reference),
    authorizePaidCall: authorizePaidCall ?? (request => activeAttempts.delete(request.budgetAttemptId))
  });
  const readContext =
    repository && contextSources ? createAiReadContextService({ repository, ...contextSources }) : null;
  const access =
    accessStore && contextSources
      ? createAiAccessService({
          store: accessStore,
          ...contextSources,
          annotationRepository: knowledge?.repositories?.contentAnnotationRepository ?? null
        })
      : null;
  const actionService =
    actionStore && coreOperationStore && knowledge
      ? createNoteActionService({
          store: actionStore,
          core: coreOperationStore,
          knowledge,
          ownerId: contextSources.ownerId,
          conversationStore,
          accessStore,
          access,
          asyncDomain
        })
      : null;
  const actions =
    actionService && maintenanceGate
      ? wrapHandlersWithMaintenanceGate(actionService, maintenanceGate, { getAccess: () => 'read' })
      : actionService;
  // knowledgeProposals 可以是布尔值或返回布尔值的函数（读取运行时开关）；函数形式让开关切换无需重启。
  const knowledgeCommit =
    knowledgeProposals && coreOperationStore && knowledge && conversationStore && accessStore
      ? createAgentKnowledgeCommitService({
          core: coreOperationStore,
          knowledge,
          ownerId: contextSources?.ownerId,
          conversationStore,
          accessStore,
          asyncDomain
        })
      : null;
  const balance =
    balanceFile && typeof modelSettings.credentialReference === 'function'
      ? createBalanceService({
          credentialReference: () => modelSettings.credentialReference(),
          resolveCredential: reference => modelSettings.resolveCredential(reference),
          filePath: balanceFile,
          fetchImpl
        })
      : null;
  // 用户的预算设置（限额模式、自定义单价）；没有设置文件路径的运行端沿用写死的默认规则。
  const budgetSettings = budgetSettingsFile ? createBudgetSettingsStore({ filePath: budgetSettingsFile }) : null;
  const budgetAlerts = budgetAlertsFile ? createBudgetAlertStore({ filePath: budgetAlertsFile }) : null;
  const policy =
    budgetSettings && priceProfile
      ? createBudgetPolicy({ settings: budgetSettings, balance, alerts: budgetAlerts, basePriceProfile: priceProfile })
      : null;
  const agent =
    conversationStore && access && budgetAuthority && priceProfile
      ? createAiAgentWorker({
          store: conversationStore,
          access,
          modelSettings,
          budget: budgetAuthority,
          gateway,
          priceProfile,
          policy,
          allowExternal,
          retrievalCandidates,
          actions,
          webSearchAdapter,
          annotations: knowledge?.repositories?.contentAnnotationRepository ?? null,
          knowledgeProposals: knowledgeCommit ? knowledgeProposals : false,
          knowledgeCommit,
          authorizeAttempt: id => activeAttempts.add(id),
          revokeAttempt: id => activeAttempts.delete(id)
        })
      : null;
  const conversation =
    conversationStore && repository && contextSources
      ? createAiConversationService({
          store: conversationStore,
          legacyRepository: repository,
          accessStore,
          spaceRepository: contextSources.spaceRepository,
          ownerId: contextSources.ownerId,
          agent
        })
      : null;
  const attachmentService =
    conversation && uploadsDir
      ? createConversationAttachmentService({
          conversationStore,
          uploadsDir,
          ownerId: contextSources.ownerId,
          assertConversation: id => conversation.get(id)
        })
      : null;
  const attachments =
    attachmentService && maintenanceGate
      ? {
          ...wrapHandlersWithMaintenanceGate(attachmentService, maintenanceGate, {
            getAccess: name => (['upload', 'remove'].includes(name) ? 'mutation' : 'read')
          }),
          close: attachmentService.close
        }
      : attachmentService;
  // PDF 选区翻译：只发送用户选中的文字，与助手共用预算账本和单次调用授权。
  const translation =
    repository && budgetAuthority && priceProfile
      ? createAiTranslationService({
          repository,
          ownerId: contextSources?.ownerId,
          modelSettings,
          gateway,
          budget: budgetAuthority,
          priceProfile,
          policy,
          allowExternal,
          authorizeAttempt: id => activeAttempts.add(id),
          revokeAttempt: id => activeAttempts.delete(id)
        })
      : null;
  return {
    actions,
    actionStore,
    attachments,
    translation,
    generationAvailable: modelId =>
      Boolean(
        allowExternal &&
        priceProfile?.version &&
        priceProfile.modelId === modelId &&
        Number.isFinite(Date.parse(priceProfile.expiresAt))
      ),
    priceProfile,
    repository,
    accessStore,
    budgetAuthority,
    gateway,
    readContext,
    access,
    // 受信宿主（本机 MCP）保存知识候选的入口；模型与 HTTP 都拿不到。开关未开启或存储不全时为 null。
    knowledgeCommit,
    mcpKnowledgeRead:
      knowledge && accessStore
        ? createMcpKnowledgeReadService({ knowledge, ownerId: contextSources?.ownerId, accessStore, knowledgeCommit })
        : null,
    conversationStore,
    conversation,
    agent,
    worker:
      repository && budgetAuthority
        ? fetchImpl || providerAdapter
          ? createAiWorker({
              repository,
              budget: budgetAuthority,
              gateway,
              priceProfile,
              policy,
              allowExternal,
              verifySources:
                verifySources ?? (readContext ? (job, request) => readContext.verifyJobSources(job, request) : null),
              validateResult:
                validateResult ??
                (readContext ? (job, result) => readContext.validateAnswer({ jobId: job.jobId, result }) : null),
              authorizeAttempt: id => activeAttempts.add(id),
              revokeAttempt: id => activeAttempts.delete(id)
            })
          : createIsolatedAiWorker({
              repository,
              budget: budgetAuthority,
              gateway,
              modelSettings,
              readContext,
              priceProfile,
              policy,
              allowExternal
            })
        : null,
    balance,
    budgetSettings,
    budgetAlerts,
    budgetPolicy: policy,
    credentialReference: () => modelSettings.credentialReference()
  };
}

export function createUnavailableAiRuntime(reason = 'AI 功能当前不可用。') {
  return {
    actions: null,
    attachments: null,
    translation: null,
    unavailableReason: reason,
    generationAvailable: () => false,
    credentialReference: async () => null,
    repository: null,
    budgetAuthority: null,
    balance: null,
    budgetSettings: null,
    budgetAlerts: null,
    budgetPolicy: null,
    readContext: null,
    accessStore: null,
    access: null,
    knowledgeCommit: null,
    conversationStore: null,
    conversation: null,
    agent: null,
    worker: null,
    gateway: null,
    priceProfile: null
  };
}

export function createOptionalAiRuntime(
  options,
  { enabled = process.env.KNOWRA_AI_ENABLED !== '0', unavailableReason = 'AI 功能已关闭。', logger = console } = {}
) {
  if (!enabled) return createUnavailableAiRuntime(unavailableReason);
  try {
    return createAiRuntime(options);
  } catch (error) {
    logger.warn?.('AI plugin assembly failed', { code: error?.code ?? 'AI_ASSEMBLY_FAILED' });
    return createUnavailableAiRuntime('AI 组件装配失败，核心功能仍可使用。');
  }
}
