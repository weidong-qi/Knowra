import { createAppError } from '../../errors/app-error.ts';
import { hashRecord } from './record-contract.ts';

import type {
  ExtractionTaskBoundary,
  ExtractionTaskDescriptor,
  ExtractionTaskState,
  ExtractionMockGateway,
  RawExtractionIndexKey
} from './knowledge-extraction-task-types.ts';

export const EXTRACTION_MOCK_PROFILE = Object.freeze({
  version: 'knowledge-extraction-mock-v1',
  modelId: 'mock-knowledge-extraction-v1',
  credentialRef: 'mock:no-credential',
  maxTokens: 8192,
  maxTargets: 20,
  maxAttempts: 4,
  leaseMs: 120_000,
  grantMs: 300_000
});
export const taskError = (code: string, message: string, status = 409) => createAppError(code, message, status);
export const taskId = (value: unknown): value is string =>
  typeof value === 'string' &&
  value.length > 0 &&
  value.length <= 200 &&
  value.trim() === value &&
  !/[^\P{Cc}\u007f-\u009f]/u.test(value);
export const taskKey = (value: RawExtractionIndexKey) => JSON.stringify([value.ownerId, value.datasetId, value.jobId]);
export const taskBoundary = (left: ExtractionTaskBoundary, right: ExtractionTaskBoundary) =>
  (['ownerId', 'datasetId', 'datasetEpoch', 'spaceId'] as const).every(key => left[key] === right[key]);
export const taskTime = (now: Date, previous: string) =>
  new Date(Math.max(now.getTime(), Date.parse(previous) + 1)).toISOString();
const fields = [
  'schemaVersion',
  'ownerId',
  'datasetId',
  'datasetEpoch',
  'spaceId',
  'jobId',
  'scopeId',
  'scopeInputHash',
  'inputHash',
  'executionMode',
  'profileVersion',
  'maxTokens',
  'creationHash',
  'createdAt',
  'recordHash'
] as const;
const invalid = (): never => {
  throw taskError('KNOWLEDGE_EXTRACTION_TASK_INVALID', '提炼任务描述无效，已停止执行。', 422);
};

export function extractionCreationHash({
  scopeId,
  scopeInputHash,
  inputHash
}: Pick<ExtractionTaskDescriptor, 'scopeId' | 'scopeInputHash' | 'inputHash'>) {
  return hashRecord({
    scopeId,
    scopeInputHash,
    inputHash,
    executionMode: 'mock',
    ...EXTRACTION_MOCK_PROFILE,
    promptVersion: 'knowledge-extraction-v1',
    resultSchemaVersion: 'knowledge-extraction-v1'
  });
}

/** 私有任务绑定，不修改冻结 AIJob v1，不进入普通业务快照或同步。 */
export function validateExtractionTask(input: unknown): ExtractionTaskDescriptor {
  const record = input as ExtractionTaskDescriptor;
  if (
    !record ||
    typeof record !== 'object' ||
    Array.isArray(record) ||
    Object.keys(record).length !== fields.length ||
    fields.some(key => !Object.hasOwn(record, key)) ||
    record.schemaVersion !== 1 ||
    record.executionMode !== 'mock' ||
    record.profileVersion !== EXTRACTION_MOCK_PROFILE.version ||
    record.maxTokens !== EXTRACTION_MOCK_PROFILE.maxTokens ||
    (['ownerId', 'datasetId', 'datasetEpoch', 'spaceId', 'jobId', 'scopeId'] as const).some(
      key => !taskId(record[key])
    ) ||
    (['scopeInputHash', 'inputHash', 'creationHash', 'recordHash'] as const).some(
      key => typeof record[key] !== 'string' || !/^[a-f0-9]{64}$/.test(record[key])
    ) ||
    typeof record.createdAt !== 'string' ||
    !Number.isFinite(Date.parse(record.createdAt))
  )
    invalid();
  const { recordHash, ...content } = record;
  if (recordHash !== hashRecord(content) || record.creationHash !== extractionCreationHash(record)) invalid();
  return structuredClone(record);
}

export function validateExtractionTaskState(input: unknown = { version: 1, tasks: [] }): ExtractionTaskState {
  const state = input as { version: number; tasks: unknown[] };
  if (
    !state ||
    Array.isArray(state) ||
    state.version !== 1 ||
    Object.keys(state).length !== 2 ||
    !Array.isArray(state.tasks)
  )
    invalid();
  const tasks = state.tasks.map(validateExtractionTask);
  if (new Set(tasks.map(taskKey)).size !== tasks.length) invalid();
  return { version: 1, tasks };
}

export function assertMockGateway(gateway: unknown): asserts gateway is ExtractionMockGateway {
  const candidate = gateway as Partial<ExtractionMockGateway> | null | undefined;
  if (typeof candidate?.complete !== 'function' || candidate.capabilities?.().provider !== 'mock') {
    throw taskError(
      'KNOWLEDGE_EXTRACTION_MOCK_ONLY',
      '本提炼任务仅允许受信宿主注入 Mock，不读取凭据或调用真实供应商。'
    );
  }
}

export function runTaskSteps<Value, Result>(
  steps: Generator<Value | PromiseLike<Value>, Result, Value>,
  asyncDomain: boolean
): Result | Promise<Result> {
  if (asyncDomain)
    return (async () => {
      let current = steps.next();
      while (!current.done) current = steps.next((await current.value) as Value);
      return current.value;
    })();
  let current = steps.next();
  while (!current.done) {
    if ((current.value as { then?: object } | null | undefined)?.then)
      throw new TypeError('本地提炼事务不能包含异步操作。');
    current = steps.next(current.value as Value);
  }
  return current.value;
}
