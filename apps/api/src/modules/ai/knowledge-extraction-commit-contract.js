import { createAppError } from '../../errors/app-error.js';
import { hashRecord } from './record-contract.ts';
import { validateKnowledgeExtractionResult } from '../knowledge/application/knowledge-extraction-contract.js';

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
];
const identifier = value =>
  typeof value === 'string' &&
  value.length > 0 &&
  value.length <= 200 &&
  value.trim() === value &&
  !/[^\P{Cc}\u007f-\u009f]/u.test(value);
const invalid = () => {
  throw createAppError('KNOWLEDGE_EXTRACTION_COMMIT_INVALID', '提炼提交记录无效，已停止接纳。', 422);
};
const exact = (value, fields) =>
  value &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  Object.keys(value).length === fields.length &&
  fields.every(field => Object.hasOwn(value, field));
const digest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
export const knowledgeExtractionCommitKey = value => JSON.stringify([value.ownerId, value.datasetId, value.jobId]);

/** 独立核心提交记录 v1；完整结果与精确来源保留在执行宿主，尚不进入普通同步/快照。 */
export function validateKnowledgeExtractionCommit(input) {
  if (
    !input ||
    typeof input !== 'object' ||
    Array.isArray(input) ||
    Object.keys(input).length !== keys.length ||
    keys.some(key => !Object.hasOwn(input, key)) ||
    input.schemaVersion !== 1 ||
    input.executionMode !== 'mock' ||
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
    ].some(key => !identifier(input[key])) ||
    typeof input.committedAt !== 'string' ||
    !Number.isFinite(Date.parse(input.committedAt))
  )
    invalid();
  const request = input.request;
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
      ['sourceId', 'noteId', 'noteVersionId'].some(field => !identifier(source[field])) ||
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
  const plan = validateKnowledgeExtractionResult({ request: input.request, result: input.result });
  if (
    input.scopeId !== input.request.scopeId ||
    input.spaceId !== input.request.spaceId ||
    input.requestId !== plan.requestId ||
    input.inputHash !== plan.inputHash ||
    input.outputHash !== plan.outputHash ||
    plan.candidates.length > 20 ||
    hashRecord(input.candidates) !== hashRecord(plan.candidates)
  )
    invalid();
  const { receiptHash, ...content } = input;
  if (receiptHash !== hashRecord(content)) invalid();
  return structuredClone(input);
}

export function validateKnowledgeExtractionCommitState(input = { version: 1, receipts: [] }) {
  if (!input || input.version !== 1 || Object.keys(input).length !== 2 || !Array.isArray(input.receipts)) invalid();
  const receipts = input.receipts.map(validateKnowledgeExtractionCommit);
  if (new Set(receipts.map(knowledgeExtractionCommitKey)).size !== receipts.length) invalid();
  return { version: 1, receipts };
}
