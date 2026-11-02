import type { AppError } from '../../errors/app-error.ts';
import type { RawAiEvent } from './record-infrastructure-types.ts';
import type {
  AiRecord,
  AiRecordDefinitions,
  AiRecordKind,
  AiRecordByKind,
  AiScopeSnapshot,
  AiContextManifest,
  AiGrant,
  AiJob,
  AiUsageRecord,
  AiSourceRef,
  AiEvent
} from './record-types.ts';
import type { ValidateFunction } from 'ajv';
import { createHash } from 'node:crypto';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import schema from './contracts/ai-v1.schema.json' with { type: 'json' };

export const AI_RECORD_KINDS: Readonly<AiRecordDefinitions> = Object.freeze({
  scopeSnapshot: { collection: 'scopeSnapshots', id: 'scopeSnapshotId' },
  contextManifest: { collection: 'contextManifests', id: 'manifestId' },
  aiGrant: { collection: 'grants', id: 'grantId' },
  aiJob: { collection: 'jobs', id: 'jobId' },
  aiJobAttempt: { collection: 'attempts', id: 'attemptId' },
  aiUsageRecord: { collection: 'usageRecords', id: 'usageId' }
});

const ajv = new (Ajv2020 as unknown as typeof import('ajv/dist/2020.js').Ajv2020)({
  allErrors: true,
  strict: false
});
(addFormats as unknown as import('ajv-formats').FormatsPlugin)(ajv);
ajv.addSchema(schema);
const validators: Record<string, ValidateFunction<AiRecord>> = Object.fromEntries(
  Object.keys(AI_RECORD_KINDS).map(kind => [kind, ajv.compile<AiRecord>({ $ref: `${schema.$id}#/$defs/${kind}` })])
);

export function canonicalJson<Value>(value: Value): string | undefined {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map(
        key =>
          `${JSON.stringify(key)}:${canonicalJson((value as Record<string, object | string | number | boolean | bigint | symbol | null | undefined>)[key])}`
      )
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

export function hashRecord<Value>(value: Value) {
  return createHash('sha256')
    .update(canonicalJson(value) as string)
    .digest('hex');
}

export function scopeHash<Scope extends object>(scope: Scope) {
  const { scopeHash: ignored, ...content } = scope as Scope & { scopeHash?: string };
  return hashRecord(content);
}

export function manifestHash<Value>(manifest: Value) {
  return hashRecord(manifest);
}

function invalid(message: string): never {
  const error: Error & Partial<Pick<AppError, 'code'>> = new Error(message);
  error.code = 'AI_RECORD_INVALID';
  throw error;
}

export function validateAiRecord<Kind extends AiRecordKind>(kind: Kind, input: unknown): AiRecordByKind[Kind];
export function validateAiRecord(kind: AiRecordKind, input: unknown): AiRecord {
  const validate = validators[kind];
  if (!validate) invalid('未知的 AI 记录类型。');
  const record = structuredClone(input);
  if (!validate(record)) invalid(`AI ${kind} 记录不符合 v1 契约：${ajv.errorsText(validate.errors)}`);
  if (record.kind !== kind) invalid('AI 记录类型不匹配。');
  if (kind === 'scopeSnapshot') {
    if ((record as AiScopeSnapshot).scopeHash !== scopeHash(record)) invalid('范围哈希与快照不一致。');
    for (const source of (record as AiScopeSnapshot).allowedSources) validateSource(source);
    if ((record as AiScopeSnapshot).scopeKind === 'empty' && (record as AiScopeSnapshot).allowedSources.length)
      invalid('空范围不能包含来源。');
  }
  if (kind === 'contextManifest') {
    for (const source of (record as AiContextManifest).sources) validateSource(source);
    if ((record as AiContextManifest).attachmentIds.length) invalid('v1 不允许发送附件。');
    if ((record as AiContextManifest).scopeKind === 'empty' && (record as AiContextManifest).sources.length)
      invalid('空范围不能发送来源。');
  }
  if (kind === 'aiGrant' && Date.parse((record as AiGrant).expiresAt) <= Date.parse((record as AiGrant).issuedAt)) {
    invalid('授权有效期无效。');
  }
  if (
    kind === 'aiJob' &&
    (record as AiJob).resultJson &&
    ((record as AiJob).status !== 'succeeded' ||
      (record as AiJob).outputHash !== hashRecord((record as AiJob).resultJson))
  )
    invalid('任务结果与状态或哈希不一致。');
  if (
    kind === 'aiUsageRecord' &&
    (record as AiUsageRecord).usageUnknown &&
    (record as AiUsageRecord).actualMicrounits !== null
  ) {
    invalid('未知用量不能写成已知实际费用。');
  }
  return record;
}

function validateSource(source: AiSourceRef) {
  if (source.end <= source.start || source.characters !== source.end - source.start) {
    invalid('来源范围或字符数无效。');
  }
}

export function validateAiEvent(input: unknown): AiEvent {
  if (
    !input ||
    typeof input !== 'object' ||
    Array.isArray(input) ||
    Object.keys(input).some(key => !['jobId', 'sequence', 'eventKind', 'safePayload', 'createdAt'].includes(key)) ||
    typeof (input as RawAiEvent).jobId !== 'string' ||
    !(input as RawAiEvent).jobId ||
    !Number.isSafeInteger((input as RawAiEvent).sequence) ||
    ((input as RawAiEvent).sequence as number) < 1 ||
    typeof (input as RawAiEvent).eventKind !== 'string' ||
    !/^[a-zA-Z][a-zA-Z0-9_]{0,79}$/.test((input as RawAiEvent).eventKind as string) ||
    typeof (input as RawAiEvent).createdAt !== 'string' ||
    Number.isNaN(Date.parse((input as RawAiEvent).createdAt as string)) ||
    !(input as RawAiEvent).safePayload ||
    typeof (input as RawAiEvent).safePayload !== 'object' ||
    Array.isArray((input as RawAiEvent).safePayload)
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
    Object.keys((input as RawAiEvent).safePayload as object).some(key => !allowed.has(key)) ||
    Buffer.byteLength(JSON.stringify((input as RawAiEvent).safePayload)) > 2048 ||
    Object.values((input as RawAiEvent).safePayload as Record<string, unknown>).some(
      value => !['string', 'number', 'boolean'].includes(typeof value)
    )
  ) {
    invalid('AI 事件只能保存安全摘要。');
  }
  for (const [key, value] of Object.entries((input as RawAiEvent).safePayload as Record<string, unknown>)) {
    if (typeof value === 'string' && (value.length > 128 || !/^[a-zA-Z0-9_.:-]+$/.test(value))) {
      invalid(`AI 事件的 ${key} 只能包含简短的标识符。`);
    }
  }
  return structuredClone(input) as AiEvent;
}
