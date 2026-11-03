import { cloneJsonData } from '../../infrastructure/json-clone.ts';
import { assertSyncContract } from './protocol-contract.ts';
import { assertSyncDeviceEnabled } from './rollout-policy.ts';
import { WRITABLE_COLLECTIONS, changeReferencesFor, sameEntity } from './entity-contract.ts';
import { prepareBatchState } from './batch-domain.js';
import { pruneTouchedNoteVersions } from './version-retention.ts';
import { syncError, syncKey, requestHash, thenResult, rememberBatchReceipt } from './journal.ts';

export function createBatchSyncService(provider, ownerId, transfer) {
  function validate(op) {
    assertSyncContract(op);
    if (
      op?.protocolVersion !== 2 ||
      ![op.deviceId, op.operationId, op.datasetEpoch].every(
        value => typeof value === 'string' && value.length > 0 && value.length <= 200
      )
    )
      throw syncError('PROTOCOL_UNSUPPORTED', '同步请求版本或标识无效。', 422);
    if (!Number.isSafeInteger(op.sequence) || op.sequence < 1)
      throw syncError('SYNC_SEQUENCE_INVALID', '设备操作序号无效。', 422);
    if (
      !Array.isArray(op.changes) ||
      op.changes.length < 1 ||
      op.changes.length > 2000 ||
      !Array.isArray(op.dependencies) ||
      op.dependencies.length > 10000
    )
      throw syncError('SYNC_BATCH_INVALID', '同步事务大小无效。', 422);
    const keys = new Set();
    for (const entry of [...op.changes, ...op.dependencies]) {
      if (
        !WRITABLE_COLLECTIONS.includes(entry.collection) ||
        typeof entry.id !== 'string' ||
        entry.id.length < 1 ||
        entry.id.length > 200 ||
        (entry.baseRevision !== null && (!Number.isSafeInteger(entry.baseRevision) || entry.baseRevision < 1))
      )
        throw syncError('SYNC_BATCH_INVALID', '同步实体或基线无效。', 422);
    }
    for (const entry of op.changes) {
      const key = syncKey(entry.collection, entry.id);
      if (keys.has(key) || !Object.hasOwn(entry, 'value'))
        throw syncError('SYNC_BATCH_INVALID', '同步事务含重复或不完整实体。', 422);
      keys.add(key);
    }
  }
  return {
    uploadBlob: body => {
      assertSyncContract(body);
      assertSyncDeviceEnabled(body?.deviceId);
      if (!transfer) throw syncError('SYNC_UNAVAILABLE', '此服务未配置附件传输。', 503);
      return transfer.put(body);
    },
    async pushBatch(op) {
      validate(op);
      const key = JSON.stringify([op.deviceId, op.operationId]);
      const hash = requestHash(op);
      // 幂等回执优先，即使附件后来被删除也能确认已提交操作。
      const saved = await provider.read((_state, journal) => {
        if (journal.epoch !== op.datasetEpoch) throw syncError('DATASET_CHANGED', '云端资料库已变化。');
        if (!journal.receipts[key] && (journal.deviceSequences?.[op.deviceId] ?? 0) >= op.sequence) {
          /** @type {import('../../errors/app-error.ts').AppError & {details?: {lastSequence: number}}} */
          const error = syncError('SYNC_OPERATION_EXPIRED', '此设备操作已过确认保留期，请重新核对云端基线。');
          error.details = { lastSequence: journal.deviceSequences[op.deviceId] };
          throw error;
        }
        return journal.receipts[key];
      });
      if (saved) {
        if (saved.hash !== hash) throw syncError('OPERATION_REUSED', '同一操作 ID 的内容不能改变。', 422);
        return saved.result;
      }
      const prepared = {};
      for (const entry of op.changes)
        if (entry.collection === 'attachments' && entry.value) {
          if (!transfer) throw syncError('SYNC_UNAVAILABLE', '此服务未配置附件传输。', 503);
          prepared[entry.id] = transfer.verify(entry.value);
        }
      return (provider.mutateBatch ?? provider.mutate)((state, journal) => {
        if (journal.epoch !== op.datasetEpoch) throw syncError('DATASET_CHANGED', '云端资料库已变化。');
        if (journal.receipts[key]) {
          if (journal.receipts[key].hash !== hash)
            throw syncError('OPERATION_REUSED', '同一操作 ID 的内容不能改变。', 422);
          return journal.receipts[key].result;
        }
        if ((journal.deviceSequences?.[op.deviceId] ?? 0) >= op.sequence)
          throw syncError('SYNC_OPERATION_EXPIRED', '设备操作序号已使用，请重新核对基线。');
        assertSyncDeviceEnabled(op.deviceId);
        const changes = new Map(op.changes.map(entry => [syncKey(entry.collection, entry.id), entry]));
        const dependencies = new Map(op.dependencies.map(entry => [syncKey(entry.collection, entry.id), entry]));
        const conflicts = [];
        for (const entry of [...op.changes, ...op.dependencies]) {
          const revision = journal.revisions[syncKey(entry.collection, entry.id)] ?? null;
          const current = state[entry.collection].find(item => item.id === entry.id) ?? null;
          if (entry.value && !current && revision !== null)
            throw syncError('ENTITY_DELETED', '对象已永久删除，不能恢复旧 ID。');
          if (
            revision !== entry.baseRevision &&
            !(Object.hasOwn(entry, 'value') && sameEntity(entry.collection, current, entry.value))
          )
            conflicts.push({ collection: entry.collection, id: entry.id, revision, value: cloneJsonData(current) });
        }
        if (conflicts.length) {
          const result = { status: 'conflict', conflicts };
          rememberBatchReceipt(journal, key, hash, result, op);
          return result;
        }
        // 仅供引用查找的后像不修改记录；替换受影响集合，避免复制所有历史正文。
        const referenceState = { ...state };
        for (const entry of op.changes) {
          referenceState[entry.collection] = referenceState[entry.collection].filter(value => value.id !== entry.id);
          if (entry.value) referenceState[entry.collection].push(entry.value);
        }
        for (const entry of op.changes)
          for (const ref of changeReferencesFor(entry, state, referenceState)) {
            const refKey = syncKey(ref.collection, ref.id);
            if (!changes.has(refKey) && !dependencies.has(refKey))
              throw syncError('SYNC_DEPENDENCY_REQUIRED', '同步事务缺少引用对象的基线。', 422);
          }
        let next, aliases;
        try {
          ({ state: next, aliases } = prepareBatchState(state, op.changes, ownerId, prepared));
        } catch (failure) {
          if (failure.statusCode) throw failure;
          throw syncError('SYNC_ENTITY_INVALID', '同步实体字段无效，请导出恢复记录并核对资料。', 422);
        }
        return thenResult(provider.historyReferences ? provider.historyReferences() : [], references => {
          next = pruneTouchedNoteVersions(next, op.changes, Date.now(), aliases, references);
          return thenResult(provider.applyState(next), () =>
            thenResult(provider.preview(), ({ state: applied, journal: preview }) => {
              const entries = op.changes.map(entry => {
                const id = entry.collection === 'noteVersions' ? (aliases[entry.id] ?? entry.id) : entry.id;
                return {
                  collection: entry.collection,
                  id,
                  revision: preview.revisions[syncKey(entry.collection, id)] ?? null,
                  value: cloneJsonData(applied[entry.collection].find(item => item.id === id) ?? null)
                };
              });
              const result = { status: 'accepted', entries, aliases };
              rememberBatchReceipt(journal, key, hash, result, op);
              return result;
            })
          );
        });
      });
    }
  };
}
