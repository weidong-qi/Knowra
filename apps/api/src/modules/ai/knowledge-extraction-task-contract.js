import { createAppError } from '../../errors/app-error.js';
import { hashRecord } from './record-contract.ts';

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
export const taskError = (code, message, status = 409) => createAppError(code, message, status);
export const taskId = value =>
  typeof value === 'string' &&
  value.length > 0 &&
  value.length <= 200 &&
  value.trim() === value &&
  !/[^\P{Cc}\u007f-\u009f]/u.test(value);
export const taskKey = value => JSON.stringify([value.ownerId, value.datasetId, value.jobId]);
export const taskBoundary = (left, right) =>
  ['ownerId', 'datasetId', 'datasetEpoch', 'spaceId'].every(key => left[key] === right[key]);
export const taskTime = (now, previous) => new Date(Math.max(now.getTime(), Date.parse(previous) + 1)).toISOString();
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
];
const invalid = () => {
  throw taskError('KNOWLEDGE_EXTRACTION_TASK_INVALID', '提炼任务描述无效，已停止执行。', 422);
};

export function extractionCreationHash({ scopeId, scopeInputHash, inputHash }) {
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
export function validateExtractionTask(input) {
  if (
    !input ||
    typeof input !== 'object' ||
    Array.isArray(input) ||
    Object.keys(input).length !== fields.length ||
    fields.some(key => !Object.hasOwn(input, key)) ||
    input.schemaVersion !== 1 ||
    input.executionMode !== 'mock' ||
    input.profileVersion !== EXTRACTION_MOCK_PROFILE.version ||
    input.maxTokens !== EXTRACTION_MOCK_PROFILE.maxTokens ||
    ['ownerId', 'datasetId', 'datasetEpoch', 'spaceId', 'jobId', 'scopeId'].some(key => !taskId(input[key])) ||
    ['scopeInputHash', 'inputHash', 'creationHash', 'recordHash'].some(
      key => typeof input[key] !== 'string' || !/^[a-f0-9]{64}$/.test(input[key])
    ) ||
    typeof input.createdAt !== 'string' ||
    !Number.isFinite(Date.parse(input.createdAt))
  )
    invalid();
  const { recordHash, ...content } = input;
  if (recordHash !== hashRecord(content) || input.creationHash !== extractionCreationHash(input)) invalid();
  return structuredClone(input);
}

export function validateExtractionTaskState(input = { version: 1, tasks: [] }) {
  if (
    !input ||
    Array.isArray(input) ||
    input.version !== 1 ||
    Object.keys(input).length !== 2 ||
    !Array.isArray(input.tasks)
  )
    invalid();
  const tasks = input.tasks.map(validateExtractionTask);
  if (new Set(tasks.map(taskKey)).size !== tasks.length) invalid();
  return { version: 1, tasks };
}

export function assertMockGateway(gateway) {
  if (typeof gateway?.complete !== 'function' || gateway.capabilities?.().provider !== 'mock') {
    throw taskError(
      'KNOWLEDGE_EXTRACTION_MOCK_ONLY',
      '本提炼任务仅允许受信宿主注入 Mock，不读取凭据或调用真实供应商。'
    );
  }
}

export function runTaskSteps(steps, asyncDomain) {
  if (asyncDomain)
    return (async () => {
      let current = steps.next();
      while (!current.done) current = steps.next(await current.value);
      return current.value;
    })();
  let current = steps.next();
  while (!current.done) {
    if (current.value?.then) throw new TypeError('本地提炼事务不能包含异步操作。');
    current = steps.next(current.value);
  }
  return current.value;
}
