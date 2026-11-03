import { randomUUID } from 'node:crypto';
import { calculateContentHash } from '@study-accelerator/content-anchor';
import { hashRecord, manifestHash, scopeHash, validateAiRecord } from './record-contract.js';
import { outboundPayloadHash, serializedDeepSeekPayload } from './outbound-payload.ts';
import {
  prepareKnowledgeExtractionGateway,
  KNOWLEDGE_EXTRACTION_PROMPT_VERSION
} from './knowledge-extraction-gateway.js';
import {
  EXTRACTION_MOCK_PROFILE as profile,
  extractionCreationHash,
  taskBoundary,
  taskError,
  validateExtractionTask
} from './knowledge-extraction-task-contract.js';
import { isAiReadableNote } from './note-privacy.js';

export function* verifyExtractionSourcePrivacy(repos, sourceRefs, spaceId) {
  const ids = [...new Set(sourceRefs.map(ref => ref.noteId))];
  if (!repos.noteRepository.findByIds && ids.length > 1) {
    throw taskError('KNOWLEDGE_EXTRACTION_SOURCE_UNAVAILABLE', '当前仓库未提供批量来源隐私检查。');
  }
  const notes = repos.noteRepository.findByIds
    ? yield repos.noteRepository.findByIds(ids)
    : [yield repos.noteRepository.findById(ids[0])];
  const byId = new Map(notes.filter(Boolean).map(note => [note.id, note]));
  if (ids.some(id => !isAiReadableNote(byId.get(id)) || byId.get(id).spaceId !== spaceId)) {
    throw taskError('KNOWLEDGE_EXTRACTION_SOURCE_UNAVAILABLE', '原始提炼来源不在当前 AI 可读取范围。');
  }
}

export function* prepareTaskSources(context, ownerId, scopeId, idempotencyKey) {
  const repos = context.repositories;
  const scope = yield repos.analysisScopeRepository.findById(scopeId);
  const space = scope && (yield repos.knowledgeSpaceRepository.findById(scope.spaceId));
  if (!scope || scope.deletedAt || !space || space.userId !== ownerId) {
    throw taskError('KNOWLEDGE_EXTRACTION_SCOPE_FORBIDDEN', '提炼范围不存在或不属于当前 owner。');
  }
  const versions = [];
  for (const binding of scope.noteVersions) {
    const note = yield repos.noteRepository.findById(binding.noteId);
    if (!isAiReadableNote(note) || note.spaceId !== scope.spaceId) {
      throw taskError('KNOWLEDGE_EXTRACTION_SOURCE_UNAVAILABLE', '原始提炼来源不在当前 AI 可读取范围。');
    }
    const version = yield repos.noteVersionRepository.findById(binding.noteVersionId);
    if (!version || version.noteId !== note.id) {
      throw taskError(
        'KNOWLEDGE_EXTRACTION_SOURCE_UNAVAILABLE',
        '原始提炼版本不可用或来源已删除、迁移；请重新保存范围。'
      );
    }
    versions.push(version);
  }
  yield* verifyExtractionSourcePrivacy(repos, versions, scope.spaceId);
  const prepared = prepareKnowledgeExtractionGateway({ scope, noteVersions: versions, idempotencyKey });
  const request = { ...prepared.gatewayRequest, modelId: profile.modelId, credentialRef: profile.credentialRef };
  const estimatedInputTokens = Buffer.byteLength(serializedDeepSeekPayload(request), 'utf8');
  if (estimatedInputTokens > 100_000)
    throw taskError('KNOWLEDGE_EXTRACTION_INPUT_TOO_LARGE', '提炼请求封装后超过输入上限。', 422);
  const refs = prepared.extractionRequest.sources.map(source => ({
    sourceId: source.sourceId,
    noteId: source.noteId,
    noteVersionId: source.noteVersionId,
    contentHash: source.contentHash,
    start: source.start,
    end: source.end,
    quoteHash: calculateContentHash(source.markdown),
    characters: source.end - source.start,
    estimatedTokens: Buffer.byteLength(source.markdown, 'utf8')
  }));
  const omissions = [`excluded:${scope.exclusions?.length ?? 0}`, `omitted:${scope.omittedItems?.length ?? 0}`];
  return {
    scope,
    ...prepared,
    request,
    refs,
    omissions,
    estimatedInputTokens,
    payloadHash: outboundPayloadHash(request)
  };
}

export function buildTaskRecords(prepared, identity, ownerId, idempotencyKey, now) {
  const time = now.toISOString();
  const boundary = { ownerId, ...identity, spaceId: prepared.scope.spaceId };
  const snapshot = {
    contractVersion: 1,
    kind: 'scopeSnapshot',
    scopeSnapshotId: randomUUID(),
    ...boundary,
    scopeKind: new Set(prepared.refs.map(ref => ref.noteId)).size === 1 ? 'note' : 'multiNote',
    allowedSources: prepared.refs,
    allowedFolderIds: [],
    excludedSourceIds: [],
    scopeHash: '',
    createdAt: time
  };
  snapshot.scopeHash = scopeHash(snapshot);
  const manifest = {
    contractVersion: 1,
    kind: 'contextManifest',
    manifestId: randomUUID(),
    ...boundary,
    scopeSnapshotId: snapshot.scopeSnapshotId,
    scopeKind: snapshot.scopeKind,
    scopeHash: snapshot.scopeHash,
    recipient: 'deepseek',
    sources: prepared.refs,
    excludedSourceIds: [],
    omissions: prepared.omissions,
    attachmentIds: [],
    estimatedInputTokens: prepared.estimatedInputTokens,
    payloadHash: prepared.payloadHash,
    createdAt: time
  };
  const grant = {
    contractVersion: 1,
    kind: 'aiGrant',
    grantId: randomUUID(),
    actorId: ownerId,
    entrypoint: 'analysisScope',
    ...boundary,
    scopeSnapshotId: snapshot.scopeSnapshotId,
    scopeHash: snapshot.scopeHash,
    allowedTools: [],
    actionKinds: ['create'],
    maxTargets: profile.maxTargets,
    issuedAt: time,
    expiresAt: new Date(now.getTime() + profile.grantMs).toISOString(),
    revokedAt: null
  };
  const job = {
    contractVersion: 1,
    kind: 'aiJob',
    jobId: randomUUID(),
    requestId: prepared.extractionRequest.requestId,
    parentJobId: null,
    ...boundary,
    grantId: grant.grantId,
    jobKind: 'knowledgeExtraction',
    idempotencyKey,
    inputHash: prepared.extractionRequest.inputHash,
    manifestId: manifest.manifestId,
    manifestHash: manifestHash(manifest),
    credentialRef: profile.credentialRef,
    provider: 'deepseek',
    modelId: profile.modelId,
    promptVersion: KNOWLEDGE_EXTRACTION_PROMPT_VERSION,
    resultSchemaVersion: 'knowledge-extraction-v1',
    status: 'pending',
    phase: 'preparing',
    acceptedAttemptId: null,
    outputHash: null,
    createdAt: time,
    updatedAt: time
  };
  const content = {
    schemaVersion: 1,
    ...boundary,
    jobId: job.jobId,
    scopeId: prepared.scope.id,
    scopeInputHash: prepared.scope.inputHash,
    inputHash: job.inputHash,
    executionMode: 'mock',
    profileVersion: profile.version,
    maxTokens: profile.maxTokens,
    createdAt: time
  };
  content.creationHash = extractionCreationHash(content);
  return {
    snapshot,
    manifest,
    grant,
    job,
    descriptor: validateExtractionTask({ ...content, recordHash: hashRecord(content) })
  };
}

export function* requireTask(context, store, ownerId, jobId) {
  const identity = yield context.aiRepository.identity();
  const job = yield context.aiRepository.get('aiJob', jobId);
  const raw = yield store.get({ ownerId, ...identity, jobId }, context.transaction);
  if (!job || !raw) throw taskError('KNOWLEDGE_EXTRACTION_TASK_NOT_FOUND', '提炼任务不存在。', 404);
  const descriptor = validateExtractionTask(raw);
  const space = yield context.repositories.knowledgeSpaceRepository.findById(job.spaceId);
  if (
    job.ownerId !== ownerId ||
    job.datasetId !== identity.datasetId ||
    job.datasetEpoch !== identity.datasetEpoch ||
    !space ||
    space.userId !== ownerId ||
    job.createdAt !== descriptor.createdAt ||
    descriptor.jobId !== job.jobId ||
    !taskBoundary(job, descriptor) ||
    descriptor.inputHash !== job.inputHash ||
    job.jobKind !== 'knowledgeExtraction' ||
    job.promptVersion !== KNOWLEDGE_EXTRACTION_PROMPT_VERSION ||
    job.resultSchemaVersion !== 'knowledge-extraction-v1' ||
    job.modelId !== profile.modelId ||
    job.credentialRef !== profile.credentialRef ||
    job.provider !== 'deepseek' ||
    job.resultJson
  ) {
    throw taskError('KNOWLEDGE_EXTRACTION_TASK_STALE', '提炼任务身份或执行配置已失效。');
  }
  validateAiRecord('aiJob', job);
  return { job, descriptor };
}

/** 创建、领取与发送前都从宿主库重读固定范围；不使用对话的持续授权或检索结果。 */
export function* verifyTaskRequest(context, ownerId, task, clock) {
  const { job, descriptor } = task;
  const prepared = yield* prepareTaskSources(context, ownerId, descriptor.scopeId, job.idempotencyKey);
  const grant = yield context.aiRepository.get('aiGrant', job.grantId);
  const manifest = yield context.aiRepository.get('contextManifest', job.manifestId);
  const snapshot = manifest && (yield context.aiRepository.get('scopeSnapshot', manifest.scopeSnapshotId));
  if (!grant || !manifest || !snapshot) throw taskError('KNOWLEDGE_EXTRACTION_GRANT_INVALID', '提炼授权依赖缺失。');
  for (const [kind, record] of [
    ['aiGrant', grant],
    ['contextManifest', manifest],
    ['scopeSnapshot', snapshot]
  ])
    validateAiRecord(kind, record);
  const now = clock();
  if (
    ![grant, manifest, snapshot].every(record => taskBoundary(job, record)) ||
    grant.actorId !== ownerId ||
    grant.entrypoint !== 'analysisScope' ||
    grant.revokedAt ||
    Date.parse(grant.issuedAt) > now.getTime() ||
    grant.issuedAt !== descriptor.createdAt ||
    Date.parse(grant.expiresAt) - Date.parse(grant.issuedAt) !== profile.grantMs ||
    Date.parse(grant.expiresAt) <= now.getTime() ||
    grant.allowedTools.length ||
    hashRecord(grant.actionKinds) !== hashRecord(['create']) ||
    grant.maxTargets !== profile.maxTargets ||
    grant.scopeSnapshotId !== snapshot.scopeSnapshotId ||
    grant.scopeHash !== snapshot.scopeHash ||
    manifest.scopeHash !== snapshot.scopeHash ||
    manifest.scopeKind !== snapshot.scopeKind ||
    !['note', 'multiNote'].includes(snapshot.scopeKind) ||
    snapshot.allowedFolderIds.length ||
    snapshot.excludedSourceIds.length ||
    manifest.excludedSourceIds.length ||
    manifest.attachmentIds.length ||
    manifest.recipient !== job.provider ||
    manifestHash(manifest) !== job.manifestHash ||
    hashRecord(snapshot.allowedSources) !== hashRecord(prepared.refs) ||
    hashRecord(manifest.sources) !== hashRecord(prepared.refs) ||
    manifest.payloadHash !== prepared.payloadHash ||
    manifest.estimatedInputTokens !== prepared.estimatedInputTokens ||
    hashRecord(manifest.omissions) !== hashRecord(prepared.omissions) ||
    prepared.scope.spaceId !== job.spaceId ||
    prepared.scope.inputHash !== descriptor.scopeInputHash ||
    prepared.extractionRequest.inputHash !== job.inputHash ||
    prepared.extractionRequest.requestId !== job.requestId
  ) {
    throw taskError('KNOWLEDGE_EXTRACTION_GRANT_INVALID', '提炼来源、请求或创建授权已失效。');
  }
  yield* verifyExtractionSourcePrivacy(context.repositories, prepared.refs, job.spaceId);
  return { request: prepared.request, grantExpiresAt: grant.expiresAt };
}
