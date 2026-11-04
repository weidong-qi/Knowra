import type { AppError } from '../../errors/app-error.ts';
import type { AiRecordFields } from './record-infrastructure-types.ts';
import type {
  AiRecord,
  AiRecordByKind,
  AiRecordKind,
  AiRecordStorage,
  SyncAiRecordRepository,
  AiContextManifest,
  AiGrant,
  AiJob,
  AiJobAttempt,
  AiUsageRecord
} from './record-types.ts';
import { AI_RECORD_KINDS, hashRecord, manifestHash, validateAiEvent, validateAiRecord } from './record-contract.ts';

function reject(code: string, message: string): never {
  const error: Error & Partial<Pick<AppError, 'code'>> = new Error(message);
  error.code = code;
  throw error;
}

function sameBoundary(left: AiRecord, right: AiRecord) {
  return ['ownerId', 'datasetId', 'datasetEpoch', 'spaceId'].every(
    key =>
      (left as AiRecordFields)[key as keyof AiRecordFields] === (right as AiRecordFields)[key as keyof AiRecordFields]
  );
}

function requireParent<Kind extends AiRecordKind>(
  storage: AiRecordStorage,
  kind: Kind,
  id: string,
  record: AiRecord
): AiRecordByKind[Kind] {
  const parent = storage.get(kind, id);
  if (!parent || !sameBoundary(parent, record)) reject('AI_REFERENCE_INVALID', 'AI 记录引用不存在或越过资料范围。');
  return parent;
}

function validateLinks(storage: AiRecordStorage, kind: AiRecordKind, record: AiRecord) {
  if (kind === 'contextManifest') {
    const scope = requireParent(storage, 'scopeSnapshot', (record as AiContextManifest).scopeSnapshotId, record);
    if (
      (record as AiContextManifest).scopeHash !== scope.scopeHash ||
      (record as AiContextManifest).scopeKind !== scope.scopeKind
    )
      reject('AI_REFERENCE_INVALID', '上下文与范围快照不一致。');
    const allowed = new Map(scope.allowedSources.map(source => [source.sourceId, source]));
    if (
      (record as AiContextManifest).sources.some(
        source => !allowed.has(source.sourceId) || hashRecord(allowed.get(source.sourceId)) !== hashRecord(source)
      ) ||
      (record as AiContextManifest).sources.some(source => scope.excludedSourceIds.includes(source.sourceId))
    ) {
      reject('AI_SCOPE_EXCEEDED', '上下文来源超出授权范围。');
    }
  } else if (kind === 'aiGrant') {
    const scope = requireParent(storage, 'scopeSnapshot', (record as AiGrant).scopeSnapshotId, record);
    if ((record as AiGrant).scopeHash !== scope.scopeHash) reject('AI_REFERENCE_INVALID', '授权范围哈希不一致。');
  } else if (kind === 'aiJob') {
    const grant = requireParent(storage, 'aiGrant', (record as AiJob).grantId, record);
    const manifest = requireParent(storage, 'contextManifest', (record as AiJob).manifestId, record);
    if ((record as AiJob).parentJobId) requireParent(storage, 'aiJob', (record as AiJob).parentJobId!, record);
    if (
      grant.scopeSnapshotId !== manifest.scopeSnapshotId ||
      grant.scopeHash !== manifest.scopeHash ||
      (record as AiJob).manifestHash !== manifestHash(manifest) ||
      (record as AiJob).provider !== manifest.recipient ||
      grant.revokedAt ||
      Date.parse(grant.expiresAt) <= Date.parse((record as AiJob).createdAt)
    ) {
      reject('AI_REFERENCE_INVALID', '任务的授权或上下文已失效。');
    }
  } else if (kind === 'aiJobAttempt') {
    const job = storage.get('aiJob', (record as AiJobAttempt).jobId);
    if (!job || job.datasetEpoch !== storage.identity().datasetEpoch)
      reject('AI_REFERENCE_INVALID', '任务不存在或资料集已切换。');
    if (
      (storage.list(kind) as AiJobAttempt[]).some(
        attempt =>
          attempt.jobId === (record as AiJobAttempt).jobId &&
          (attempt.ordinal === (record as AiJobAttempt).ordinal ||
            attempt.leaseGeneration === (record as AiJobAttempt).leaseGeneration)
      )
    ) {
      reject('AI_RECORD_DUPLICATE', '任务尝试序号或租约代数重复。');
    }
  } else if (kind === 'aiUsageRecord') {
    const attempt = storage.get('aiJobAttempt', (record as AiUsageRecord).attemptId);
    const job = storage.get('aiJob', (record as AiUsageRecord).jobId);
    if (
      !attempt ||
      attempt.jobId !== (record as AiUsageRecord).jobId ||
      !job ||
      job.datasetEpoch !== storage.identity().datasetEpoch
    )
      reject('AI_REFERENCE_INVALID', '用量记录没有当前资料集的任务尝试。');
    if ((storage.list(kind) as AiUsageRecord[]).some(usage => usage.attemptId === (record as AiUsageRecord).attemptId))
      reject('AI_RECORD_DUPLICATE', '任务尝试已有用量记录。');
  }
}

const JOB_TRANSITIONS: Record<AiJob['status'], AiJob['status'][]> = {
  pending: ['running', 'cancelling', 'failed'],
  running: ['succeeded', 'failed', 'cancelling'],
  failed: ['retrying'],
  retrying: ['running', 'cancelling', 'failed'],
  cancelling: ['cancelled'],
  cancelled: [],
  succeeded: []
};
const MUTABLE_FIELDS: Partial<Record<AiRecordKind, string[]>> = {
  aiGrant: ['revokedAt'],
  aiJob: ['status', 'phase', 'acceptedAttemptId', 'outputHash', 'resultJson', 'updatedAt'],
  aiJobAttempt: ['status', 'leaseExpiresAt', 'providerRequestId', 'deliveryUncertain', 'finishedAt']
};

/** 仅受信应用服务可使用；不暴露 HTTP/IPC 写入路由。 */
export function createAiRecordRepository(storage: AiRecordStorage): SyncAiRecordRepository {
  function assertCurrent(record: AiRecord) {
    if (!Object.hasOwn(record, 'datasetId')) return;
    const identity = storage.identity();
    if (
      (record as AiRecordFields).datasetId !== identity.datasetId ||
      (record as AiRecordFields).datasetEpoch !== identity.datasetEpoch
    ) {
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
    /** @param {import('./record-types.ts').AiRecordKind} kind
     * @param {import('./record-infrastructure-types.ts').AiRecordFields} [filter] */
    list(kind, filter = {}) {
      if (!AI_RECORD_KINDS[kind]) reject('AI_RECORD_INVALID', '未知的 AI 记录类型。');
      return storage
        .list(kind)
        .filter(record =>
          Object.entries(filter).every(
            ([key, value]) => (record as AiRecordFields)[key as keyof AiRecordFields] === value
          )
        )
        .map(record => structuredClone(record));
    },
    insert<Kind extends AiRecordKind>(kind: Kind, input: AiRecordByKind[Kind]): AiRecordByKind[Kind] {
      return storage.transaction(() => {
        const record = validateAiRecord(kind, input);
        assertCurrent(record);
        if (kind === 'aiJob') {
          const sameKey = (storage.list(kind) as AiJob[]).find(
            job =>
              job.ownerId === (record as AiJob).ownerId &&
              job.datasetId === (record as AiJob).datasetId &&
              job.spaceId === (record as AiJob).spaceId &&
              job.jobKind === (record as AiJob).jobKind &&
              job.idempotencyKey === (record as AiJob).idempotencyKey
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
              ].some(
                key =>
                  (sameKey as AiRecordFields)[key as keyof AiRecordFields] !==
                  (record as AiRecordFields)[key as keyof AiRecordFields]
              )
            ) {
              reject('AI_IDEMPOTENCY_CONFLICT', '任务幂等键已绑定其他输入。');
            }
            return structuredClone(sameKey) as AiRecordByKind[Kind];
          }
          if ((storage.list(kind) as AiJob[]).some(job => job.requestId === (record as AiJob).requestId))
            reject('AI_RECORD_DUPLICATE', '请求 ID 已使用。');
        }
        const id = (record as AiRecordFields)[AI_RECORD_KINDS[kind].id] as string;
        if (storage.get(kind, id)) reject('AI_RECORD_DUPLICATE', 'AI 记录 ID 已存在。');
        validateLinks(storage, kind, record);
        storage.insert(kind, record);
        return structuredClone(record);
      });
    },
    replace<Kind extends AiRecordKind>(
      kind: Kind,
      input: AiRecordByKind[Kind],
      expectedHash: string
    ): AiRecordByKind[Kind] {
      return storage.transaction(() => {
        if (!MUTABLE_FIELDS[kind]) reject('AI_RECORD_IMMUTABLE', '此类 AI 记录不可更改。');
        const record = validateAiRecord(kind, input);
        assertCurrent(record);
        const previous = storage.get(kind, (record as AiRecordFields)[AI_RECORD_KINDS[kind].id] as string);
        if (!previous) reject('AI_RECORD_NOT_FOUND', 'AI 记录不存在。');
        if (hashRecord(previous) !== expectedHash) reject('AI_RECORD_CONFLICT', 'AI 记录已变化，请重新读取。');
        const mutable = new Set(MUTABLE_FIELDS[kind]);
        if (
          Object.keys(record).some(
            key =>
              !mutable.has(key) &&
              hashRecord((record as AiRecordFields)[key as keyof AiRecordFields]) !==
                hashRecord((previous as AiRecordFields)[key as keyof AiRecordFields])
          )
        ) {
          reject('AI_RECORD_IMMUTABLE', 'AI 记录的不可变字段发生变化。');
        }
        if (kind === 'aiGrant' && ((previous as AiGrant).revokedAt !== null || (record as AiGrant).revokedAt === null))
          reject('AI_RECORD_INVALID', '授权只能撤销一次。');
        if (kind === 'aiJob') {
          if (
            (record as AiJob).status !== (previous as AiJob).status &&
            !JOB_TRANSITIONS[(previous as AiJob).status].includes((record as AiJob).status)
          )
            reject('AI_RECORD_INVALID', '任务状态转换无效。');
          if (Date.parse((record as AiJob).updatedAt) <= Date.parse((previous as AiJob).updatedAt))
            reject('AI_RECORD_INVALID', '任务更新时间必须递增。');
          if (
            (previous as AiJob).acceptedAttemptId &&
            (record as AiJob).acceptedAttemptId !== (previous as AiJob).acceptedAttemptId
          ) {
            reject('AI_RECORD_INVALID', '已接纳的任务尝试不可更换。');
          }
          if (
            (previous as AiJob).resultJson &&
            hashRecord((record as AiJob).resultJson) !== hashRecord((previous as AiJob).resultJson)
          ) {
            reject('AI_RECORD_IMMUTABLE', '已保存的任务结果不可更改。');
          }
          if ((record as AiJob).acceptedAttemptId) {
            const attempt = storage.get('aiJobAttempt', (record as AiJob).acceptedAttemptId!);
            if (!attempt || attempt.jobId !== (record as AiJob).jobId)
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
