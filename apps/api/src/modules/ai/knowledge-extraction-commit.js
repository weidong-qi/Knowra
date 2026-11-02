import { calculateContentHash } from '@study-accelerator/content-anchor';
import { createAppError } from '../../errors/app-error.js';
import { hashRecord, manifestHash } from './record-contract.js';
import { outboundPayloadHash } from './outbound-payload.ts';
import {
  prepareKnowledgeExtractionGateway,
  validateKnowledgeExtractionGatewayResult,
  KNOWLEDGE_EXTRACTION_PROMPT_VERSION
} from './knowledge-extraction-gateway.js';
import { validateKnowledgeExtractionCommit } from './knowledge-extraction-commit-contract.js';
import { createKnowledgeArtifactProvenanceFromReceipt } from '../../infrastructure/migration/knowledge-artifact-provenance-backfill.js';
import { isAiReadableNote } from './note-privacy.js';
import { verifyExtractionSourcePrivacy } from './knowledge-extraction-task-context.js';

const fail = (code, message) => {
  throw createAppError(code, message, 409);
};
const sameBoundary = (left, right) =>
  ['ownerId', 'datasetId', 'datasetEpoch', 'spaceId'].every(key => left[key] === right[key]);
const nextTime = (now, previous) => new Date(Math.max(now.getTime(), Date.parse(previous) + 1)).toISOString();

function runSync(steps) {
  let step = steps.next();
  while (!step.done) {
    if (step.value?.then) throw new TypeError('本地提炼事务不能包含异步操作。');
    step = steps.next(step.value);
  }
  return step.value;
}
async function runAsync(steps) {
  let step = steps.next();
  while (!step.done) step = steps.next(await step.value);
  return step.value;
}

/** 受信宿主的 Mock 接纳入口；没有 HTTP/IPC 路由，也不发起模型请求或读取凭据。 */
export function createKnowledgeExtractionCommitService({ store, createContext, ownerId, clock = () => new Date() }) {
  if (!store || !createContext || !ownerId) throw new TypeError('提炼接纳需要宿主事务、仓库和 owner。');
  return {
    commit(input) {
      if (
        !input ||
        Object.keys(input).length !== 4 ||
        ['jobId', 'attemptId', 'scopeId', 'result'].some(key => !Object.hasOwn(input, key)) ||
        ['jobId', 'attemptId', 'scopeId'].some(key => typeof input[key] !== 'string' || !input[key]) ||
        input.result?.provider !== 'mock'
      )
        fail('KNOWLEDGE_EXTRACTION_MOCK_ONLY', '当前提炼接纳仅供受信宿主的模拟验收。');
      const captured = structuredClone(input);
      return store.supportsAsync
        ? store.runTransaction(async tx => runAsync(accept(await createContext(tx), captured, clock())), captured)
        : store.runTransaction(tx => runSync(accept(createContext(tx), captured, clock())), captured);
    }
  };

  function* accept(context, input, now) {
    const { aiRepository: ai, repositories: repos, knowledgeItemService } = context;
    const job = yield ai.get('aiJob', input.jobId);
    const identity = yield ai.identity();
    if (
      !job ||
      job.ownerId !== ownerId ||
      job.datasetId !== identity.datasetId ||
      job.datasetEpoch !== identity.datasetEpoch ||
      job.jobKind !== 'knowledgeExtraction' ||
      job.promptVersion !== KNOWLEDGE_EXTRACTION_PROMPT_VERSION ||
      job.resultSchemaVersion !== 'knowledge-extraction-v1'
    )
      fail('KNOWLEDGE_EXTRACTION_JOB_INVALID', '提炼任务身份、契约或资料集已失效。');
    const existing = yield store.get(job, context.transaction);
    if (existing) {
      const receipt = validateKnowledgeExtractionCommit(existing);
      const plan = validateKnowledgeExtractionGatewayResult({
        extractionRequest: receipt.request,
        result: input.result
      });
      if (
        receipt.datasetEpoch !== job.datasetEpoch ||
        receipt.scopeId !== input.scopeId ||
        receipt.attemptId !== input.attemptId ||
        receipt.inputHash !== job.inputHash ||
        job.status !== 'succeeded' ||
        job.outputHash !== receipt.outputHash ||
        job.acceptedAttemptId !== receipt.attemptId ||
        plan.outputHash !== receipt.outputHash
      ) {
        fail('KNOWLEDGE_EXTRACTION_OUTPUT_CONFLICT', '任务已接纳另一份结果，不能覆盖首次提交。');
      }
      return receipt;
    }
    const attempt = yield ai.get('aiJobAttempt', input.attemptId);
    const attempts = yield ai.list('aiJobAttempt', { jobId: job.jobId });
    if (
      job.status !== 'running' ||
      job.acceptedAttemptId ||
      job.outputHash ||
      job.resultJson ||
      !attempt ||
      attempt.jobId !== job.jobId ||
      attempt.status !== 'sent' ||
      attempt.finishedAt ||
      Date.parse(attempt.leaseExpiresAt) <= now.getTime() ||
      attempts.some(other => other.leaseGeneration > attempt.leaseGeneration)
    ) {
      fail('KNOWLEDGE_EXTRACTION_ATTEMPT_STALE', '提炼任务已取消、结束或租约失效，迟到结果不能入库。');
    }
    const grant = yield ai.get('aiGrant', job.grantId);
    const manifest = yield ai.get('contextManifest', job.manifestId);
    const aiScope = grant && (yield ai.get('scopeSnapshot', grant.scopeSnapshotId));
    if (
      !grant ||
      !manifest ||
      !aiScope ||
      !sameBoundary(job, grant) ||
      !sameBoundary(job, manifest) ||
      !sameBoundary(job, aiScope) ||
      grant.entrypoint !== 'analysisScope' ||
      grant.revokedAt ||
      Date.parse(grant.issuedAt) > now.getTime() ||
      Date.parse(grant.expiresAt) <= now.getTime() ||
      !grant.actionKinds.includes('create') ||
      grant.allowedTools.length ||
      grant.maxTargets < 0 ||
      manifestHash(manifest) !== job.manifestHash ||
      manifest.scopeSnapshotId !== aiScope.scopeSnapshotId ||
      manifest.scopeKind !== aiScope.scopeKind ||
      aiScope.scopeKind === 'empty' ||
      manifest.scopeHash !== aiScope.scopeHash ||
      grant.scopeHash !== aiScope.scopeHash ||
      manifest.recipient !== job.provider ||
      manifest.attachmentIds.length
    ) {
      fail('KNOWLEDGE_EXTRACTION_GRANT_INVALID', '提炼创建授权或上下文已失效。');
    }
    const scope = yield repos.analysisScopeRepository.findById(input.scopeId);
    const space = yield repos.knowledgeSpaceRepository.findById(job.spaceId);
    if (!scope || scope.deletedAt || scope.spaceId !== job.spaceId || !space || space.userId !== ownerId) {
      fail('KNOWLEDGE_EXTRACTION_SCOPE_FORBIDDEN', '保存的提炼范围不属于当前知识空间。');
    }
    const versions = [];
    for (const binding of scope.noteVersions) {
      const note = yield repos.noteRepository.findById(binding.noteId);
      if (!isAiReadableNote(note) || note.spaceId !== job.spaceId) {
        fail('KNOWLEDGE_EXTRACTION_SOURCE_UNAVAILABLE', '原始提炼来源不在当前 AI 可读取范围，未保存任何候选。');
      }
      const version = yield repos.noteVersionRepository.findById(binding.noteVersionId);
      if (!version || version.noteId !== note.id) {
        fail(
          'KNOWLEDGE_EXTRACTION_SOURCE_UNAVAILABLE',
          '原始提炼版本不可用或来源已删除、迁移；请重新保存范围，未保存任何候选。'
        );
      }
      versions.push(version);
    }
    yield* verifyExtractionSourcePrivacy(repos, versions, job.spaceId);
    const prepared = prepareKnowledgeExtractionGateway({
      scope,
      noteVersions: versions,
      idempotencyKey: job.idempotencyKey
    });
    const request = prepared.extractionRequest;
    const sourceRefs = request.sources.map(source => ({
      sourceId: source.sourceId,
      noteId: source.noteId,
      noteVersionId: source.noteVersionId,
      contentHash: source.contentHash,
      start: source.start,
      end: source.end,
      quoteHash: calculateContentHash(source.markdown),
      characters: source.end - source.start
    }));
    const refsMatch = refs =>
      refs.length === sourceRefs.length &&
      sourceRefs.every(source => refs.some(ref => Object.keys(source).every(key => ref[key] === source[key])));
    if (
      request.requestId !== job.requestId ||
      request.inputHash !== job.inputHash ||
      !refsMatch(aiScope.allowedSources) ||
      !refsMatch(manifest.sources) ||
      manifest.sources.some(
        source =>
          aiScope.excludedSourceIds.includes(source.sourceId) || manifest.excludedSourceIds.includes(source.sourceId)
      ) ||
      manifest.payloadHash !== outboundPayloadHash({ ...prepared.gatewayRequest, modelId: job.modelId })
    ) {
      fail('KNOWLEDGE_EXTRACTION_INPUT_CONFLICT', '任务不匹配保存的提炼范围或实际请求。');
    }
    const plan = validateKnowledgeExtractionGatewayResult({ extractionRequest: request, result: input.result });
    if (plan.candidates.length > grant.maxTargets)
      fail('KNOWLEDGE_EXTRACTION_TARGET_LIMIT', '候选数量超过本次创建授权，未保存任何候选。');
    for (const candidate of plan.candidates) {
      // 接纳前任何同 ID 资产都拒绝；不能借候选服务的重试覆盖或采纳别人的记录。
      if (yield repos.knowledgeItemRepository.findById(candidate.candidateInput.id)) {
        fail('KNOWLEDGE_EXTRACTION_CANDIDATE_CONFLICT', '候选 ID 已存在，未保存任何结果。');
      }
      yield knowledgeItemService.createCandidate(candidate.candidateInput);
    }
    const committedAt = clock();
    if (
      Date.parse(attempt.leaseExpiresAt) <= committedAt.getTime() ||
      Date.parse(grant.expiresAt) <= committedAt.getTime()
    ) {
      fail('KNOWLEDGE_EXTRACTION_ATTEMPT_STALE', '提炼提交期间租约或授权到期，未保存任何候选。');
    }
    const receiptContent = {
      schemaVersion: 1,
      executionMode: 'mock',
      ownerId,
      ...identity,
      spaceId: job.spaceId,
      jobId: job.jobId,
      attemptId: attempt.attemptId,
      scopeId: scope.id,
      requestId: job.requestId,
      inputHash: plan.inputHash,
      outputHash: plan.outputHash,
      modelId: job.modelId,
      promptVersion: job.promptVersion,
      resultSchemaVersion: job.resultSchemaVersion,
      committedAt: committedAt.toISOString(),
      request,
      result: JSON.parse(input.result.content),
      candidates: plan.candidates
    };
    const receipt = validateKnowledgeExtractionCommit({ ...receiptContent, receiptHash: hashRecord(receiptContent) });
    for (const candidate of receipt.candidates) {
      yield repos.knowledgeArtifactProvenanceRepository.create(
        createKnowledgeArtifactProvenanceFromReceipt(receipt, candidate)
      );
    }
    yield store.insert(receipt, context.transaction);
    yield ai.replace(
      'aiJobAttempt',
      { ...attempt, status: 'validated', finishedAt: committedAt.toISOString() },
      hashRecord(attempt)
    );
    if (Date.parse(attempt.leaseExpiresAt) <= clock().getTime() || Date.parse(grant.expiresAt) <= clock().getTime()) {
      fail('KNOWLEDGE_EXTRACTION_ATTEMPT_STALE', '提炼提交期间租约或授权到期，未保存任何候选。');
    }
    // 冻结 v1 的 resultJson 仍专属问答；提炼正文由独立提交记录保存。
    yield ai.replace(
      'aiJob',
      {
        ...job,
        status: 'succeeded',
        phase: 'finished',
        acceptedAttemptId: attempt.attemptId,
        outputHash: receipt.outputHash,
        updatedAt: nextTime(committedAt, job.updatedAt)
      },
      hashRecord(job)
    );
    return receipt;
  }
}
