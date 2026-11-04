import { hashRecord, manifestHash, scopeHash } from '../src/modules/ai/record-contract.ts';
import { normalizeAiRequest } from '../src/modules/ai/gateway.js';
import { outboundPayloadHash } from '../src/modules/ai/outbound-payload.ts';

const time = '2026-09-26T00:00:00.000Z';
const later = '2030-09-26T00:00:00.000Z';
const emptyHash = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

export function aiRecords(
  { datasetId, datasetEpoch },
  suffix = '1',
  ownerId = 'demo',
  outboundRequest = {
    modelId: 'deepseek-flash',
    messages: [{ role: 'user', content: '合成测试' }],
    maxTokens: 100,
    tools: [],
    format: 'text'
  }
) {
  const boundary = { ownerId, datasetId, datasetEpoch, spaceId: 'space-1' };
  const scope = {
    contractVersion: 1,
    kind: 'scopeSnapshot',
    scopeSnapshotId: `scope-${suffix}`,
    ...boundary,
    scopeKind: 'empty',
    allowedSources: [],
    allowedFolderIds: [],
    excludedSourceIds: [],
    scopeHash: emptyHash,
    createdAt: time
  };
  scope.scopeHash = scopeHash(scope);
  const manifest = {
    contractVersion: 1,
    kind: 'contextManifest',
    manifestId: `manifest-${suffix}`,
    ...boundary,
    scopeSnapshotId: scope.scopeSnapshotId,
    scopeKind: 'empty',
    scopeHash: scope.scopeHash,
    recipient: 'deepseek',
    sources: [],
    excludedSourceIds: [],
    omissions: [],
    attachmentIds: [],
    estimatedInputTokens: 0,
    payloadHash: outboundPayloadHash({ ...normalizeAiRequest(outboundRequest), modelId: outboundRequest.modelId }),
    createdAt: time
  };
  const grant = {
    contractVersion: 1,
    kind: 'aiGrant',
    grantId: `grant-${suffix}`,
    actorId: 'user-1',
    entrypoint: 'assistant',
    ...boundary,
    scopeSnapshotId: scope.scopeSnapshotId,
    scopeHash: scope.scopeHash,
    allowedTools: ['notes_search', 'notes_read'],
    actionKinds: ['read'],
    maxTargets: 0,
    issuedAt: time,
    expiresAt: later,
    revokedAt: null
  };
  const job = {
    contractVersion: 1,
    kind: 'aiJob',
    jobId: `job-${suffix}`,
    requestId: `request-${suffix}`,
    parentJobId: null,
    ...boundary,
    grantId: grant.grantId,
    jobKind: 'answer',
    idempotencyKey: `idempotency-${suffix}`,
    inputHash: hashRecord({ suffix }),
    manifestId: manifest.manifestId,
    manifestHash: manifestHash(manifest),
    credentialRef: 'credential-reference',
    provider: 'deepseek',
    modelId: 'deepseek-flash',
    promptVersion: 'prompt-v1',
    resultSchemaVersion: 'result-v1',
    status: 'pending',
    phase: 'preparing',
    acceptedAttemptId: null,
    outputHash: null,
    createdAt: time,
    updatedAt: time
  };
  const attempt = {
    contractVersion: 1,
    kind: 'aiJobAttempt',
    attemptId: `attempt-${suffix}`,
    jobId: job.jobId,
    ordinal: 1,
    leaseGeneration: 1,
    leaseOwner: 'worker-1',
    leaseExpiresAt: later,
    providerRequestId: null,
    deliveryUncertain: false,
    status: 'leased',
    startedAt: time,
    finishedAt: null
  };
  const usage = {
    contractVersion: 1,
    kind: 'aiUsageRecord',
    usageId: `usage-${suffix}`,
    jobId: job.jobId,
    attemptId: attempt.attemptId,
    beijingDay: '2026-09-26',
    currency: 'CNY',
    priceVersion: 'price-v1',
    inputTokens: null,
    outputTokens: null,
    reservedMicrounits: 1_000_000,
    actualMicrounits: null,
    usageUnknown: true,
    createdAt: time
  };
  const event = {
    jobId: job.jobId,
    sequence: 1,
    eventKind: 'created',
    safePayload: { status: 'pending' },
    createdAt: time
  };
  return { scope, manifest, grant, job, attempt, usage, event };
}

export function insertAiRecords(repository, records) {
  repository.insert('scopeSnapshot', records.scope);
  repository.insert('contextManifest', records.manifest);
  repository.insert('aiGrant', records.grant);
  repository.insert('aiJob', records.job);
  repository.insert('aiJobAttempt', records.attempt);
  repository.insert('aiUsageRecord', records.usage);
  repository.appendEvent(records.event);
}
