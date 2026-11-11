import { authorizeTaskMcpContext } from './mcp/task-access.mjs';
import { inspectAttachmentDeletion } from '../../api/src/infrastructure/attachment-deletion-preflight.ts';
import { createAppError } from '../../api/src/errors/app-error.ts';
import path from 'node:path';
import { createAttachmentTransfer } from '../../api/src/modules/sync/attachment-transfer.ts';
import { createAppContext } from '../../api/src/app.factory.ts';
import { createServer } from '../../api/src/server.ts';
import { createSqliteDataStore } from './sqlite-data-store.mjs';
import { createSyncEngine } from './sync-engine.mjs';
import { createRuntimeBackup } from './backup.mjs';
import { createNoteVersionDiscardGate } from './note-version-discard-gate.mjs';
import { createOptionalAiRuntime, createUnavailableAiRuntime } from '../../api/src/modules/ai/runtime.ts';
import { aiRuntimeLifecycle } from '../../api/src/modules/ai/runtime-lifecycle.ts';
import { reviewedDeepSeekPriceProfile } from '../../api/src/modules/ai/reviewed-price-profile.ts';
import { createLocalBudgetAuthority } from './local-budget-authority.mjs';
import { createAiFeatureSettings } from '../../api/src/modules/ai/feature-settings.ts';

/** 每次切换资料库都重建应用服务，避免 repository 留存旧 SQLite/内存引用。 */
export function createRuntimeServices({
  dataDirectory,
  budgetDirectory = dataDirectory,
  backupRoot = dataDirectory,
  logger = console,
  syncOptions = {},
  credentialSource = null,
  aiRuntimeFactory = createOptionalAiRuntime
}) {
  const store = createSqliteDataStore(path.join(dataDirectory, 'local.sqlite'));
  try {
    const context = createAppContext({
      dataStore: store,
      storageRootDir: dataDirectory,
      uploadsDir: path.join(dataDirectory, 'uploads'),
      ownerId: 'demo',
      authorizeTaskWorkspace: (ctx, scope) =>
        ctx.actor?.kind === 'user' ? ctx.actor.id === 'demo' : authorizeTaskMcpContext(ctx, scope),
      // 连续自动保存只保留检查点，避免历史版本随编辑时长无限增长。
      noteVersionCoalescing: { canDiscard: createNoteVersionDiscardGate(store) }
    });
    // 复用业务规则，但本地更新时间不能在同一毫秒内重复。
    const noteService = context.modules.knowledge.noteService;
    const updateNote = noteService.updateNote.bind(noteService);
    noteService.updateNote = (id, updates) =>
      updateNote(id, {
        ...updates,
        updatedAt: new Date(
          Math.max(Date.now(), Date.parse(noteService.getNote(id, { includeDeleted: true }).updatedAt) + 1)
        ).toISOString()
      });
    // 保留本地来源版本的稳定 ID；列表对相同正文去重，优先展示已确认的云端版本。
    const listVersions = context.http.knowledge.listNoteVersions;
    context.http.knowledge.listNoteVersions = (...args) =>
      store.readSync(db => {
        const remoteIds = new Set(
          db
            .prepare("SELECT id FROM sync_base WHERE collection = 'noteVersions' AND payload != 'null'")
            .all()
            .map(row => row.id)
        );
        const versions = listVersions(...args);
        if (!Array.isArray(versions)) return versions;
        const selected = new Map();
        for (const version of versions) {
          const previous = selected.get(version.contentHash);
          if (!previous || (!remoteIds.has(previous.id) && remoteIds.has(version.id)))
            selected.set(version.contentHash, version);
        }
        return versions.filter(version => selected.get(version.contentHash)?.id === version.id);
      });
    const entityTransfer = createAttachmentTransfer({
      allowRepair: true,
      uploadsDir: path.join(dataDirectory, 'uploads'),
      storageRootDir: dataDirectory
    });
    const renameAttachment = context.http.storage.updateAttachment;
    context.http.storage.updateAttachment = (params, body) => {
      const attachment = store.state.attachments.find(item => item.id === params.id);
      if (attachment) entityTransfer.read(attachment);
      return renameAttachment(params, body);
    };
    context.http.storage.deleteAttachment = params =>
      store.runTransaction(() => {
        if (inspectAttachmentDeletion(params.id, store.state).references.length) {
          throw createAppError('ATTACHMENT_REFERENCED', '保留的资产仍引用此附件，不能删除。', 409);
        }
        const index = store.state.attachments.findIndex(item => item.id === params.id);
        if (index < 0) throw createAppError('ATTACHMENT_NOT_FOUND', '附件不存在。', 404);
        const [attachment] = store.state.attachments.splice(index, 1);
        // 同步确认与备份完成前保留文件，删除只产生元数据墓碑。
        store.flush();
        return { ...attachment, cleanup: 'retained-local' };
      });
    const sync = createSyncEngine(store, {
      ...syncOptions,
      noteService,
      entityTransfer,
      createRecoveryBackup: () =>
        createRuntimeBackup(store, dataDirectory, { backupRoot, purpose: 'sync-safety-recovery' })
    });
    // AI 功能开关保存在本机数据目录，与钥匙串里的模型凭据分开；每个提炼回合开始时读取当前值，切换无需重启。
    const aiFeatures = createAiFeatureSettings({ filePath: path.join(dataDirectory, 'ai-features.json') });
    context.http.aiFeatures = aiFeatures;
    const modelSettings = credentialSource ?? {
      credentialReference: async () => null,
      resolveCredential: async () => {
        throw new Error('请先在 Mac 应用设置中配置模型。');
      }
    };
    const aiEnabled = !store.aiRuntimeError && process.env.KNOWRA_AI_ENABLED !== '0';
    const aiUnavailableReason = store.aiRuntimeError ? 'AI 私有存储无效，核心资料仍可使用。' : 'AI 功能已关闭。';
    if (!aiEnabled) context.ai = createUnavailableAiRuntime(aiUnavailableReason);
    else
      try {
        context.ai = aiRuntimeFactory(
          {
            modelSettings,
            repository: store.aiRepository,
            accessStore: store.aiAccessStore,
            uploadsDir: path.join(dataDirectory, 'uploads'),
            // 余额快照、预算设置、提醒状态与预算账本一样放在数据目录根，不随恢复备份切换的资料目录重置。
            balanceFile: path.join(budgetDirectory, 'ai-balance.json'),
            budgetSettingsFile: path.join(budgetDirectory, 'ai-budget-settings.json'),
            budgetAlertsFile: path.join(budgetDirectory, 'ai-budget-alerts.json'),
            conversationStore: store.aiConversationStore,
            actionStore: store.aiActionStore,
            coreOperationStore: context.coreOperationStore,
            knowledge: context.modules.knowledge,
            // 预算账本在本机：不依赖云端，断网或未连接云端也可调用模型；放在数据目录根下，不随恢复备份切换的资料目录重置。
            budgetAuthority: createLocalBudgetAuthority({ filePath: path.join(budgetDirectory, 'ai-budget.json') }),
            priceProfile: reviewedDeepSeekPriceProfile,
            allowExternal: process.env.KNOWRA_AI_EGRESS_ENABLED !== '0',
            knowledgeProposals: async () => (await aiFeatures.get()).knowledgeProposals,
            contextSources: {
              ...context.modules.knowledge.repositories,
              spaceRepository: context.modules.knowledge.repositories.knowledgeSpaceRepository,
              ownerId: 'demo'
            }
          },
          { enabled: true, unavailableReason: aiUnavailableReason, logger }
        );
      } catch {
        logger.warn?.('AI plugin assembly failed', { code: 'AI_ASSEMBLY_FAILED' });
        context.ai = createUnavailableAiRuntime('AI 组件装配失败，核心资料仍可使用。');
      }
    context.aiOwnerId = 'demo';
    context.aiLocation = 'local';
    const aiLifecycle = aiRuntimeLifecycle(context.ai);
    const configureSync = sync.configure.bind(sync);
    sync.configure = async input => {
      const result = await configureSync(input);
      await aiLifecycle.recover(['worker']).catch(error => {
        logger.warn?.('AI task recovery deferred', { code: error.code ?? 'AI_RECOVERY_FAILED' });
      });
      await aiLifecycle.recover(['agent']).catch(error => {
        logger.warn?.('AI agent recovery deferred', { code: error.code ?? 'AI_RECOVERY_FAILED' });
      });
      await aiLifecycle.recover(['translation']).catch(error => {
        logger.warn?.('AI translation recovery deferred', { code: error.code ?? 'AI_RECOVERY_FAILED' });
      });
      return result;
    };
    const apiServer = createServer({ appContext: context, logger });
    const handleApi = apiServer.listeners('request')[0];
    // 先完成同步装配再启动恢复；并发恢复的一支失败不能提前结束整体等待。
    const recoverAi = Promise.allSettled(
      ['attachments', 'conversation', 'agent', 'worker', 'translation'].map(stage => aiLifecycle.recover([stage]))
    ).then(results => {
      const failed = results.find(result => result.status === 'rejected');
      if (failed) logger.warn?.('AI task recovery deferred', { code: failed.reason?.code ?? 'AI_BUDGET_UNAVAILABLE' });
    });
    return {
      store,
      sync,
      handleApi,
      recoverAi,
      closeAi: aiLifecycle.close,
      getAi: () => context.ai,
      getAiFeatures: () => aiFeatures,
      getTaskService: () => (store.taskWorkspaceStore ? context.taskWorkspaces : null),
      getTaskIdentity: () => store.taskWorkspaceStore?.identity() ?? null,
      getAnnotations: () => context.modules.knowledge?.repositories?.contentAnnotationRepository ?? null
    };
  } catch (error) {
    store.close();
    throw error;
  }
}
