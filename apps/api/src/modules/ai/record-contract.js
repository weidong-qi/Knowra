import { createHash } from 'node:crypto';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import schema from './contracts/ai-v1.schema.json' with { type: 'json' };

export const AI_RECORD_KINDS = Object.freeze({
  scopeSnapshot: { collection: 'scopeSnapshots', id: 'scopeSnapshotId' },
  contextManifest: { collection: 'contextManifests', id: 'manifestId' },
  aiGrant: { collection: 'grants', id: 'grantId' },
  aiJob: { collection: 'jobs', id: 'jobId' },
  aiJobAttempt: { collection: 'attempts', id: 'attemptId' },
  aiUsageRecord: { collection: 'usageRecords', id: 'usageId' }
});

const ajv = new /** @type {typeof import('ajv/dist/2020.js').Ajv2020} */ (/** @type {unknown} */ (Ajv2020))({
  allErrors: true,
  strict: false
});
/** @type {import('ajv-formats').FormatsPlugin} */ (/** @type {unknown} */ (addFormats))(ajv);
ajv.addSchema(schema);
const validators = Object.fromEntries(
  Object.keys(AI_RECORD_KINDS).map(kind => [kind, ajv.compile({ $ref: `${schema.$id}#/$defs/${kind}` })])
);

export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

export function hashRecord(value) {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

export function scopeHash(scope) {
  const { scopeHash: ignored, ...content } = scope;
  return hashRecord(content);
}

export function manifestHash(manifest) {
  return hashRecord(manifest);
}

function invalid(message) {
  /** @type {Error & Partial<Pick<import('../../errors/app-error.ts').AppError, 'code'>>} */
  const error = new Error(message);
  error.code = 'AI_RECORD_INVALID';
  throw error;
}

export function validateAiRecord(kind, input) {
  const validate = validators[kind];
  if (!validate) invalid('未知的 AI 记录类型。');
  const record = structuredClone(input);
  if (!validate(record)) invalid(`AI ${kind} 记录不符合 v1 契约：${ajv.errorsText(validate.errors)}`);
  if (record.kind !== kind) invalid('AI 记录类型不匹配。');
  if (kind === 'scopeSnapshot') {
    if (record.scopeHash !== scopeHash(record)) invalid('范围哈希与快照不一致。');
    for (const source of record.allowedSources) validateSource(source);
    if (record.scopeKind === 'empty' && record.allowedSources.length) invalid('空范围不能包含来源。');
  }
  if (kind === 'contextManifest') {
    for (const source of record.sources) validateSource(source);
    if (record.attachmentIds.length) invalid('v1 不允许发送附件。');
    if (record.scopeKind === 'empty' && record.sources.length) invalid('空范围不能发送来源。');
  }
  if (kind === 'aiGrant' && Date.parse(record.expiresAt) <= Date.parse(record.issuedAt)) {
    invalid('授权有效期无效。');
  }
  if (
    kind === 'aiJob' &&
    record.resultJson &&
    (record.status !== 'succeeded' || record.outputHash !== hashRecord(record.resultJson))
  )
    invalid('任务结果与状态或哈希不一致。');
  if (kind === 'aiUsageRecord' && record.usageUnknown && record.actualMicrounits !== null) {
    invalid('未知用量不能写成已知实际费用。');
  }
  return record;
}

function validateSource(source) {
  if (source.end <= source.start || source.characters !== source.end - source.start) {
    invalid('来源范围或字符数无效。');
  }
}

export function validateAiEvent(input) {
  if (
    !input ||
    typeof input !== 'object' ||
    Array.isArray(input) ||
    Object.keys(input).some(key => !['jobId', 'sequence', 'eventKind', 'safePayload', 'createdAt'].includes(key)) ||
    typeof input.jobId !== 'string' ||
    !input.jobId ||
    !Number.isSafeInteger(input.sequence) ||
    input.sequence < 1 ||
    typeof input.eventKind !== 'string' ||
    !/^[a-zA-Z][a-zA-Z0-9_]{0,79}$/.test(input.eventKind) ||
    typeof input.createdAt !== 'string' ||
    Number.isNaN(Date.parse(input.createdAt)) ||
    !input.safePayload ||
    typeof input.safePayload !== 'object' ||
    Array.isArray(input.safePayload)
  )
    invalid('AI 事件格式无效。');
  const allowed = new Set([
    'phase',
    'status',
    'attemptId',
    'usageId',
    'code',
    'deliveryUncertain',
    'stage',
    'priceVersion',
    'inputUpperBoundBytes',
    'maxOutputTokens',
    'sourceCount',
    'reservedMicrounits',
    'responseId',
    'finishReason',
    'inputTokens',
    'outputTokens',
    'usageUnknown',
    'actualMicrounits',
    'budgetDisposition',
    'httpStatus'
  ]);
  if (
    Object.keys(input.safePayload).some(key => !allowed.has(key)) ||
    Buffer.byteLength(JSON.stringify(input.safePayload)) > 2048 ||
    Object.values(input.safePayload).some(value => !['string', 'number', 'boolean'].includes(typeof value))
  ) {
    invalid('AI 事件只能保存安全摘要。');
  }
  for (const [key, value] of Object.entries(input.safePayload)) {
    if (typeof value === 'string' && (value.length > 128 || !/^[a-zA-Z0-9_.:-]+$/.test(value))) {
      invalid(`AI 事件的 ${key} 只能包含简短的标识符。`);
    }
  }
  return structuredClone(input);
}
