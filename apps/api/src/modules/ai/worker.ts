import type { AppError } from '../../errors/app-error.ts';
import type { WorkerOptions, PriceProfile } from './boundary-types.ts';
import type { GatewayRequest } from './gateway.ts';
import type { AiMutableRecordKind, AiRecordByKind, AiJob, AiEventPayload } from './record-types.ts';

interface BillableUsage {
  inputTokens?: number | null;
  outputTokens?: number | null;
  cacheHitTokens?: number | null;
}

interface QuoteOptions {
  request: GatewayRequest;
  priceProfile?: PriceProfile;
  now?: Date;
  writeToolName?: string | null;
  assistantTools?: boolean;
}

import { randomUUID } from 'node:crypto';
import { hashRecord } from './record-contract.ts';
import { beijingDay } from './budget-ledger.ts';
import { normalizeAiRequest } from './gateway.ts';
import { outboundPayloadHash, serializedDeepSeekPayload } from './outbound-payload.ts';

const MAX_ATTEMPTS = 4;
const MAX_INPUT_TOKENS = 100_000;
const MAX_OUTPUT_TOKENS = 20_000;
const LEASE_MS = 120_000;
const allowedTools = new Set(['notes_search', 'notes_read']);
function fail(code: string, message: string): never {
  const error = new Error(message) as AppError;
  error.code = code;
  throw error;
}
function later(now: Date, previous: string) {
  return new Date(Math.max(now.getTime(), Date.parse(previous) + 1)).toISOString();
}
const nonnegative = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;

/** 实际费用：自定义单价带缓存命中价时，命中部分按命中价；否则全部按未命中价（与预留口径一致）。 */
export function actualCostMicrounits(usage: BillableUsage, profile: PriceProfile) {
  const hitPrice = profile.inputCacheHitMicrounitsPerMillion;
  const hit =
    Number.isSafeInteger(hitPrice) && Number.isSafeInteger(usage.cacheHitTokens)
      ? Math.min(usage.cacheHitTokens!, usage.inputTokens!)
      : 0;
  return Math.ceil(
    ((usage.inputTokens! - hit) * profile.inputMicrounitsPerMillion +
      hit * (hit ? hitPrice! : 0) +
      usage.outputTokens! * profile.outputMicrounitsPerMillion) /
      1_000_000
  );
}

/** 价格配置由受信部署代码提供；过期或缺失时拒绝付费调用。 */
export function quoteWorstCase({
  request,
  priceProfile,
  now = new Date(),
  writeToolName = null,
  assistantTools = false
}: QuoteOptions) {
  // expiresAt 是“建议复核日期”：过期只标记 priceStale 提示费用可能不准，不再阻止调用；档案缺失或数值无效仍拒绝。
  if (
    !priceProfile?.version ||
    !Number.isFinite(Date.parse(priceProfile.expiresAt)) ||
    !nonnegative(priceProfile.inputMicrounitsPerMillion) ||
    !nonnegative(priceProfile.outputMicrounitsPerMillion)
  ) {
    fail('AI_PRICE_UNAVAILABLE', '当前价格配置不可用，已阻止模型调用。');
  }
  if (
    !request ||
    !Array.isArray(request.messages) ||
    !Number.isSafeInteger(request.maxTokens) ||
    request.maxTokens! < 1 ||
    request.maxTokens! > MAX_OUTPUT_TOKENS ||
    !Array.isArray(request.tools) ||
    request.tools.length > 11 ||
    request.tools.some(
      tool =>
        !allowedTools.has(tool.name) &&
        !(
          assistantTools &&
          [
            'notes_create',
            'notes_append',
            'notes_propose_patch',
            'notes_propose_organize',
            'web_search',
            'annotations_list',
            'knowledge_propose',
            'folders_list',
            'notes_list'
          ].includes(tool.name)
        ) &&
        !(
          tool.name === writeToolName &&
          ['notes_create', 'notes_append', 'notes_propose_patch', 'notes_propose_organize'].includes(writeToolName!)
        )
    )
  )
    fail('AI_REQUEST_LIMIT', '模型调用超过 P1 边界。');
  if (priceProfile.modelId && request.modelId !== priceProfile.modelId) {
    fail('AI_PRICE_UNAVAILABLE', '当前模型没有经过核价，已阻止付费调用。');
  }
  // 以实际发送的完整 JSON 请求体字节数作保守输入上界，包含工具 schema 等元数据。
  const normalized = normalizeAiRequest(request);
  const outbound = { ...normalized, modelId: request.modelId };
  const serialized = serializedDeepSeekPayload(outbound);
  const inputUpperBound = Buffer.byteLength(serialized, 'utf8');
  if (inputUpperBound > MAX_INPUT_TOKENS) fail('AI_REQUEST_LIMIT', '输入超过单任务 token 上限。');
  const estimate = Math.ceil(
    (inputUpperBound * priceProfile.inputMicrounitsPerMillion +
      request.maxTokens! * priceProfile.outputMicrounitsPerMillion) /
      1_000_000
  );
  // 两倍预留缓冲供应商 token 计数与价格差异；仍受 2 元任务上限限制。
  const reservedMicrounits = Math.max(1, estimate * 2);
  if (reservedMicrounits > 2_000_000) fail('AI_JOB_BUDGET_EXCEEDED', '最坏费用超过任务预留上限。');
  return {
    reservedMicrounits,
    inputUpperBound,
    payloadHash: outboundPayloadHash(outbound),
    priceStale: Date.parse(priceProfile.expiresAt) <= now.getTime()
  };
}

export function createAiWorker({
  repository,
  budget,
  gateway,
  priceProfile: baseProfile,
  accountRef = 'deepseek-primary',
  workerId = randomUUID(),
  now = () => new Date(),
  allowExternal = false,
  authorizeAttempt = () => {},
  revokeAttempt = () => {},
  verifySources = null,
  validateResult = null,
  logger = console,
  policy = null,
  limits: fixedLimits = undefined
}: WorkerOptions = {}) {
  if (!repository || !budget || !gateway) throw new TypeError('AI Worker needs repository, budget and gateway');
  const controllers = new Map<string, AbortController>();

  // 初始化检查已保证依赖存在；嵌套异步函数沿用同一实例。
  async function replace<Kind extends AiMutableRecordKind>(
    kind: Kind,
    previous: AiRecordByKind[Kind],
    patch: Partial<AiRecordByKind[Kind]>
  ) {
    const next = { ...previous, ...patch };
    if (kind === 'aiJob') (next as AiJob).updatedAt = later(now(), (previous as AiJob).updatedAt);
    return repository!.replace(kind, next, hashRecord(previous));
  }
  async function recordEvent(jobId: string, eventKind: string, safePayload: AiEventPayload) {
    try {
      const sequence = (await repository!.listEvents(jobId)).length + 1;
      await repository!.appendEvent({ jobId, sequence, eventKind, safePayload, createdAt: now().toISOString() });
    } catch (error) {
      // 诊断写入不能改变模型调用、预算结算或任务状态。
      logger.warn?.('AI diagnostic event could not be saved', {
        jobId,
        eventKind,
        code: safeCode((error as Partial<Pick<AppError, 'code'>> | null)?.code)
      });
    }
  }
  async function validBoundary(job: AiJob) {
    const identity = await repository!.identity();
    const grant = await repository!.get('aiGrant', job.grantId);
    const manifest = await repository!.get('contextManifest', job.manifestId);
    if (
      !grant ||
      !manifest ||
      job.datasetId !== identity.datasetId ||
      job.datasetEpoch !== identity.datasetEpoch ||
      grant.datasetEpoch !== identity.datasetEpoch ||
      grant.revokedAt ||
      Date.parse(grant.expiresAt) <= now().getTime() ||
      manifest.datasetEpoch !== identity.datasetEpoch ||
      job.manifestHash !== hashRecord(manifest)
    ) {
      fail('AI_GRANT_STALE', '任务授权或资料集已失效。');
    }
    return { grant, manifest };
  }
  async function cancel(jobId: string) {
    const job = await repository!.get('aiJob', jobId);
    if (!job) fail('AI_JOB_NOT_FOUND', '任务不存在。');
    if (['cancelled', 'succeeded', 'failed'].includes(job.status)) return job;
    const next = job.status === 'cancelling' ? job : await replace('aiJob', job, { status: 'cancelling' });
    controllers.get(jobId)?.abort();
    if (['pending', 'retrying'].includes(job.status))
      return replace('aiJob', next, { status: 'cancelled', phase: 'finished' });
    return next;
  }
  async function recover() {
    const identity = await repository!.identity();
    const jobs = await repository!.list('aiJob', { jobKind: 'answer' });
    let changed = 0;
    for (const job of jobs) {
      if (job.datasetId !== identity.datasetId || job.datasetEpoch !== identity.datasetEpoch) continue;
      if (['pending', 'retrying'].includes(job.status)) {
        await replace('aiJob', job, { status: 'failed', phase: 'finished' });
        changed++;
        continue;
      }
      if (!['running', 'cancelling'].includes(job.status)) continue;
      const attempts = (await repository!.list('aiJobAttempt', { jobId: job.jobId })).sort(
        (a, b) => b.ordinal - a.ordinal
      );
      const active = attempts[0];
      if (job.status !== 'cancelling' && active && Date.parse(active.leaseExpiresAt) > now().getTime()) continue;
      if (active && ['leased', 'sent'].includes(active.status)) {
        await replace('aiJobAttempt', active, {
          status: job.status === 'cancelling' ? 'cancelled' : 'timedOut',
          deliveryUncertain: active.status === 'sent',
          finishedAt: now().toISOString()
        });
        // 预留既可能已送达供应商，也可能没有；超时一律保守占用，不能算零费用。
        await Promise.resolve()
          .then(() => budget!.settle({ accountRef, attemptId: active.attemptId, disposition: 'unknown' }))
          .catch(error => {
            if (error.code !== 'AI_BUDGET_NOT_FOUND') throw error;
          });
      }
      // 仓库返回已验证记录；空值断言保留原先消失记录的解引用失败，不新增恢复分支。
      const current = await repository!.get('aiJob', job.jobId);
      if (current!.status === job.status) {
        await replace('aiJob', current!, {
          status: job.status === 'cancelling' ? 'cancelled' : 'failed',
          phase: 'finished'
        });
        changed++;
      }
    }
    return changed;
  }
  async function run(jobId: string, request: GatewayRequest) {
    // 每次执行取一份预算快照；隔离进程内没有 policy，由父进程随消息传入价格档案与上限。
    const plan = policy ? await policy.snapshot() : null;
    const priceProfile = plan?.profile ?? baseProfile;
    const limits = plan ? plan.limits : fixedLimits;
    let job = await repository!.get('aiJob', jobId);
    if (!job) fail('AI_JOB_NOT_FOUND', '任务不存在。');
    const provider = gateway!.capabilities?.().provider;
    if (provider !== 'mock' && !allowExternal) fail('AI_EGRESS_NOT_READY', '实际资料发送范围尚未完成核验。');
    if (provider !== 'mock' && (!verifySources || !validateResult))
      fail('AI_CONTEXT_NOT_READY', '来源与回答校验尚未接入。');
    const { grant, manifest } = await validBoundary(job);
    if (verifySources) await verifySources(job, request);
    if (
      request?.modelId !== job.modelId ||
      request?.credentialRef !== job.credentialRef ||
      job.jobKind !== 'answer' ||
      !grant.actionKinds.includes('read') ||
      request?.tools?.some(
        tool => !allowedTools.has(tool.name) || !(grant.allowedTools as readonly string[]).includes(tool.name)
      ) ||
      manifest.attachmentIds.length
    ) {
      fail('AI_REQUEST_INVALID', '执行请求与任务配置不一致。');
    }
    const quote = quoteWorstCase({ request, priceProfile, now: now() });
    if (manifest.payloadHash !== quote.payloadHash) fail('AI_PAYLOAD_STALE', '实际发送内容与已确认范围不一致。');
    const attempts = await repository!.list('aiJobAttempt', { jobId });
    if (attempts.length >= MAX_ATTEMPTS) fail('AI_ATTEMPT_LIMIT', '任务已达到四次调用上限。');
    if (job.status === 'failed') job = await replace('aiJob', job, { status: 'retrying', phase: 'preparing' });
    if (!['pending', 'retrying'].includes(job.status)) fail('AI_JOB_NOT_RUNNABLE', '任务当前不可领取。');
    await replace('aiJob', job, { status: 'running', phase: 'generating' });
    const startedAt = now().toISOString();
    let attempt = await repository!.insert('aiJobAttempt', {
      contractVersion: 1,
      kind: 'aiJobAttempt',
      attemptId: randomUUID(),
      jobId,
      ordinal: attempts.length + 1,
      leaseGeneration: Math.max(0, ...attempts.map(item => item.leaseGeneration)) + 1,
      leaseOwner: workerId,
      leaseExpiresAt: new Date(now().getTime() + LEASE_MS).toISOString(),
      providerRequestId: null,
      deliveryUncertain: false,
      status: 'leased',
      startedAt,
      finishedAt: null
    });
    await recordEvent(jobId, 'attemptPrepared', {
      attemptId: attempt.attemptId,
      inputUpperBoundBytes: quote.inputUpperBound,
      maxOutputTokens: request.maxTokens,
      sourceCount: manifest.sources.length,
      reservedMicrounits: quote.reservedMicrounits,
      priceVersion: priceProfile!.version
    });
    let reserved = false;
    let sent = false;
    let budgetDisposition = 'unconfirmed';
    let stage = 'budgetReservation';
    const controller = new AbortController();
    controllers.set(jobId, controller);
    const timer = setTimeout(() => controller.abort(), LEASE_MS);
    timer.unref?.();
    const reservationDay = beijingDay(now());
    try {
      const reservation = await budget!.reserve({
        accountRef,
        jobId,
        attemptId: attempt.attemptId,
        priceVersion: priceProfile!.version,
        reservedMicrounits: quote.reservedMicrounits,
        day: reservationDay,
        ...(limits ? { limits } : {})
      });
      reserved = true;
      await recordEvent(jobId, 'budgetReserved', {
        attemptId: attempt.attemptId,
        reservedMicrounits: quote.reservedMicrounits
      });
      stage = 'preSendValidation';
      if (
        reservation?.accountRef !== accountRef ||
        reservation.jobId !== jobId ||
        reservation.attemptId !== attempt.attemptId ||
        reservation.priceVersion !== priceProfile!.version ||
        reservation.reservedMicrounits !== quote.reservedMicrounits ||
        reservation.day !== reservationDay
      ) {
        fail('AI_BUDGET_INVALID', '预算预留回执与任务不一致，已阻止模型调用。');
      }
      const beforeSend = await repository!.get('aiJob', jobId);
      await validBoundary(beforeSend!);
      if (verifySources) await verifySources(beforeSend!, request);
      if (beforeSend!.status !== 'running' || controller.signal.aborted)
        fail('AI_CANCELLED', '任务已取消，未发送模型请求。');
      if (beijingDay(now()) !== reservationDay) fail('AI_BUDGET_DAY_CHANGED', '预算日期已切换，请重新预览后重试。');
      quoteWorstCase({ request, priceProfile, now: now() });
      // 快照之后到真正发送之间用户可能点了暂停：在标记“已发送”前再复核一次（此时抛错会释放预留）。
      if (policy) await policy.assertRunnable();
      attempt = await replace('aiJobAttempt', attempt, { status: 'sent' });
      sent = true;
      await recordEvent(jobId, 'providerRequestStarted', { attemptId: attempt.attemptId, deliveryUncertain: true });
      stage = 'providerResponse';
      authorizeAttempt(attempt.attemptId);
      // sent/诊断写入和凭据解析都可能异步等待；最终原资料检查由 gateway 在适配器调用前执行。
      if (verifySources) await verifySources(beforeSend!, request);
      const result = await gateway!.complete({
        ...request,
        signal: controller.signal,
        budgetAttemptId: attempt.attemptId,
        verifyBeforeSend: verifySources ? () => verifySources(beforeSend!, request) : undefined
      });
      await recordEvent(jobId, 'providerResponseReceived', {
        attemptId: attempt.attemptId,
        ...(safeIdentifier(result.requestId) ? { responseId: result.requestId! } : {}),
        ...(safeIdentifier(result.finishReason) ? { finishReason: result.finishReason } : {}),
        ...(Number.isSafeInteger(result.usage?.inputTokens) ? { inputTokens: result.usage.inputTokens! } : {}),
        ...(Number.isSafeInteger(result.usage?.outputTokens) ? { outputTokens: result.usage.outputTokens! } : {}),
        usageUnknown: result.usage?.unknown !== false
      });
      stage = 'resultValidation';
      const currentJob = await repository!.get('aiJob', jobId);
      const currentAttempt = await repository!.get('aiJobAttempt', attempt.attemptId);
      await validBoundary(currentJob!);
      if (
        currentJob!.status !== 'running' ||
        currentAttempt!.status !== 'sent' ||
        currentAttempt!.leaseGeneration !== attempt.leaseGeneration ||
        Date.parse(currentAttempt!.leaseExpiresAt) <= now().getTime() ||
        controller.signal.aborted
      ) {
        fail('AI_LATE_RESULT', '任务已取消或租约失效，迟到响应已丢弃。');
      }
      stage = 'budgetSettlement';
      const usage = result.usage;
      const actual =
        usage?.unknown === false && nonnegative(usage.inputTokens!) && nonnegative(usage.outputTokens!)
          ? actualCostMicrounits(usage, priceProfile!)
          : null;
      if (usage?.unknown === false && actual === null) fail('AI_USAGE_LIMIT', '供应商用量无效。');
      if (
        actual !== null &&
        (actual > quote.reservedMicrounits ||
          usage.inputTokens! > MAX_INPUT_TOKENS ||
          usage.outputTokens! > MAX_OUTPUT_TOKENS)
      )
        fail('AI_USAGE_LIMIT', '供应商用量超过预留或任务边界。');
      await budget!.settle({
        accountRef,
        attemptId: attempt.attemptId,
        disposition: actual === null ? 'unknown' : 'settled',
        actualMicrounits: actual,
        usage: {
          modelId: request.modelId,
          ...(usage?.unknown === false
            ? {
                inputTokens: usage.inputTokens!,
                outputTokens: usage.outputTokens!,
                cacheHitTokens: usage.cacheHitTokens ?? null
              }
            : {})
        }
      });
      budgetDisposition = actual === null ? 'unknown' : 'settled';
      await recordEvent(jobId, 'budgetSettled', {
        attemptId: attempt.attemptId,
        budgetDisposition,
        ...(actual === null ? {} : { actualMicrounits: actual })
      });
      await repository!.insert('aiUsageRecord', {
        contractVersion: 1,
        kind: 'aiUsageRecord',
        usageId: randomUUID(),
        jobId,
        attemptId: attempt.attemptId,
        beijingDay: beijingDay(new Date(startedAt)),
        currency: 'CNY',
        priceVersion: priceProfile!.version,
        inputTokens: usage?.inputTokens ?? null,
        outputTokens: usage?.outputTokens ?? null,
        reservedMicrounits: quote.reservedMicrounits,
        actualMicrounits: actual,
        usageUnknown: actual === null,
        createdAt: now().toISOString()
      });
      stage = 'resultValidation';
      const acceptedResult = validateResult ? await validateResult(currentJob!, result) : null;
      await recordEvent(jobId, 'resultValidated', { attemptId: attempt.attemptId });
      stage = 'resultPersistence';
      attempt = await replace('aiJobAttempt', currentAttempt!, {
        status: 'validated',
        providerRequestId: result.requestId ?? null,
        finishedAt: now().toISOString()
      });
      await replace('aiJob', currentJob!, {
        status: 'succeeded',
        phase: 'finished',
        acceptedAttemptId: attempt.attemptId,
        outputHash: hashRecord(acceptedResult ?? result.content ?? ''),
        ...(acceptedResult ? { resultJson: acceptedResult } : {})
      });
      await recordEvent(jobId, 'taskSucceeded', { attemptId: attempt.attemptId, status: 'succeeded' });
      return result;
    } catch (error) {
      if (reserved && budgetDisposition === 'unconfirmed')
        await Promise.resolve()
          .then(() =>
            budget!.settle({
              accountRef,
              attemptId: attempt.attemptId,
              disposition: sent ? 'unknown' : 'released',
              ...(sent ? { usage: { modelId: request.modelId } } : {})
            })
          )
          .then(() => {
            budgetDisposition = sent ? 'unknown' : 'released';
          })
          .catch(() => undefined);
      await recordEvent(jobId, 'attemptFailed', {
        attemptId: attempt.attemptId,
        stage,
        code: safeCode((error as Partial<Pick<AppError, 'code'>> | null)?.code),
        deliveryUncertain: sent,
        budgetDisposition,
        ...(Number.isInteger((error as { httpStatus?: number } | null)?.httpStatus) &&
        (error as { httpStatus: number }).httpStatus >= 100 &&
        (error as { httpStatus: number }).httpStatus <= 599
          ? { httpStatus: (error as { httpStatus: number }).httpStatus }
          : {})
      });
      const currentAttempt = await repository!.get('aiJobAttempt', attempt.attemptId);
      if ((['leased', 'sent'] as readonly (string | undefined)[]).includes(currentAttempt?.status))
        await replace('aiJobAttempt', currentAttempt!, {
          status: controller.signal.aborted ? 'cancelled' : 'rejected',
          deliveryUncertain: sent,
          finishedAt: now().toISOString()
        });
      const currentJob = await repository!.get('aiJob', jobId);
      if ((['running', 'cancelling'] as readonly (string | undefined)[]).includes(currentJob?.status))
        await replace('aiJob', currentJob!, {
          status: currentJob!.status === 'cancelling' ? 'cancelled' : 'failed',
          phase: 'finished'
        });
      throw error;
    } finally {
      revokeAttempt(attempt.attemptId);
      clearTimeout(timer);
      controllers.delete(jobId);
    }
  }
  return { run, cancel, recover };
}

function safeIdentifier(value: unknown) {
  return typeof value === 'string' && /^[a-zA-Z0-9_.:-]{1,128}$/.test(value);
}

function safeCode(value: unknown) {
  return typeof value === 'string' && /^AI_[A-Z0-9_]{1,64}$/.test(value) ? value : 'AI_TASK_FAILED';
}
