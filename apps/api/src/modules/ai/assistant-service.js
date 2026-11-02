import { randomUUID } from 'node:crypto';
import { hashRecord, manifestHash } from './record-contract.js';
import { beijingDay } from './budget-ledger.js';
import { evaluateAlerts, periodOf } from './budget-alerts.js';
import { usageCsv } from './usage-export.js';

const PREVIEW_TTL_MS = 5 * 60_000;
const MAX_PREVIEWS = 32;
/** @type {(code: string, message: string, ...ignored: Error[]) => never} */
const fail = (code, message) => {
  /** @type {Error & Partial<Pick<import('../../errors/app-error.ts').AppError, 'code'>>} */
  const error = new Error(message);
  error.code = code;
  throw error;
};
const safeCode = value => (typeof value === 'string' && /^AI_[A-Z0-9_]{1,64}$/.test(value) ? value : 'AI_TASK_FAILED');

/** HTTP 层只传递经过白名单整理的任务视图。预览请求仅在进程内短时保留。 */
export function createAiAssistantService({
  getRuntime,
  ownerId,
  location = 'server',
  now = () => new Date(),
  logger = console
}) {
  const previews = new Map();
  const runtime = () => getRuntime?.();
  const identity = async () => {
    try {
      return await runtime()?.repository?.identity();
    } catch {
      fail('AI_PRIVATE_STORAGE_UNAVAILABLE', 'AI 私有存储不可用，核心资料仍可使用。');
    }
  };
  async function appendDiagnostic(jobId, eventKind, safePayload) {
    try {
      const repository = runtime().repository;
      const sequence = (await repository.listEvents(jobId)).length + 1;
      await repository.appendEvent({ jobId, sequence, eventKind, safePayload, createdAt: now().toISOString() });
    } catch (error) {
      logger.warn?.('AI diagnostic event could not be saved', { jobId, eventKind, code: safeCode(error?.code) });
    }
  }

  function available(reference) {
    const ai = runtime();
    return Boolean(
      reference &&
      ai?.readContext &&
      ai?.worker &&
      (typeof ai.generationAvailable === 'function'
        ? ai.generationAvailable(reference.modelId)
        : ai.generationAvailable)
    );
  }

  async function readiness(reference) {
    if (!reference) return { ready: false, reason: '请先在设置中配置模型。', budget: null };
    if (!available(reference)) {
      const profile = runtime()?.priceProfile;
      const reason =
        profile?.modelId !== reference.modelId
          ? '当前模型尚未核价，请在设置中选择 deepseek-flash。'
          : '当前运行端尚未启用真实模型调用。';
      return { ready: false, reason, budget: null };
    }
    try {
      const policy = runtime().budgetPolicy;
      const plan = policy ? await policy.view() : null;
      const budget = await runtime().budgetAuthority?.status('deepseek-primary', undefined, plan?.limits);
      const expected = plan ? plan.limits.daily : 20_000_000;
      const unlimited = expected === null;
      if (
        !budget ||
        budget.accountRef !== 'deepseek-primary' ||
        !/^\d{4}-\d{2}-\d{2}$/.test(budget.day) ||
        budget.limitMicrounits !== expected ||
        !Number.isSafeInteger(budget.spentMicrounits) ||
        budget.spentMicrounits < 0 ||
        !Number.isSafeInteger(budget.heldMicrounits) ||
        budget.heldMicrounits < 0 ||
        (unlimited
          ? budget.availableMicrounits !== null
          : !Number.isSafeInteger(budget.availableMicrounits) ||
            budget.availableMicrounits < 0 ||
            budget.availableMicrounits > budget.limitMicrounits)
      ) {
        return { ready: false, reason: '预算状态无效，已阻止模型调用。', budget: null };
      }
      const view = {
        day: budget.day,
        limitMicrounits: budget.limitMicrounits,
        availableMicrounits: budget.availableMicrounits,
        spentMicrounits: budget.spentMicrounits,
        heldMicrounits: budget.heldMicrounits
      };
      const yuan = value => `${+(value / 1_000_000).toFixed(2)}`;
      if (plan?.paused?.length) {
        return {
          ready: false,
          reason: `AI 已按您的操作暂停至${plan.paused.includes('monthly') ? '下月' : '明天'}，可在费用提醒处恢复。`,
          budget: view
        };
      }
      if (!unlimited && budget.availableMicrounits === 0)
        return { ready: false, reason: `北京时间当日 ${yuan(expected)} 元预算已用完。`, budget: view };
      if (plan?.limits.monthly != null && budget.monthAvailableMicrounits === 0) {
        return { ready: false, reason: `本月 ${yuan(plan.limits.monthly)} 元预算已用完。`, budget: view };
      }
      if (policy && (await policy.balanceBelowFloor(plan.settings))) {
        return { ready: false, reason: '账户余额低于设定的下限，已暂停模型调用。', budget: view };
      }
      return { ready: true, reason: null, budget: view };
    } catch (error) {
      if (['AI_BUDGET_SETTINGS_INVALID', 'AI_BUDGET_ALERTS_INVALID'].includes(error?.code))
        return { ready: false, reason: error.message, budget: null };
      return {
        ready: false,
        reason: location === 'local' ? '本机预算账本不可用，已阻止模型调用。' : '云端预算服务不可用，已阻止模型调用。',
        budget: null
      };
    }
  }

  async function status() {
    const ai = runtime();
    let storageReason = ai?.unavailableReason ?? null;
    if (!storageReason && ai?.repository) {
      try {
        await identity();
      } catch {
        storageReason = 'AI 私有存储不可用，核心资料仍可使用。';
      }
    }
    let reference = null;
    if (!storageReason) {
      try {
        reference = (await ai?.credentialReference?.()) ?? null;
      } catch {
        storageReason = '模型凭据不可读取，AI 功能暂时不可用。';
      }
    }
    const state = storageReason ? { ready: false, reason: storageReason, budget: null } : await readiness(reference);
    const provider = ai?.gateway?.capabilities?.();
    const profile = ai?.priceProfile;
    // 价格档案超过复核日期只提示费用为估算，不阻止使用。
    const priceNotice =
      profile?.expiresAt && Date.parse(profile.expiresAt) <= now().getTime()
        ? '价格档案已超过复核日期，显示的费用为估算，可能与实际账单有差异。'
        : null;
    const simulation = provider?.provider === 'mock';
    return {
      provider: simulation ? 'mock' : 'deepseek',
      simulation,
      modelId: reference?.modelId ?? null,
      configured: Boolean(reference),
      executionLocation: location,
      generationAvailable: state.ready,
      unavailableReason: state.reason,
      budget: state.budget,
      priceNotice,
      capabilities: {
        readScopes: ['note', 'folder'],
        actions: ['answer', 'cancel', ...(ai?.actions ? ['note-plan', 'note-confirm', 'note-undo-preview'] : [])],
        responseMode: 'polling',
        writeTools: Boolean(ai?.actions),
        providerAdvertised: provider?.advertised ?? null,
        providerVerified: !simulation && provider?.verified === true
      }
    };
  }

  /** 用量汇总只读；不依赖模型是否已配置，预算账本不可用时如实报错而不是返回空数据。 */
  async function usage() {
    const authority = runtime()?.budgetAuthority;
    if (typeof authority?.usage !== 'function')
      fail('AI_BUDGET_UNAVAILABLE', location === 'local' ? '本机预算账本不可用。' : '云端预算服务不可用。');
    try {
      return { ...(await authority.usage('deepseek-primary')), location };
    } catch (error) {
      fail('AI_BUDGET_UNAVAILABLE', location === 'local' ? '本机预算账本不可用。' : '云端预算服务不可用。', error);
    }
  }

  /** 预算设置：读取与保存。保存会校验模式与金额；损坏的设置文件如实报错，不静默回到默认值。 */
  async function budgetSettings() {
    const store = runtime()?.budgetSettings;
    if (!store) fail('AI_BUDGET_SETTINGS_UNAVAILABLE', '当前运行端不支持预算设置。');
    const [settings, policy] = [await store.get(), runtime().budgetPolicy];
    return {
      ...settings,
      basePrice: policy
        ? {
            version: runtime().priceProfile.version,
            inputMicrounitsPerMillion: runtime().priceProfile.inputMicrounitsPerMillion,
            outputMicrounitsPerMillion: runtime().priceProfile.outputMicrounitsPerMillion,
            reviewedUntil: runtime().priceProfile.expiresAt
          }
        : null,
      location
    };
  }
  async function saveBudgetSettings(input) {
    const store = runtime()?.budgetSettings;
    if (!store) fail('AI_BUDGET_SETTINGS_UNAVAILABLE', '当前运行端不支持预算设置。');
    await store.set(input);
    return budgetSettings();
  }

  /** 提醒：当前周期已越过的阈值（含是否已通知/已关闭）与生效中的放行。只读，不联网。 */
  async function budgetAlerts() {
    const ai = runtime();
    if (!ai?.budgetSettings || !ai.budgetAlerts || !ai.budgetAuthority)
      fail('AI_BUDGET_SETTINGS_UNAVAILABLE', '当前运行端不支持预算提醒。');
    const settings = await ai.budgetSettings.get();
    const day = beijingDay(now());
    // 评估提醒需要“配置的上限”而不是“实际拦截的上限”，所以仅提醒的规则也要算出用量。
    const limits = {
      daily: settings.rules.daily.limitMicrounits,
      monthly: settings.rules.monthly.limitMicrounits,
      turn: null
    };
    const status = await ai.budgetAuthority.status('deepseek-primary', day, limits);
    const { marks, overrides, pauses, invalid } = await ai.budgetAlerts.get();
    // 状态文件损坏时如实告知（AI 已被阻止），由用户在界面重置，而不是当作“没有暂停”。
    if (invalid) return { day, alerts: [], rules: [], overrides: [], pauses: [], stateInvalid: true, location };
    return { ...evaluateAlerts({ settings, status, marks, overrides, pauses, day }), stateInvalid: false, location };
  }
  /** @param {{ids?: string[], kind?: string}} [input] */
  async function markAlerts({ ids, kind } = {}) {
    const store = runtime()?.budgetAlerts;
    if (!store) fail('AI_BUDGET_SETTINGS_UNAVAILABLE', '当前运行端不支持预算提醒。');
    await store.mark(ids, kind, beijingDay(now()));
    return budgetAlerts();
  }
  /** @param {{rule?: string}} [input] */
  async function allowRule({ rule } = {}) {
    const store = runtime()?.budgetAlerts;
    if (!store) fail('AI_BUDGET_SETTINGS_UNAVAILABLE', '当前运行端不支持预算提醒。');
    const day = beijingDay(now());
    await store.allow(rule, periodOf(rule === 'monthly' ? 'monthly' : 'daily', day), day);
    return budgetAlerts();
  }

  /** @param {{rule?: string}} [input] */
  async function pauseRule({ rule } = {}) {
    const store = runtime()?.budgetAlerts;
    if (!store) fail('AI_BUDGET_SETTINGS_UNAVAILABLE', '当前运行端不支持预算提醒。');
    const day = beijingDay(now());
    await store.pause(rule, periodOf(rule === 'monthly' ? 'monthly' : 'daily', day), day);
    return budgetAlerts();
  }
  /** @param {{rule?: string}} [input] */
  async function resumeRule({ rule } = {}) {
    const store = runtime()?.budgetAlerts;
    if (!store) fail('AI_BUDGET_SETTINGS_UNAVAILABLE', '当前运行端不支持预算提醒。');
    const day = beijingDay(now());
    await store.resume(rule, periodOf(rule === 'monthly' ? 'monthly' : 'daily', day), day);
    return budgetAlerts();
  }

  /** 账户余额：refresh=false 只读已保存的快照；true 才联网读取。读取失败不影响任何 AI 调用。 */
  async function balance({ refresh = false } = {}) {
    const service = runtime()?.balance;
    if (!service) fail('AI_BALANCE_UNSUPPORTED', '当前运行端未提供余额读取。');
    return { ...(await (refresh ? service.refresh() : service.view())), location };
  }

  /** 导出全部用量明细（CSV 文本）。 */
  async function usageExport() {
    const authority = runtime()?.budgetAuthority;
    if (typeof authority?.usageRows !== 'function')
      fail('AI_BUDGET_UNAVAILABLE', location === 'local' ? '本机预算账本不可用。' : '云端预算服务不可用。');
    try {
      return usageCsv(await authority.usageRows('deepseek-primary'));
    } catch {
      fail('AI_BUDGET_UNAVAILABLE', location === 'local' ? '本机预算账本不可用。' : '云端预算服务不可用。');
    }
  }

  /**
   * 手动处理“结果未知”的请求：用户对照 DeepSeek 余额或账单后，选择“释放”（确认没有产生费用）
   * 或“按实际金额结算”。只对状态为 unknown 的请求有效，已结算的不能改。
   */
  /** @param {Pick<import('./boundary-types.ts').BudgetSettlement, 'attemptId' | 'disposition' | 'actualMicrounits'>} [input] */
  async function resolveUnknown({ attemptId, disposition, actualMicrounits } = {}) {
    const authority = runtime()?.budgetAuthority;
    if (!authority)
      fail('AI_BUDGET_UNAVAILABLE', location === 'local' ? '本机预算账本不可用。' : '云端预算服务不可用。');
    if (
      typeof attemptId !== 'string' ||
      !/^[a-zA-Z0-9_.:-]{1,128}$/.test(attemptId) ||
      !['released', 'settled'].includes(disposition) ||
      (disposition === 'settled' && !(Number.isSafeInteger(actualMicrounits) && actualMicrounits >= 0)) ||
      (disposition === 'released' && actualMicrounits !== undefined && actualMicrounits !== null)
    ) {
      fail('AI_BUDGET_SETTLEMENT_INVALID', '处理请求无效。');
    }
    const summary = await authority.usage('deepseek-primary');
    if (!summary.unknown.some(row => row.attemptId === attemptId))
      fail('AI_BUDGET_NOT_FOUND', '没有找到这条结果未知的请求，可能已被处理。');
    await authority.settle({
      accountRef: 'deepseek-primary',
      attemptId,
      disposition,
      ...(disposition === 'settled' ? { actualMicrounits } : {})
    });
    return usage();
  }

  async function assertJob(jobId) {
    const ai = runtime();
    const current = await identity();
    const job = await ai?.repository?.get('aiJob', jobId);
    if (
      !job ||
      job.ownerId !== ownerId ||
      job.datasetId !== current?.datasetId ||
      job.datasetEpoch !== current?.datasetEpoch ||
      job.jobKind !== 'answer'
    ) {
      fail('AI_JOB_NOT_FOUND', '任务不存在或资料集已切换。');
    }
    return job;
  }

  async function view(job, detailed = false) {
    const base = {
      jobId: job.jobId,
      spaceId: job.spaceId,
      question: job.question ?? null,
      status: job.status,
      phase: job.phase,
      modelId: job.modelId,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt
    };
    if (!detailed) return base;
    const [manifest, events] = await Promise.all([
      runtime().repository.get('contextManifest', job.manifestId),
      runtime().repository.listEvents(job.jobId)
    ]);
    return {
      ...base,
      result: job.status === 'succeeded' ? (job.resultJson ?? null) : null,
      diagnostics: events.map(({ sequence, eventKind, safePayload, createdAt }) => ({
        sequence,
        eventKind,
        safePayload,
        createdAt
      })),
      sources:
        manifest?.sources.map(({ sourceId, noteId, noteVersionId, start, end }) => ({
          sourceId,
          noteId,
          noteVersionId,
          start,
          end
        })) ?? [],
      omissions: manifest?.omissions ?? []
    };
  }

  async function list(spaceId) {
    if (typeof spaceId !== 'string' || !spaceId) fail('AI_SCOPE_INVALID', '请选择知识空间。');
    const ai = runtime();
    if (!ai?.repository) return [];
    const current = await identity();
    const jobs = await ai.repository.list('aiJob', {
      ownerId,
      datasetId: current.datasetId,
      datasetEpoch: current.datasetEpoch,
      spaceId,
      jobKind: 'answer'
    });
    return Promise.all(
      jobs
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, 50)
        .map(job => view(job))
    );
  }

  async function get(jobId) {
    return view(await assertJob(jobId), true);
  }

  async function preview(input) {
    const ai = runtime();
    if (ai?.unavailableReason) fail('AI_GENERATION_UNAVAILABLE', ai.unavailableReason);
    await identity();
    const reference = await ai?.credentialReference?.();
    if (!reference || !ai?.readContext) fail('AI_NOT_CONFIGURED', '请先在设置中配置模型。');
    const prepared = await ai.readContext.prepareRead({
      spaceId: input?.spaceId,
      scope: input?.scope,
      question: input?.question,
      modelId: reference.modelId,
      credentialRef: reference.credentialRef
    });
    for (const [id, item] of previews) if (item.expiresAt <= now().getTime()) previews.delete(id);
    if (previews.size >= MAX_PREVIEWS) previews.delete(previews.keys().next().value);
    const previewId = randomUUID();
    const expiresAt = now().getTime() + PREVIEW_TTL_MS;
    previews.set(previewId, { prepared, expiresAt, credentialRef: reference.credentialRef });
    return {
      previewId,
      expiresAt: new Date(expiresAt).toISOString(),
      scopeHash: prepared.scopeSnapshot.scopeHash,
      payloadHash: prepared.manifest.payloadHash,
      ...prepared.preview
    };
  }

  async function start(input) {
    const reference = await runtime()?.credentialReference?.();
    const state = await readiness(reference);
    if (!state.ready) fail('AI_GENERATION_UNAVAILABLE', state.reason);
    const item = previews.get(input?.previewId);
    if (!item || item.expiresAt <= now().getTime()) fail('AI_PREVIEW_EXPIRED', '预览已过期，请重新预览。');
    if (
      input.scopeHash !== item.prepared.scopeSnapshot.scopeHash ||
      input.payloadHash !== item.prepared.manifest.payloadHash
    )
      fail('AI_APPROVAL_STALE', '确认范围与预览不一致。');
    if (typeof input.idempotencyKey !== 'string' || !/^[a-zA-Z0-9-]{8,80}$/.test(input.idempotencyKey)) {
      fail('AI_REQUEST_INVALID', '任务幂等键无效。');
    }
    const ai = runtime();
    if (reference?.credentialRef !== item.credentialRef) fail('AI_CREDENTIAL_STALE', '模型配置已改变，请重新预览。');
    previews.delete(input.previewId);
    const { manifest, grant, request } = await ai.readContext.authorizeRead({
      prepared: item.prepared,
      actorId: ownerId,
      approvedScopeHash: input.scopeHash,
      approvedPayloadHash: input.payloadHash
    });
    const timestamp = now().toISOString();
    const question = JSON.parse(request.messages[1].content).question;
    const job = await ai.repository.insert('aiJob', {
      contractVersion: 1,
      kind: 'aiJob',
      jobId: randomUUID(),
      requestId: randomUUID(),
      parentJobId: null,
      ownerId,
      datasetId: grant.datasetId,
      datasetEpoch: grant.datasetEpoch,
      spaceId: grant.spaceId,
      grantId: grant.grantId,
      jobKind: 'answer',
      idempotencyKey: input.idempotencyKey,
      inputHash: hashRecord({ question, payloadHash: manifest.payloadHash }),
      manifestId: manifest.manifestId,
      manifestHash: manifestHash(manifest),
      credentialRef: request.credentialRef,
      provider: 'deepseek',
      modelId: request.modelId,
      promptVersion: 'p1-read-v1',
      resultSchemaVersion: 'p1-answer-v1',
      status: 'pending',
      phase: 'preparing',
      acceptedAttemptId: null,
      outputHash: null,
      question,
      createdAt: timestamp,
      updatedAt: timestamp
    });
    await appendDiagnostic(job.jobId, 'taskCreated', { phase: 'preparing', status: 'pending' });
    queueMicrotask(() => {
      void ai.worker
        .run(job.jobId, request)
        .catch(async error => {
          const current = await ai.repository.get('aiJob', job.jobId);
          if (current && ['pending', 'retrying'].includes(current.status)) {
            await ai.repository.replace(
              'aiJob',
              {
                ...current,
                status: 'failed',
                phase: 'finished',
                updatedAt: new Date(Math.max(now().getTime(), Date.parse(current.updatedAt) + 1)).toISOString()
              },
              hashRecord(current)
            );
          }
          await appendDiagnostic(job.jobId, 'taskFailed', {
            code: safeCode(error?.code),
            status: 'failed'
          });
          logger.warn?.('AI assistant task failed', { jobId: job.jobId, code: safeCode(error?.code) });
        })
        .catch(error =>
          logger.error?.('AI task failure could not be persisted', { jobId: job.jobId, code: safeCode(error?.code) })
        );
    });
    return view(job, true);
  }

  async function cancel(jobId) {
    await assertJob(jobId);
    return view(await runtime().worker.cancel(jobId), true);
  }

  return {
    status,
    usage,
    usageExport,
    resolveUnknown,
    balance,
    budgetSettings,
    saveBudgetSettings,
    budgetAlerts,
    markAlerts,
    allowRule,
    pauseRule,
    resumeRule,
    list,
    get,
    preview,
    start,
    cancel
  };
}
