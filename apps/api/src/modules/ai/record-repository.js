import { AI_RECORD_KINDS, hashRecord, manifestHash, validateAiEvent, validateAiRecord } from './record-contract.js';

function reject(code, message) {
  /** @type {Error & Partial<Pick<import('../../errors/app-error.ts').AppError, 'code'>>} */
  const error = new Error(message);
  error.code = code;
  throw error;
}

function sameBoundary(left, right) {
  return ['ownerId', 'datasetId', 'datasetEpoch', 'spaceId'].every(key => left[key] === right[key]);
}

function requireParent(storage, kind, id, record) {
  const parent = storage.get(kind, id);
  if (!parent || !sameBoundary(parent, record)) reject('AI_REFERENCE_INVALID', 'AI 记录引用不存在或越过资料范围。');
  return parent;
}

function validateLinks(storage, kind, record) {
  if (kind === 'contextManifest') {
    const scope = requireParent(storage, 'scopeSnapshot', record.scopeSnapshotId, record);
    if (record.scopeHash !== scope.scopeHash || record.scopeKind !== scope.scopeKind)
      reject('AI_REFERENCE_INVALID', '上下文与范围快照不一致。');
    const allowed = new Map(scope.allowedSources.map(source => [source.sourceId, source]));
    if (
      record.sources.some(
        source => !allowed.has(source.sourceId) || hashRecord(allowed.get(source.sourceId)) !== hashRecord(source)
      ) ||
      record.sources.some(source => scope.excludedSourceIds.includes(source.sourceId))
    ) {
      reject('AI_SCOPE_EXCEEDED', '上下文来源超出授权范围。');
    }
  } else if (kind === 'aiGrant') {
    const scope = requireParent(storage, 'scopeSnapshot', record.scopeSnapshotId, record);
    if (record.scopeHash !== scope.scopeHash) reject('AI_REFERENCE_INVALID', '授权范围哈希不一致。');
  } else if (kind === 'aiJob') {
    const grant = requireParent(storage, 'aiGrant', record.grantId, record);
    const manifest = requireParent(storage, 'contextManifest', record.manifestId, record);
    if (record.parentJobId) requireParent(storage, 'aiJob', record.parentJobId, record);
    if (
      grant.scopeSnapshotId !== manifest.scopeSnapshotId ||
      grant.scopeHash !== manifest.scopeHash ||
      record.manifestHash !== manifestHash(manifest) ||
      record.provider !== manifest.recipient ||
      grant.revokedAt ||
      Date.parse(grant.expiresAt) <= Date.parse(record.createdAt)
    ) {
      reject('AI_REFERENCE_INVALID', '任务的授权或上下文已失效。');
    }
  } else if (kind === 'aiJobAttempt') {
    const job = storage.get('aiJob', record.jobId);
    if (!job || job.datasetEpoch !== storage.identity().datasetEpoch)
      reject('AI_REFERENCE_INVALID', '任务不存在或资料集已切换。');
    if (
      storage
        .list(kind)
        .some(
          attempt =>
            attempt.jobId === record.jobId &&
            (attempt.ordinal === record.ordinal || attempt.leaseGeneration === record.leaseGeneration)
        )
    ) {
      reject('AI_RECORD_DUPLICATE', '任务尝试序号或租约代数重复。');
    }
  } else if (kind === 'aiUsageRecord') {
    const attempt = storage.get('aiJobAttempt', record.attemptId);
    const job = storage.get('aiJob', record.jobId);
    if (!attempt || attempt.jobId !== record.jobId || !job || job.datasetEpoch !== storage.identity().datasetEpoch)
      reject('AI_REFERENCE_INVALID', '用量记录没有当前资料集的任务尝试。');
    if (storage.list(kind).some(usage => usage.attemptId === record.attemptId))
      reject('AI_RECORD_DUPLICATE', '任务尝试已有用量记录。');
  }
}

const JOB_TRANSITIONS = {
  pending: ['running', 'cancelling', 'failed'],
  running: ['succeeded', 'failed', 'cancelling'],
  failed: ['retrying'],
  retrying: ['running', 'cancelling', 'failed'],
  cancelling: ['cancelled'],
  cancelled: [],
  succeeded: []
};
const MUTABLE_FIELDS = {
  aiGrant: ['revokedAt'],
  aiJob: ['status', 'phase', 'acceptedAttemptId', 'outputHash', 'resultJson', 'updatedAt'],
  aiJobAttempt: ['status', 'leaseExpiresAt', 'providerRequestId', 'deliveryUncertain', 'finishedAt']
};

/** 仅受信应用服务可使用；不暴露 HTTP/IPC 写入路由。 */
export function createAiRecordRepository(storage) {
  function assertCurrent(record) {
    if (!Object.hasOwn(record, 'datasetId')) return;
    const identity = storage.identity();
    if (record.datasetId !== identity.datasetId || record.datasetEpoch !== identity.datasetEpoch) {
      reject('AI_DATASET_STALE', '资料集已切换，旧 AI 任务不能写入。');
    }
  }

  return {
    identity: () => structuredClone(storage.identity()),
    get(kind, id) {
      if (!AI_RECORD_KINDS[kind]) reject('AI_RECORD_INVALID', '未知的 AI 记录类型。');
      const value = storage.get(kind, id);
      return value ? structuredClone(value) : null;
    },
    list(kind, filter = {}) {
      if (!AI_RECORD_KINDS[kind]) reject('AI_RECORD_INVALID', '未知的 AI 记录类型。');
      return storage
        .list(kind)
        .filter(record => Object.entries(filter).every(([key, value]) => record[key] === value))
        .map(record => structuredClone(record));
    },
    insert(kind, input) {
      return storage.transaction(() => {
        const record = validateAiRecord(kind, input);
        assertCurrent(record);
        if (kind === 'aiJob') {
          const sameKey = storage
            .list(kind)
            .find(
              job =>
                job.ownerId === record.ownerId &&
                job.datasetId === record.datasetId &&
                job.spaceId === record.spaceId &&
                job.jobKind === record.jobKind &&
                job.idempotencyKey === record.idempotencyKey
            );
          if (sameKey) {
            if (
              [
                'inputHash',
                'grantId',
                'manifestId',
                'manifestHash',
                'credentialRef',
                'provider',
                'modelId',
                'promptVersion',
                'resultSchemaVersion',
                'parentJobId'
              ].some(key => sameKey[key] !== record[key])
            ) {
              reject('AI_IDEMPOTENCY_CONFLICT', '任务幂等键已绑定其他输入。');
            }
            return structuredClone(sameKey);
          }
          if (storage.list(kind).some(job => job.requestId === record.requestId))
            reject('AI_RECORD_DUPLICATE', '请求 ID 已使用。');
        }
        const id = record[AI_RECORD_KINDS[kind].id];
        if (storage.get(kind, id)) reject('AI_RECORD_DUPLICATE', 'AI 记录 ID 已存在。');
        validateLinks(storage, kind, record);
        storage.insert(kind, record);
        return structuredClone(record);
      });
    },
    replace(kind, input, expectedHash) {
      return storage.transaction(() => {
        if (!MUTABLE_FIELDS[kind]) reject('AI_RECORD_IMMUTABLE', '此类 AI 记录不可更改。');
        const record = validateAiRecord(kind, input);
        assertCurrent(record);
        const previous = storage.get(kind, record[AI_RECORD_KINDS[kind].id]);
        if (!previous) reject('AI_RECORD_NOT_FOUND', 'AI 记录不存在。');
        if (hashRecord(previous) !== expectedHash) reject('AI_RECORD_CONFLICT', 'AI 记录已变化，请重新读取。');
        const mutable = new Set(MUTABLE_FIELDS[kind]);
        if (
          Object.keys(record).some(key => !mutable.has(key) && hashRecord(record[key]) !== hashRecord(previous[key]))
        ) {
          reject('AI_RECORD_IMMUTABLE', 'AI 记录的不可变字段发生变化。');
        }
        if (kind === 'aiGrant' && (previous.revokedAt !== null || record.revokedAt === null))
          reject('AI_RECORD_INVALID', '授权只能撤销一次。');
        if (kind === 'aiJob') {
          if (record.status !== previous.status && !JOB_TRANSITIONS[previous.status].includes(record.status))
            reject('AI_RECORD_INVALID', '任务状态转换无效。');
          if (Date.parse(record.updatedAt) <= Date.parse(previous.updatedAt))
            reject('AI_RECORD_INVALID', '任务更新时间必须递增。');
          if (previous.acceptedAttemptId && record.acceptedAttemptId !== previous.acceptedAttemptId) {
            reject('AI_RECORD_INVALID', '已接纳的任务尝试不可更换。');
          }
          if (previous.resultJson && hashRecord(record.resultJson) !== hashRecord(previous.resultJson)) {
            reject('AI_RECORD_IMMUTABLE', '已保存的任务结果不可更改。');
          }
          if (record.acceptedAttemptId) {
            const attempt = storage.get('aiJobAttempt', record.acceptedAttemptId);
            if (!attempt || attempt.jobId !== record.jobId)
              reject('AI_REFERENCE_INVALID', '任务接纳的尝试不属于当前任务。');
          }
        }
        storage.replace(kind, record);
        return structuredClone(record);
      });
    },
    appendEvent(input) {
      return storage.transaction(() => {
        const event = validateAiEvent(input);
        const job = storage.get('aiJob', event.jobId);
        if (!job || job.datasetEpoch !== storage.identity().datasetEpoch)
          reject('AI_REFERENCE_INVALID', '事件对应任务不存在或已失效。');
        const events = storage.listEvents(event.jobId);
        if (event.sequence !== events.length + 1) reject('AI_EVENT_SEQUENCE_INVALID', '任务事件序号不连续。');
        storage.insertEvent(event);
        return structuredClone(event);
      });
    },
    listEvents(jobId) {
      return storage.listEvents(jobId).map(event => structuredClone(event));
    },
    rotateEpoch: () => storage.rotateEpoch()
  };
}
