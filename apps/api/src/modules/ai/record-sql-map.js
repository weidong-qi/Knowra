import { manifestHash, validateAiRecord } from './record-contract.js';

export const AI_SQL_DEFINITIONS = {
  scopeSnapshot: {
    table: 'ai_scope_snapshots',
    id: 'scope_snapshot_id',
    document: 'snapshot_json',
    fields: ['scopeSnapshotId', 'ownerId', 'datasetId', 'datasetEpoch', 'spaceId', 'scopeHash', 'createdAt']
  },
  contextManifest: {
    table: 'ai_context_manifests',
    id: 'manifest_id',
    document: 'manifest_json',
    fields: [
      'manifestId',
      'scopeSnapshotId',
      'ownerId',
      'datasetId',
      'datasetEpoch',
      'spaceId',
      'payloadHash',
      'createdAt'
    ]
  },
  aiGrant: {
    table: 'ai_grants',
    id: 'grant_id',
    fields: [
      'grantId',
      'actorId',
      'entrypoint',
      'ownerId',
      'datasetId',
      'datasetEpoch',
      'spaceId',
      'scopeSnapshotId',
      'scopeHash',
      'allowedTools',
      'actionKinds',
      'maxTargets',
      'issuedAt',
      'expiresAt',
      'revokedAt'
    ]
  },
  aiJob: {
    table: 'ai_jobs',
    id: 'job_id',
    fields: [
      'jobId',
      'requestId',
      'parentJobId',
      'ownerId',
      'datasetId',
      'datasetEpoch',
      'spaceId',
      'grantId',
      'jobKind',
      'idempotencyKey',
      'inputHash',
      'manifestId',
      'manifestHash',
      'credentialRef',
      'provider',
      'modelId',
      'promptVersion',
      'resultSchemaVersion',
      'status',
      'phase',
      'acceptedAttemptId',
      'outputHash',
      'createdAt',
      'updatedAt',
      'question',
      'resultJson'
    ]
  },
  aiJobAttempt: {
    table: 'ai_job_attempts',
    id: 'attempt_id',
    fields: [
      'attemptId',
      'jobId',
      'ordinal',
      'leaseGeneration',
      'leaseOwner',
      'leaseExpiresAt',
      'providerRequestId',
      'deliveryUncertain',
      'status',
      'startedAt',
      'finishedAt'
    ]
  },
  aiUsageRecord: {
    table: 'ai_usage_records',
    id: 'usage_id',
    fields: [
      'usageId',
      'jobId',
      'attemptId',
      'beijingDay',
      'currency',
      'priceVersion',
      'inputTokens',
      'outputTokens',
      'reservedMicrounits',
      'actualMicrounits',
      'usageUnknown',
      'createdAt'
    ]
  }
};

const sqlName = field => field.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
const column = field =>
  ({ allowedTools: 'allowed_tools_json', actionKinds: 'action_kinds_json', resultJson: 'result_json' })[field] ??
  sqlName(field);
const jsonFields = new Set(['allowedTools', 'actionKinds', 'resultJson']);
const booleanFields = new Set(['deliveryUncertain', 'usageUnknown']);

export function encodeAiRow(kind, record) {
  const definition = AI_SQL_DEFINITIONS[kind];
  const row = Object.fromEntries(
    definition.fields.map(field => [
      column(field),
      jsonFields.has(field)
        ? record[field] === undefined
          ? null
          : JSON.stringify(record[field])
        : booleanFields.has(field)
          ? Number(record[field])
          : (record[field] ?? null)
    ])
  );
  if (definition.document) row[definition.document] = JSON.stringify(record);
  if (kind === 'contextManifest') row.manifest_hash = manifestHash(record);
  return row;
}

export function decodeAiRow(kind, row) {
  if (!row) return null;
  const definition = AI_SQL_DEFINITIONS[kind];
  if (definition.document) {
    const record = validateAiRecord(kind, JSON.parse(row[definition.document]));
    const expected = encodeAiRow(kind, record);
    if (Object.entries(expected).some(([column, value]) => row[column] !== value)) {
      throw new Error('AI 私有索引与记录正文不一致。');
    }
    return record;
  }
  /** @type {{contractVersion: number, kind: string, question?: string | null, resultJson?: object}} */
  const decoded = {
    contractVersion: 1,
    kind,
    ...Object.fromEntries(
      definition.fields.map(field => [
        field,
        jsonFields.has(field)
          ? row[column(field)] === null
            ? undefined
            : JSON.parse(row[column(field)])
          : booleanFields.has(field)
            ? Boolean(row[column(field)])
            : row[column(field)]
      ])
    )
  };
  if (kind === 'aiJob') {
    if (decoded.question === null) delete decoded.question;
    if (decoded.resultJson === undefined) delete decoded.resultJson;
  }
  return validateAiRecord(kind, decoded);
}
