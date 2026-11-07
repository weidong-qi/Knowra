import { createHash } from 'node:crypto';

const SAFETY_MESSAGE =
  '上次同步结果无法安全确认，云端同步已暂停；本地资料、原请求和后续修改均已保留。请先备份并导出恢复记录，勿换 ID 重试或用旧版打开资料库。';

const read = (db, key) =>
  JSON.parse(db.prepare('SELECT value FROM metadata WHERE key = ?').get(`sync:${key}`)?.value ?? 'null');
const write = (db, key, value) =>
  db.prepare('INSERT OR REPLACE INTO metadata VALUES (?, ?)').run(`sync:${key}`, JSON.stringify(value));

export const uploadIdentity = operation => ({
  operationId: operation.operationId,
  deviceId: operation.deviceId,
  datasetEpoch: operation.datasetEpoch,
  requestHash: createHash('sha256').update(JSON.stringify(operation)).digest('hex')
});
const matches = (left, right) => JSON.stringify(left) === JSON.stringify(right);

export function readSyncSafetyPause(db) {
  return read(db, 'safetyPause');
}

export function syncSafetyError(pause) {
  return Object.assign(new Error(pause.message), { code: 'SYNC_RESULT_UNCERTAIN' });
}

export function pauseUncertainSync(db, operation, reason) {
  const existing = readSyncSafetyPause(db);
  if (existing) return existing;
  const pause = {
    code: 'SYNC_RESULT_UNCERTAIN',
    message: SAFETY_MESSAGE,
    reason,
    operation: operation ? uploadIdentity(operation) : null,
    detectedAt: new Date().toISOString()
  };
  write(db, 'safetyPause', pause);
  return pause;
}

export function assertSyncNotPaused(db) {
  const pause = readSyncSafetyPause(db);
  if (pause) throw syncSafetyError(pause);
  if (read(db, 'sendingUpload')) throw syncSafetyError({ message: SAFETY_MESSAGE });
}

// 普通入口也可能先于同步调度运行；先将崩溃窗口中的发送记录转为持久暂停。
export function persistUnconfirmedSending(store) {
  const pending = store.readSync(db => ({
    pause: readSyncSafetyPause(db),
    sending: read(db, 'sendingUpload'),
    operation: read(db, 'entityUpload')
  }));
  if (pending.pause || !pending.sending) return pending.pause;
  return store.metadataTransaction(db => pauseUncertainSync(db, pending.operation, 'unconfirmed-sending-upload'));
}

export function assertStoreSyncNotPaused(store) {
  const pause = persistUnconfirmedSending(store);
  if (pause) throw syncSafetyError(pause);
}

export function prepareUpload(db, operation) {
  assertSyncNotPaused(db);
  write(db, 'preparedUpload', uploadIdentity(operation));
}

export function isPreparedUpload(db, operation) {
  return matches(read(db, 'preparedUpload'), uploadIdentity(operation)) && !read(db, 'sendingUpload');
}

export function beginUpload(db, operation) {
  const pause = readSyncSafetyPause(db);
  if (pause) return syncSafetyError(pause);
  if (!isPreparedUpload(db, operation))
    return syncSafetyError(pauseUncertainSync(db, operation, 'concurrent-or-unprepared-upload'));
  write(db, 'sendingUpload', uploadIdentity(operation));
  return null;
}

export function clearUploadSafety(db) {
  write(db, 'preparedUpload', null);
  write(db, 'sendingUpload', null);
}

const entryKey = entry => JSON.stringify([entry.collection, entry.id]);
const validEntry = entry =>
  entry &&
  typeof entry.collection === 'string' &&
  typeof entry.id === 'string' &&
  entry.id.length > 0 &&
  (entry.revision === null || (Number.isSafeInteger(entry.revision) && entry.revision > 0)) &&
  Object.hasOwn(entry, 'value') &&
  (entry.value === null ||
    (typeof entry.value === 'object' &&
      !Array.isArray(entry.value) &&
      entry.value.id === entry.id &&
      entry.revision !== null));

function validBatchResult(operation, result) {
  if (result?.status === 'conflict') {
    if (!Array.isArray(result.conflicts) || !result.conflicts.length) return false;
    const expected = new Set([...operation.changes, ...operation.dependencies].map(entryKey));
    const seen = new Set();
    return result.conflicts.every(entry => {
      if (!validEntry(entry) || !expected.has(entryKey(entry)) || seen.has(entryKey(entry))) return false;
      seen.add(entryKey(entry));
      return true;
    });
  }
  if (
    result?.status !== 'accepted' ||
    !Array.isArray(result.entries) ||
    !operation.changes.length ||
    result.entries.length !== operation.changes.length
  )
    return false;
  const aliases = result.aliases ?? {};
  if (typeof aliases !== 'object' || Array.isArray(aliases)) return false;
  for (const [sourceId, targetId] of Object.entries(aliases)) {
    const source = operation.changes.find(entry => entry.collection === 'noteVersions' && entry.id === sourceId);
    if (
      !source?.value ||
      typeof targetId !== 'string' ||
      !targetId ||
      targetId.length > 200 ||
      sourceId === targetId ||
      !result.entries.some(
        entry =>
          entry.collection === 'noteVersions' &&
          entry.id === targetId &&
          entry.value?.noteId === source.value.noteId &&
          entry.value?.contentHash === source.value.contentHash
      )
    )
      return false;
  }
  const remaining = [...result.entries];
  for (const submitted of operation.changes) {
    const aliased = submitted.collection === 'noteVersions' ? aliases[submitted.id] : undefined;
    const id = aliased ?? submitted.id;
    const index = remaining.findIndex(
      entry => validEntry(entry) && entry.collection === submitted.collection && entry.id === id
    );
    if (index < 0) return false;
    const [entry] = remaining.splice(index, 1);
    if (
      (submitted.value === null) !== (entry.value === null) ||
      (!aliased &&
        submitted.baseRevision !== null &&
        (entry.revision === null || entry.revision < submitted.baseRevision))
    )
      return false;
  }
  return remaining.length === 0;
}

// 返回错误而不是在事务内抛出，确保暂停标记随事务提交后仍可在重启时生效。
export function acknowledgementFailure(db, operation, frozen, result, { legacy = false } = {}) {
  const pause = readSyncSafetyPause(db);
  if (pause) return syncSafetyError(pause);
  const sending = read(db, 'sendingUpload');
  const epoch = read(db, 'epoch');
  const serverEpoch = read(db, 'serverEpoch');
  const resultValid = legacy
    ? ['accepted', 'conflict'].includes(result?.status) &&
      validEntry(result.current) &&
      result.current.collection === 'notes' &&
      result.current.id === operation.noteId &&
      (result.status !== 'accepted' || (operation.value === null) === (result.current.value === null))
    : Array.isArray(operation.changes) && Array.isArray(operation.dependencies) && validBatchResult(operation, result);
  if (
    !frozen ||
    !matches(uploadIdentity(frozen), uploadIdentity(operation)) ||
    (sending && !matches(sending, uploadIdentity(operation))) ||
    operation.datasetEpoch !== epoch ||
    (serverEpoch && operation.datasetEpoch !== serverEpoch) ||
    !resultValid
  )
    return syncSafetyError(pauseUncertainSync(db, operation, 'stale-or-invalid-acknowledgement'));
  return null;
}
