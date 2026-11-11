import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import { createAppError } from '../../api/src/errors/app-error.js';
import { LOCAL_DATA_COLLECTIONS } from '../../api/src/infrastructure/local-data-schema.js';
import {
  DELETION_FACTS_DDL,
  FACT_METADATA_KEYS,
  factHash,
  invalidFacts,
  serverOrigin,
  validateFact,
  validateSqliteDeletionFacts
} from './sqlite-deletion-facts-contract.mjs';

export { validateSqliteDeletionFacts } from './sqlite-deletion-facts-contract.mjs';
const rawMeta = (db, key) => db.prepare('SELECT value FROM metadata WHERE key=?').get(key)?.value;
const meta = (db, key) => JSON.parse(rawMeta(db, `sync:${key}`) ?? 'null');
const scopeOf = db => JSON.parse(rawMeta(db, 'deletionFactsScope'));
function binding(db) {
  const origin = meta(db, 'serverUrl'),
    ownerId = meta(db, 'ownerId');
  return serverOrigin(origin) &&
    typeof ownerId === 'string' &&
    ownerId.trim() === ownerId &&
    ownerId.length > 0 &&
    ownerId.length <= 2048
    ? { serverOrigin: origin, ownerId }
    : null;
}
function insert(db, collection, entityId, source, { observedAt = new Date().toISOString(), deletedAt = null } = {}) {
  if (!db.isTransaction) throw invalidFacts('删除事实必须与业务提交处于同一事务。');
  const scope = scopeOf(db);
  const record = {
    schemaVersion: 1,
    collection,
    entityId,
    scopeId: scope.scopeId,
    ownerId: scope.ownerId,
    observationId: factHash([scope.scopeId, collection, entityId, source]),
    observedAt,
    deletedAt,
    source
  };
  validateFact(record, scope);
  db.prepare('INSERT INTO deletion_facts VALUES (?,?,?,?) ON CONFLICT(collection,entity_id) DO NOTHING').run(
    collection,
    entityId,
    factHash(record),
    JSON.stringify(record)
  );
}
export function observeRemoteDeletionFacts(db, entries, { epoch, kind = 'remote-delete', versions = [] } = {}) {
  const bound = binding(db);
  if (!bound) return;
  if (kind === 'remote-delete' && (!epoch || meta(db, 'serverEpoch') !== epoch)) return;
  let aliasesByHash;
  for (const entry of entries) {
    if (entry?.value !== null || entry.revision === null || entry.revision === undefined) continue;
    if (!Number.isSafeInteger(entry.revision) || entry.revision < 1)
      throw invalidFacts('远端删除修订无效，已停止提交。');
    insert(db, entry.collection, entry.id, { kind, ...bound, epoch: epoch ?? null, revision: entry.revision });
    if (
      kind !== 'remote-delete' ||
      entry.collection !== 'noteVersions' ||
      !versions.length ||
      meta(db, 'epoch') !== epoch
    )
      continue;
    // 墓碑没有正文哈希：只使用尚未覆盖的已确认基线关联别名，不凭空猜测删除范围。
    const row = db
      .prepare("SELECT payload, server_revision FROM sync_base WHERE collection='noteVersions' AND id=?")
      .get(entry.id);
    const canonical = row ? JSON.parse(row.payload) : null;
    if (
      !canonical ||
      canonical.id !== entry.id ||
      !Number.isSafeInteger(row.server_revision) ||
      row.server_revision < 1 ||
      row.server_revision >= entry.revision
    )
      continue;
    if (!aliasesByHash) {
      aliasesByHash = new Map();
      for (const version of versions) {
        const key = JSON.stringify([version.noteId, version.contentHash]);
        if (!aliasesByHash.has(key)) aliasesByHash.set(key, []);
        aliasesByHash.get(key).push(version);
      }
    }
    for (const alias of aliasesByHash.get(JSON.stringify([canonical.noteId, canonical.contentHash])) ?? []) {
      if (alias.id === canonical.id) continue;
      insert(db, 'noteVersions', alias.id, {
        kind: 'remote-version-alias',
        ...bound,
        epoch,
        revision: entry.revision,
        canonicalVersionId: canonical.id,
        noteId: canonical.noteId,
        contentHash: canonical.contentHash
      });
    }
  }
}
/** 仅用来源库自身完整绑定投影可补录的旧观察；不接受恢复目标补来的绑定。 */
export function legacyDeletionObservations(db) {
  const bound = binding(db);
  if (!bound) return [];
  const observations = [];
  const append = (entries, kind, epoch) => {
    for (const entry of entries) {
      if (entry?.value !== null || entry.revision === null || entry.revision === undefined) continue;
      if (!Number.isSafeInteger(entry.revision) || entry.revision < 1)
        throw invalidFacts('远端删除修订无效，已停止提交。');
      observations.push({
        collection: entry.collection,
        entityId: entry.id,
        source: { kind, ...bound, epoch, revision: entry.revision }
      });
    }
  };
  append(
    db
      .prepare("SELECT collection,id,server_revision AS revision FROM sync_base WHERE payload='null'")
      .all()
      .map(row => ({ ...row, value: null })),
    'legacy-remote-base',
    null
  );
  // v1 的冲突表要到 staging 的 v2 迁移才创建；只读投影不能要求它已存在。
  const conflicts =
    db.prepare('PRAGMA user_version').get().user_version === 1 &&
    !db.prepare("SELECT name FROM sqlite_master WHERE name='sync_conflicts'").get()
      ? []
      : db.prepare('SELECT payload FROM sync_conflicts').all();
  for (const row of conflicts) {
    const conflict = JSON.parse(row.payload);
    append(
      [{ collection: 'notes', id: conflict.noteId, value: conflict.remote, revision: conflict.remoteRevision }],
      'legacy-remote-conflict',
      conflict.datasetEpoch ?? null
    );
  }
  const conflict = meta(db, 'entityConflict');
  if (conflict) append(conflict.remote ?? [], 'legacy-remote-conflict', conflict.epoch ?? null);
  return observations;
}
function backfill(db) {
  for (const observation of legacyDeletionObservations(db))
    insert(db, observation.collection, observation.entityId, observation.source);
}
export function initializeDeletionFacts(db, { newStore = false, filePath } = {}) {
  const existing = validateSqliteDeletionFacts(db);
  if (existing) return;
  if (!newStore) {
    const backup = `${filePath}.before-deletion-facts-v1-${randomUUID()}.bak`;
    db.prepare('VACUUM INTO ?').run(backup);
    fs.chmodSync(backup, 0o600);
  }
  db.exec('BEGIN IMMEDIATE');
  try {
    db.exec(DELETION_FACTS_DDL);
    const scope = { schemaVersion: 1, scopeId: randomUUID(), ownerId: 'demo' };
    const coverage = {
      schemaVersion: 1,
      recordedSince: new Date().toISOString(),
      legacyHistory: newStore ? 'none-new-store' : 'incomplete'
    };
    const values = ['1', JSON.stringify(scope), JSON.stringify(coverage)];
    FACT_METADATA_KEYS.forEach((key, i) => db.prepare('INSERT INTO metadata VALUES (?,?)').run(key, values[i]));
    backfill(db);
    validateSqliteDeletionFacts(db);
    db.exec('COMMIT');
  } catch (error) {
    if (db.isTransaction) db.exec('ROLLBACK');
    throw error;
  }
}
export const hasDeletionFact = (db, collection, id) =>
  Boolean(db.prepare('SELECT 1 FROM deletion_facts WHERE collection=? AND entity_id=?').get(collection, id));
export function assertNoDeletedEntities(db, state, previous = null) {
  for (const collection of LOCAL_DATA_COLLECTIONS) {
    const existing = new Set((previous?.[collection] ?? []).map(record => record.id));
    for (const record of state[collection])
      if (!existing.has(record.id) && hasDeletionFact(db, collection, record.id)) {
        throw createAppError(
          'LOCAL_DELETION_FACT_CONFLICT',
          '已永久删除的对象不能用原 ID 重新写入；原数据和删除事实已保留。',
          409
        );
      }
  }
}
export function recordLocalDeletions(db, changes, operationId) {
  const observedAt = new Date().toISOString();
  const datasetId = rawMeta(db, 'datasetId');
  for (const change of changes)
    if (change.before !== null && change.value === null) {
      insert(
        db,
        change.collection,
        change.entityId,
        { kind: 'local-commit', datasetId, operationId },
        { observedAt, deletedAt: observedAt }
      );
    }
}
export function deletionFactsReader(db) {
  return Object.freeze({
    has: (collection, id) => hasDeletionFact(db, collection, id),
    list: () =>
      db
        .prepare('SELECT record_json FROM deletion_facts ORDER BY collection,entity_id')
        .all()
        .map(row => JSON.parse(row.record_json)),
    getCoverage: () => JSON.parse(rawMeta(db, 'deletionFactsCoverage'))
  });
}
