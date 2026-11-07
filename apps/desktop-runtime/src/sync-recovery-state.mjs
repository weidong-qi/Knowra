import { randomUUID } from 'node:crypto';
import { requestHash } from '../../api/src/modules/sync/journal.ts';
import { validateDeviceRetirements, parseDeviceRetirement } from '../../api/src/modules/sync/device-retirement.ts';
import { encodeSyncHistory } from './sync-history.mjs';
import { readMeta, writeMeta } from './sync-state.mjs';

export const recoveryError = (code, message) => Object.assign(new Error(message), { code });
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const identifier = value => typeof value === 'string' && value.length > 0 && value.length <= 200;
const normalizedRequests = requests =>
  requests
    .map(item => ({
      operationId: item.operationId,
      datasetEpoch: item.datasetEpoch,
      requestHash: item.requestHash
    }))
    .sort((a, b) => (a.operationId < b.operationId ? -1 : a.operationId > b.operationId ? 1 : 0));

export function readRecoverySession(db) {
  const session = readMeta(db, 'recoverySession');
  if (session === null) return null;
  if (
    !object(session) ||
    session.format !== 'knowra-sync-recovery-v1' ||
    ![session.id, session.ownerId, session.oldDeviceId, session.newDeviceId].every(identifier) ||
    session.oldDeviceId === session.newDeviceId ||
    typeof session.backupDirectory !== 'string' ||
    !session.backupDirectory ||
    !['prepared', 'retiring', 'downloading', 'preview', 'completed'].includes(session.stage) ||
    !object(session.command) ||
    session.command.recoveryId !== session.id ||
    session.command.deviceId !== session.oldDeviceId ||
    session.command.successorDeviceId !== session.newDeviceId ||
    session.command.ownerId !== session.ownerId ||
    !Array.isArray(session.command.requests) ||
    !session.command.requests.length
  )
    throw recoveryError('SYNC_RECOVERY_INVALID', '本机恢复会话不完整；仍保持暂停，请保留完整备份和原请求。');
  parseDeviceRetirement(session.command, session.ownerId);
  return session;
}

export function frozenRecoveryHash(db) {
  return requestHash({
    upload: readMeta(db, 'entityUpload'),
    legacy: db.prepare('SELECT * FROM sync_uploads ORDER BY note_id').all(),
    sending: readMeta(db, 'sendingUpload'),
    prepared: readMeta(db, 'preparedUpload'),
    pause: readMeta(db, 'safetyPause'),
    sender: readMeta(db, 'senderDeviceId'),
    pending: readMeta(db, 'recoveryPendingKeys'),
    serverUrl: readMeta(db, 'serverUrl'),
    ownerId: readMeta(db, 'ownerId')
  });
}

export function writeRecoverySession(db, session) {
  writeMeta(db, 'recoverySession', session);
}

export function verifyRetirementProof(session, response, currentEpoch) {
  const record = response?.retirement;
  if (
    response?.status !== 'retired' ||
    response.ownerId !== session.ownerId ||
    response.journalVersion !== 2 ||
    response.datasetEpoch !== currentEpoch ||
    !object(record)
  )
    throw recoveryError('SYNC_RECOVERY_PROOF_INVALID', '无法验证服务端屏障，原请求和本机资料仍保持暂停。');
  validateDeviceRetirements({ version: 2, retiredDevices: { [session.oldDeviceId]: record } });
  if (
    record.ownerId !== session.ownerId ||
    record.deviceId !== session.oldDeviceId ||
    record.successorDeviceId !== session.newDeviceId ||
    record.recoveryId !== session.id ||
    record.datasetEpoch !== session.command.datasetEpoch ||
    JSON.stringify(normalizedRequests(record.requests)) !== JSON.stringify(normalizedRequests(session.command.requests))
  )
    throw recoveryError('SYNC_RECOVERY_PROOF_INVALID', '服务端屏障不属于这次恢复，不能换号或解除暂停。');
  return structuredClone(record);
}

export function recoveryEntries(db, session) {
  const download = session.download;
  if (!object(download) || download.offset !== null || !Array.isArray(download.pages))
    throw recoveryError('SYNC_RECOVERY_NOT_READY', '固定云端快照尚未下载完整，本机资料仍保持暂停。');
  const entries = download.pages.flatMap(key => {
    const page = readMeta(db, key);
    if (!Array.isArray(page)) throw recoveryError('SYNC_RECOVERY_INVALID', '恢复快照页缺失，请保留备份重新核对。');
    return page;
  });
  if (entries.length !== download.binding.count)
    throw recoveryError('SYNC_RECOVERY_INVALID', '恢复快照数量不匹配，不能解除暂停。');
  if (download.contentHash && requestHash(entries) !== download.contentHash)
    throw recoveryError('SYNC_RECOVERY_INVALID', '固定恢复快照内容已变化，不能沿用原对照作决定。');
  if (session.stage === 'preview' && !/^[a-f0-9]{64}$/.test(download.contentHash ?? ''))
    throw recoveryError('SYNC_RECOVERY_INVALID', '恢复快照缺少完整性记录，仍保持暂停。');
  return entries;
}

export function archiveRecoveryEvidence(db, state, session, details = {}) {
  const payload = {
    kind: 'sync-safety-recovery',
    capturedAt: new Date().toISOString(),
    session: structuredClone(session),
    local: structuredClone(state),
    base: db.prepare('SELECT * FROM sync_base').all(),
    outbox: db.prepare('SELECT * FROM sync_outbox ORDER BY sequence').all(),
    localRevisions: db.prepare('SELECT * FROM local_revisions').all(),
    deletionFacts: db.prepare('SELECT * FROM deletion_facts').all(),
    legacyUploads: db.prepare('SELECT * FROM sync_uploads').all(),
    metadata: db
      .prepare("SELECT key,value FROM metadata WHERE key LIKE 'sync:%'")
      .all()
      .filter(row => row.key !== 'sync:recoverySession' && !row.key.startsWith('sync:recoveryPage:')),
    ...details
  };
  db.prepare('INSERT INTO sync_recovery VALUES (?, ?)').run(randomUUID(), encodeSyncHistory(payload));
}

const revisions = new WeakMap();
export function recoveryRevision(store) {
  const context = store.readSync(db => {
    const current = readMeta(db, 'recoverySession');
    return {
      id: current?.id,
      snapshot: current?.download?.binding,
      contentHash: current?.download?.contentHash,
      proof: current?.proof?.bindingHash
    };
  });
  const entityKey = store.getEntityCacheKey();
  const cacheKey = entityKey === null ? null : `${entityKey}:${requestHash(context)}`;
  const previous = revisions.get(store);
  if (cacheKey !== null && previous?.cacheKey === cacheKey) return previous.value;
  const value = store.readSync((db, state) =>
    requestHash({
      context,
      state,
      revisions: db.prepare('SELECT * FROM local_revisions ORDER BY collection,id').all(),
      outbox: db.prepare('SELECT * FROM sync_outbox ORDER BY sequence').all()
    })
  );
  if (cacheKey !== null) revisions.set(store, { cacheKey, value });
  return value;
}
