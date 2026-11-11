import { createAppError } from '../../errors/app-error.ts';
import { hashRecord } from './record-contract.ts';
import { validateKnowledgeExtractionResult } from '../knowledge/application/knowledge-extraction-contract.ts';

import type { KnowledgeExtractionCommitReceipt } from './knowledge-extraction-commit-types.ts';
import type { RawExtractionIndexKey } from './knowledge-extraction-task-types.ts';

const keys = [
  'schemaVersion',
  'executionMode',
  'ownerId',
  'datasetId',
  'datasetEpoch',
  'spaceId',
  'jobId',
  'attemptId',
  'scopeId',
  'requestId',
  'inputHash',
  'outputHash',
  'modelId',
  'promptVersion',
  'resultSchemaVersion',
  'committedAt',
  'request',
  'result',
  'candidates',
  'receiptHash'
] as const;
const identifier = (value: unknown) =>
  typeof value === 'string' &&
  value.length > 0 &&
  value.length <= 200 &&
  value.trim() === value &&
  !/[^\P{Cc}\u007f-\u009f]/u.test(value);
const invalid = (): never => {
  throw createAppError('KNOWLEDGE_EXTRACTION_COMMIT_INVALID', '提炼提交记录无效，已停止接纳。', 422);
};
const exact = (value: unknown, fields: readonly string[]) =>
  value &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  Object.keys(value).length === fields.length &&
  fields.every(field => Object.hasOwn(value, field));
const digest = (value: unknown) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
export const knowledgeExtractionCommitKey = (value: RawExtractionIndexKey) =>
  JSON.stringify([value.ownerId, value.datasetId, value.jobId]);

/** 独立核心提交记录 v1；完整结果与精确来源保留在执行宿主，尚不进入普通同步/快照。 */
export function validateKnowledgeExtractionCommit(input: unknown): KnowledgeExtractionCommitReceipt {
  // 结构视图只供原校验表达式读取；是否有效仍由下方完整运行时校验决定。
  const record = input as KnowledgeExtractionCommitReceipt;
  if (
    !record ||
    typeof record !== 'object' ||
    Array.isArray(record) ||
    Object.keys(record).length !== keys.length ||
    keys.some(key => !Object.hasOwn(record, key)) ||
    record.schemaVersion !== 1 ||
    record.executionMode !== 'mock' ||
    (
      [
        'ownerId',
        'datasetId',
        'datasetEpoch',
        'spaceId',
        'jobId',
        'attemptId',
        'scopeId',
        'requestId',
        'modelId',
        'promptVersion',
        'resultSchemaVersion'
      ] as const
    ).some(key => !identifier(record[key])) ||
    typeof record.committedAt !== 'string' ||
    !Number.isFinite(Date.parse(record.committedAt))
  )
    invalid();
  const request = record.request;
  if (
    !exact(request, ['contractVersion', 'requestId', 'scopeId', 'spaceId', 'inputHash', 'sources']) ||
    request.contractVersion !== 1 ||
    !Array.isArray(request.sources) ||
    request.sources.length < 1 ||
    request.sources.length > 128 ||
    !digest(request.inputHash) ||
    new Set(request.sources.map(source => source?.sourceId)).size !== request.sources.length
  )
    invalid();
  let characters = 0;
  for (const source of request.sources) {
    if (
      !exact(source, [
        'sourceId',
        'noteId',
        'noteVersionId',
        'contentHash',
        'start',
        'end',
        'markdown',
        'annotationRevisions'
      ]) ||
      (['sourceId', 'noteId', 'noteVersionId'] as const).some(field => !identifier(source[field])) ||
      !digest(source.contentHash) ||
      !Number.isSafeInteger(source.start) ||
      !Number.isSafeInteger(source.end) ||
      source.start < 0 ||
      source.end <= source.start ||
      typeof source.markdown !== 'string' ||
      source.markdown.length !== source.end - source.start ||
      !Array.isArray(source.annotationRevisions) ||
      source.annotationRevisions.some(
        revision =>
          !exact(revision, ['annotationId', 'revision']) ||
          !identifier(revision.annotationId) ||
          !Number.isSafeInteger(revision.revision) ||
          revision.revision < 1
      ) ||
      new Set(source.annotationRevisions.map(revision => revision.annotationId)).size !==
        source.annotationRevisions.length
    )
      invalid();
    characters += source.markdown.length;
  }
  if (characters > 120_000) invalid();
  const plan = validateKnowledgeExtractionResult({ request: record.request, result: record.result });
  if (
    record.scopeId !== record.request.scopeId ||
    record.spaceId !== record.request.spaceId ||
    record.requestId !== plan.requestId ||
    record.inputHash !== plan.inputHash ||
    record.outputHash !== plan.outputHash ||
    plan.candidates.length > 20 ||
    hashRecord(record.candidates) !== hashRecord(plan.candidates)
  )
    invalid();
  const { receiptHash, ...content } = record;
  if (receiptHash !== hashRecord(content)) invalid();
  return structuredClone(record);
}

export function validateKnowledgeExtractionCommitState(input: unknown = { version: 1, receipts: [] }): {
  version: 1;
  receipts: KnowledgeExtractionCommitReceipt[];
} {
  const state = input as { version: number; receipts: unknown[] };
  if (!state || state.version !== 1 || Object.keys(state).length !== 2 || !Array.isArray(state.receipts)) invalid();
  const receipts = state.receipts.map(validateKnowledgeExtractionCommit);
  if (new Set(receipts.map(knowledgeExtractionCommitKey)).size !== receipts.length) invalid();
  return { version: 1, receipts };
}
