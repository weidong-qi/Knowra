import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { inspectRuntimeBackup } from './backup.mjs';
import { openReadonlySqliteSnapshot } from './sqlite-readonly-snapshot.mjs';
import {
  syncContract,
  syncContractQuery,
  assertSnapshotBinding,
  assertSyncContract
} from '../../api/src/modules/sync/protocol-contract.ts';
import { requestHash, syncKey } from '../../api/src/modules/sync/journal.ts';
import {
  createEmptyLocalState,
  createPersistedLocalDocument,
  validatePersistedLocalState,
  LOCAL_DATA_COLLECTIONS
} from '../../api/src/infrastructure/local-data-schema.js';
import { assertNotHistoryOperation } from './sync-history.mjs';
import { readMeta } from './sync-state.mjs';
import { syncSenderDeviceId } from './sync-safety.mjs';
import { recoveryIntentKeys, resolveEntityRecovery } from './entity-sync-state.mjs';
import {
  archiveRecoveryEvidence,
  frozenRecoveryHash,
  readRecoverySession,
  recoveryEntries,
  recoveryBackupHash,
  recoveryError,
  recoveryRevision,
  verifyRetirementProof,
  writeRecoverySession
} from './sync-recovery-state.mjs';

const contracted = route => `${route}${route.includes('?') ? '&' : '?'}${syncContractQuery()}`;
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const validId = value => typeof value === 'string' && value.length > 0 && value.length <= 200;

function originalRequests(store, oldDeviceId) {
  return store.readSync(db => {
    const operations = [
      readMeta(db, 'entityUpload'),
      ...db
        .prepare('SELECT request FROM sync_uploads ORDER BY note_id')
        .all()
        .map(row => JSON.parse(row.request))
    ].filter(Boolean);
    const requests = new Map();
    for (const operation of operations) {
      assertNotHistoryOperation(operation);
      if (operation.deviceId !== oldDeviceId || !validId(operation.operationId) || !validId(operation.datasetEpoch))
        throw recoveryError(
          'SYNC_RECOVERY_IDENTITY_INVALID',
          '原请求涉及不同或未知同步身份，不能自动作废，请保留完整备份。'
        );
      requests.set(operation.operationId, {
        operationId: operation.operationId,
        datasetEpoch: operation.datasetEpoch,
        requestHash: requestHash(operation)
      });
    }
    if (!requests.size) {
      const identity = readMeta(db, 'sendingUpload') ?? readMeta(db, 'safetyPause')?.operation;
      if (
        !identity ||
        identity.deviceId !== oldDeviceId ||
        !validId(identity.operationId) ||
        !validId(identity.datasetEpoch) ||
        !/^[a-f0-9]{64}$/.test(identity.requestHash ?? '')
      )
        throw recoveryError(
          'SYNC_RECOVERY_IDENTITY_INVALID',
          '缺少可核对的原请求身份，不能猜测换号；请导出完整救援备份。'
        );
      requests.set(identity.operationId, {
        operationId: identity.operationId,
        datasetEpoch: identity.datasetEpoch,
        requestHash: identity.requestHash
      });
    }
    return [...requests.values()].sort((a, b) =>
      a.operationId < b.operationId ? -1 : a.operationId > b.operationId ? 1 : 0
    );
  });
}

function validateEntries(entries, expectedCount) {
  if (entries.length !== expectedCount) throw recoveryError('SYNC_RECOVERY_SNAPSHOT_INVALID', '云端恢复快照数量不符。');
  const keys = new Set();
  const state = createEmptyLocalState();
  for (const entry of entries) {
    if (
      !object(entry) ||
      !LOCAL_DATA_COLLECTIONS.includes(entry.collection) ||
      !validId(entry.id) ||
      !Object.hasOwn(entry, 'value') ||
      !(entry.revision === null || (Number.isSafeInteger(entry.revision) && entry.revision > 0)) ||
      (entry.value !== null && (!object(entry.value) || entry.value.id !== entry.id || entry.revision === null)) ||
      keys.has(syncKey(entry.collection, entry.id))
    )
      throw recoveryError('SYNC_RECOVERY_SNAPSHOT_INVALID', '云端恢复快照包含重复、未知或不完整实体，仍保持暂停。');
    keys.add(syncKey(entry.collection, entry.id));
    if (entry.value) state[entry.collection].push(entry.value);
  }
  validatePersistedLocalState(createPersistedLocalDocument(state));
}

export function createSyncRecovery({ store, request, createBackup, noteService, entityTransfer }) {
  const meta = key => store.readSync(db => readMeta(db, key));
  const session = () => store.readSync(db => readRecoverySession(db));
  const update = (id, change) =>
    store.metadataTransaction(db => {
      const current = readRecoverySession(db);
      if (!current || current.id !== id || current.stage === 'completed')
        throw recoveryError('SYNC_RECOVERY_CHANGED', '恢复会话已变化，不能覆盖新状态。');
      const next = { ...current, ...change };
      writeRecoverySession(db, next);
      return next;
    });
  const boundServer = async () => {
    if (!meta('serverUrl') || !meta('ownerId'))
      throw recoveryError('SYNC_RECOVERY_UNBOUND', '原服务地址或所属资料库未知，不能自动恢复。');
    const info = await request('status');
    assertSyncContract(info);
    if (
      info.protocolVersion !== 1 ||
      info.scope !== 'notes' ||
      info.ownerId !== meta('ownerId') ||
      !validId(info.datasetEpoch) ||
      info.recovery?.version !== 1 ||
      !info.recovery.deviceRetirementSupported
    )
      throw recoveryError(
        'SYNC_RECOVERY_SERVER_UNSAFE',
        '原云端不支持可验证的退役屏障，或所属资料库已改变；仍保持暂停。'
      );
    return info;
  };
  const validateBackup = (directory, expectedHash) => {
    try {
      if (inspectRuntimeBackup(directory).purpose !== 'sync-safety-recovery')
        throw new Error('不是本次同步恢复的完整备份。');
      const snapshot = openReadonlySqliteSnapshot(path.join(directory, 'local.sqlite'), { allowSidecars: false });
      try {
        if (recoveryBackupHash(snapshot.database) !== expectedHash)
          throw new Error('备份不是当前完整资料或已发生变化。');
      } finally {
        snapshot.close();
      }
    } catch {
      throw recoveryError(
        'SYNC_RECOVERY_BACKUP_FAILED',
        '完整备份未通过只读校验或与本机记录不一致；请保留原始资料，仍保持暂停。'
      );
    }
  };
  const backup = async () => {
    if (typeof createBackup !== 'function')
      throw recoveryError('SYNC_RECOVERY_BACKUP_UNAVAILABLE', '缺少完整本机备份能力，尚未作废编号。');
    const hash = store.readSync(db => recoveryBackupHash(db));
    const directory = await createBackup();
    if (typeof directory !== 'string' || !directory)
      throw recoveryError('SYNC_RECOVERY_BACKUP_FAILED', '完整备份未确认成功，仍保持暂停。');
    if (store.readSync(db => recoveryBackupHash(db)) !== hash)
      throw recoveryError('SYNC_RECOVERY_PREVIEW_CHANGED', '备份期间本机资料已变化，请重新核对后继续。');
    validateBackup(directory, hash);
    return { directory, hash };
  };

  return {
    async prepare(input) {
      let current = session();
      try {
        if (!meta('safetyPause'))
          throw recoveryError('SYNC_RECOVERY_NOT_PAUSED', '当前没有结果待确认的安全暂停，无需作废编号。');
        const info = await boundServer();
        if (current && current.stage !== 'completed' && current.localDatasetId !== store.getStatus().datasetId)
          throw recoveryError(
            'SYNC_RECOVERY_DIFFERENT_WORKSPACE',
            '这份资料库已从备份恢复或更换身份，不能复用旧恢复会话；请保留备份人工核对。'
          );
        if (meta('authoritativePurgePending'))
          throw recoveryError(
            'LOCAL_PURGE_RESULT_PENDING',
            '另有永久清理结果尚未核对，退役同步编号不能撤销该命令；请先保全并人工核对，仍保持暂停。'
          );
        if (!current || current.stage === 'completed') {
          if (input.confirmRetire !== true || input.acceptJournalUpgrade !== true)
            throw recoveryError(
              'SYNC_RECOVERY_CONFIRMATION_REQUIRED',
              '请先明确确认旧编号永久作废与服务端同步记录格式门禁。'
            );
          const oldDeviceId = syncSenderDeviceId(store);
          const requests = originalRequests(store, oldDeviceId);
          const sourceHash = store.readSync(db => frozenRecoveryHash(db));
          const protectedBackup = await backup();
          current = store.metadataTransaction(db => {
            const existing = readRecoverySession(db);
            if (existing && existing.stage !== 'completed') return existing;
            if (sourceHash !== frozenRecoveryHash(db))
              throw recoveryError('SYNC_RECOVERY_CHANGED', '原请求或暂停事实已变化，请重新核对。');
            const id = randomUUID();
            const newDeviceId = randomUUID();
            const created = {
              format: 'knowra-sync-recovery-v1',
              id,
              stage: 'prepared',
              ownerId: info.ownerId,
              serverUrl: meta('serverUrl'),
              oldDeviceId,
              newDeviceId,
              backupDirectory: protectedBackup.directory,
              backupHash: protectedBackup.hash,
              baselineEpoch: readMeta(db, 'epoch'),
              localDatasetId: store.getStatus().datasetId,
              sourceHash,
              createdAt: new Date().toISOString(),
              command: {
                ...syncContract(),
                action: 'retire-device',
                acceptJournalUpgrade: true,
                ownerId: info.ownerId,
                datasetEpoch: info.datasetEpoch,
                deviceId: oldDeviceId,
                successorDeviceId: newDeviceId,
                recoveryId: id,
                requests
              }
            };
            archiveRecoveryEvidence(db, store.state, created, { stage: 'prepared' });
            writeRecoverySession(db, created);
            return created;
          });
        }
        if (
          current.serverUrl !== meta('serverUrl') ||
          current.ownerId !== info.ownerId ||
          current.sourceHash !== store.readSync(db => frozenRecoveryHash(db))
        )
          throw recoveryError('SYNC_RECOVERY_CHANGED', '恢复绑定或原请求已变化，请保留备份重新核对。');
        validateBackup(current.backupDirectory, current.backupHash);
        let response = await request(
          contracted(
            `device-retirement?deviceId=${encodeURIComponent(current.oldDeviceId)}&recoveryId=${encodeURIComponent(current.id)}`
          )
        );
        if (response.status === 'missing') {
          if (current.proof)
            throw recoveryError('SYNC_RECOVERY_BARRIER_LOST', '已确认的作废记录已丢失，不能掩盖不安全回滚继续恢复。');
          if (current.command.datasetEpoch !== info.datasetEpoch)
            throw recoveryError('SYNC_RECOVERY_EPOCH_CHANGED', '屏障未获确认且云端世代已变化，不能擅自重建恢复编号。');
          current = update(current.id, { stage: 'retiring', lastError: null });
          response = await request('device-retirement', current.command);
        }
        const proof = verifyRetirementProof(current, response, info.datasetEpoch);
        current = update(current.id, {
          proof,
          stage: current.stage === 'preview' ? 'preview' : 'downloading',
          lastError: null
        });
        let download = current.download;
        if (download) {
          try {
            assertSnapshotBinding(download.binding, syncContract(), current.ownerId, info.datasetEpoch);
          } catch {
            download = null;
          }
        }
        if (!download) {
          const binding = await request('bootstrap', syncContract());
          assertSnapshotBinding(binding, syncContract(), current.ownerId, info.datasetEpoch);
          download = { binding, offset: 0, pages: [] };
          current = update(current.id, { stage: 'downloading', download });
        }
        while (download.offset !== null) {
          const offset = download.offset;
          let page;
          try {
            page = await request(
              contracted(`snapshot?snapshotId=${encodeURIComponent(download.binding.snapshotId)}&offset=${offset}`)
            );
          } catch (failure) {
            if (failure.code === 'CURSOR_EXPIRED') {
              update(current.id, { stage: 'downloading', download: null });
              throw recoveryError(
                'SYNC_RECOVERY_SNAPSHOT_EXPIRED',
                '固定快照已过期，请继续核对同一恢复会话；原请求和屏障证明仍保留。'
              );
            }
            throw failure;
          }
          assertSnapshotBinding(page, syncContract(), current.ownerId, download.binding.datasetEpoch);
          if (
            page.snapshotId !== download.binding.snapshotId ||
            page.count !== download.binding.count ||
            page.cursor !== download.binding.cursor ||
            !Array.isArray(page.entries) ||
            (page.nextOffset !== null &&
              (!Number.isSafeInteger(page.nextOffset) ||
                page.nextOffset <= offset ||
                page.nextOffset !== offset + page.entries.length ||
                page.nextOffset > page.count)) ||
            (page.nextOffset === null && offset + page.entries.length !== page.count)
          )
            throw recoveryError('SYNC_RECOVERY_SNAPSHOT_INVALID', '恢复快照分页不一致，仍保持暂停。');
          current = store.metadataTransaction(db => {
            const live = readRecoverySession(db);
            if (
              live?.id !== current.id ||
              live.download?.binding.snapshotId !== download.binding.snapshotId ||
              live.download.offset !== offset
            )
              throw recoveryError('SYNC_RECOVERY_CHANGED', '恢复快照进度已变化，请继续核对既有恢复。');
            const key = `recoveryPage:${current.id}:${download.binding.snapshotId}:${offset}`;
            const next = {
              ...live,
              download: { ...live.download, offset: page.nextOffset, pages: [...live.download.pages, key] }
            };
            db.prepare('INSERT OR REPLACE INTO metadata VALUES (?, ?)').run(
              `sync:${key}`,
              JSON.stringify(page.entries)
            );
            writeRecoverySession(db, next);
            return next;
          });
          download = current.download;
        }
        const entries = store.readSync(db => recoveryEntries(db, current));
        validateEntries(structuredClone(entries), download.binding.count);
        current = update(current.id, {
          stage: 'preview',
          lastError: null,
          download: { ...download, contentHash: requestHash(entries) }
        });
        return current;
      } catch (failure) {
        if (current && current.stage !== 'completed') {
          try {
            update(current.id, {
              lastError: { code: failure.code ?? 'SYNC_RECOVERY_FAILED', message: failure.message }
            });
          } catch {
            /* 不能覆盖已变化的恢复会话。 */
          }
        }
        throw failure;
      }
    },
    summary() {
      const current = session();
      if (!current) return null;
      return {
        id: current.id,
        stage: current.stage,
        oldDeviceId: current.oldDeviceId,
        newDeviceId: current.newDeviceId,
        backupId: current.backupDirectory.split(/[\\/]/).at(-1),
        localRevision: current.stage === 'completed' ? '' : recoveryRevision(store),
        totalItems:
          current.stage === 'preview'
            ? recoveryIntentKeys(
                store,
                store.readSync(db => recoveryEntries(db, current))
              ).length
            : 0,
        epochChanged: Boolean(current.download && current.baselineEpoch !== current.download.binding.datasetEpoch),
        lastError: current.lastError ?? null
      };
    },
    preview({ offset = 0, limit = 20 } = {}) {
      const current = session();
      if (current?.stage !== 'preview') throw recoveryError('SYNC_RECOVERY_NOT_READY', '恢复快照尚未准备好。');
      offset = Number(offset);
      limit = Number(limit);
      if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100)
        throw recoveryError('SYNC_RECOVERY_INVALID', '恢复对照分页无效。');
      const entries = store.readSync(db => recoveryEntries(db, current));
      const remote = new Map(entries.map(entry => [syncKey(entry.collection, entry.id), entry]));
      const keys = recoveryIntentKeys(store, entries).sort();
      if (offset > keys.length) throw recoveryError('SYNC_RECOVERY_INVALID', '恢复对照分页越界。');
      const items = store.readSync((_db, state) =>
        keys.slice(offset, offset + limit).map(key => {
          const [collection, id] = JSON.parse(key);
          return {
            collection,
            id,
            local: structuredClone(state[collection].find(item => item.id === id) ?? null),
            remote: structuredClone(remote.get(key)?.value ?? null)
          };
        })
      );
      return {
        recoveryId: current.id,
        revision: recoveryRevision(store),
        total: keys.length,
        offset,
        nextOffset: offset + items.length < keys.length ? offset + items.length : null,
        items,
        oldDeviceId: current.oldDeviceId,
        newDeviceId: current.newDeviceId,
        backupId: current.backupDirectory.split(/[\\/]/).at(-1),
        epochChanged: current.baselineEpoch !== current.download.binding.datasetEpoch
      };
    },
    async resolve(input) {
      const current = session();
      if (current?.id !== input.recoveryId || current.stage !== 'preview')
        throw recoveryError('SYNC_RECOVERY_NOT_READY', '恢复会话尚未准备好。');
      const info = await boundServer();
      const proof = await request(
        contracted(
          `device-retirement?deviceId=${encodeURIComponent(current.oldDeviceId)}&recoveryId=${encodeURIComponent(current.id)}`
        )
      );
      if (current.localDatasetId !== store.getStatus().datasetId || meta('authoritativePurgePending'))
        throw recoveryError(
          'SYNC_RECOVERY_DIFFERENT_WORKSPACE',
          '资料库身份已改变或有另一个永久清理结果待核对，不能沿用旧恢复决定。'
        );
      verifyRetirementProof(current, proof, info.datasetEpoch);
      const successor = await request(`device?deviceId=${encodeURIComponent(current.newDeviceId)}`);
      if (successor.retired || successor.sequence !== 0)
        throw recoveryError(
          'SYNC_RECOVERY_SUCCESSOR_USED',
          '这次恢复的新编号已被其他副本使用或作废，不能合并身份继续；本机资料仍保留。'
        );
      if (current.download.binding.datasetEpoch !== info.datasetEpoch) {
        update(current.id, { stage: 'downloading', download: null });
        throw recoveryError('SYNC_RECOVERY_SNAPSHOT_CHANGED', '云端世代已变化，请继续核对既有恢复以重新下载固定快照。');
      }
      if (input.revision !== recoveryRevision(store))
        throw recoveryError('SYNC_RECOVERY_PREVIEW_CHANGED', '本机资料已变化，请刷新全部恢复对照后再选择。');
      const protectedBackup = await backup();
      resolveEntityRecovery(
        store,
        { ...input, backupDirectory: protectedBackup.directory },
        noteService,
        entityTransfer
      );
    },
    async verifyBarriers(info, normalRequest) {
      const barriers = meta('recoveryBarriers') ?? [];
      if (!Array.isArray(barriers))
        throw recoveryError('SYNC_RECOVERY_BARRIER_LOST', '本机屏障记录损坏，已阻止继续同步。');
      if (!barriers.length) return;
      if (
        info.recovery?.version !== 1 ||
        !info.recovery.deviceRetirementSupported ||
        info.recovery.journalVersion !== 2
      )
        throw recoveryError('SYNC_RECOVERY_BARRIER_LOST', '云端不再支持已确认屏障，请勿回退旧版服务或裸旧备份。');
      for (const barrier of barriers) {
        if (barrier.serverUrl !== meta('serverUrl') || barrier.ownerId !== info.ownerId)
          throw recoveryError('SYNC_RECOVERY_BARRIER_LOST', '已确认屏障的服务绑定已变化，已阻止继续同步。');
        const response = await normalRequest(
          contracted(
            `device-retirement?deviceId=${encodeURIComponent(barrier.oldDeviceId)}&recoveryId=${encodeURIComponent(barrier.id)}`
          )
        );
        try {
          verifyRetirementProof(barrier, response, info.datasetEpoch);
        } catch {
          throw recoveryError('SYNC_RECOVERY_BARRIER_LOST', '云端已确认的作废事实丢失或变化，本机修改已保留。');
        }
      }
    }
  };
}
