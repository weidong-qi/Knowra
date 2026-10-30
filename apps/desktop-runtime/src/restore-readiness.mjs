import { createAppError } from '../../api/src/errors/app-error.js';
import { LOCAL_DATA_COLLECTIONS } from '../../api/src/infrastructure/local-data-schema.js';
import { assertNoKnowledgeArtifactProvenanceDowngrade } from '../../api/src/modules/knowledge/domain/knowledge-artifact-provenance-state.js';
import {
  validateSqliteDeletionFacts,
  factHash,
  serverOrigin,
  invalidFacts,
  validateFact
} from './sqlite-deletion-facts-contract.mjs';
import { legacyDeletionObservations } from './sqlite-deletion-facts.mjs';
import { projectSqliteProvenance } from './sqlite-provenance-projection.mjs';

export const RESTORE_READINESS_CONFLICTS = new Set([
  'LOCAL_RESTORE_DELETION_CONFLICT',
  'LOCAL_RESTORE_PROVENANCE_CONFLICT',
  'LOCAL_RESTORE_BINDING_CONFLICT'
]);
const keyOf = (collection, id) => JSON.stringify([collection, id]);
const rawMeta = (db, key) => db.prepare('SELECT value FROM metadata WHERE key=?').get(key)?.value;
const conflict = (code, message) => createAppError(code, message, 409);
function readBinding(db) {
  let origin, ownerId;
  try {
    origin = JSON.parse(rawMeta(db, 'sync:serverUrl') ?? 'null');
    ownerId = JSON.parse(rawMeta(db, 'sync:ownerId') ?? 'null');
  } catch {
    throw conflict('LOCAL_RESTORE_BINDING_CONFLICT', '同步绑定记录不完整，无法确认此备份适用于当前资料；未切换资料。');
  }
  if (origin === null && ownerId === null) return null;
  if (
    !serverOrigin(origin) ||
    typeof ownerId !== 'string' ||
    !ownerId ||
    ownerId.trim() !== ownerId ||
    ownerId.length > 2048
  ) {
    throw conflict('LOCAL_RESTORE_BINDING_CONFLICT', '同步绑定记录不完整，无法确认此备份适用于当前资料；未切换资料。');
  }
  return { serverOrigin: origin, ownerId };
}

/** 内部快照不进入 HTTP 响应；旧包只投影，不创建表、scope 或覆盖起点。 */
export function readRestoreSnapshot(db, state, { projectProvenance = false, initialState = state } = {}) {
  const ledger = validateSqliteDeletionFacts(db);
  const binding = readBinding(db);
  const rows = ledger ? db.prepare('SELECT * FROM deletion_facts ORDER BY collection,entity_id').all() : [];
  const facts = new Set(rows.map(row => keyOf(row.collection, row.entity_id)));
  if (!ledger)
    for (const observation of legacyDeletionObservations(db)) {
      // 与启动补录采用同一 contract，避免只读预检接受不可迁移的旧观察。
      const scope = { scopeId: 'readonly-projection', ownerId: 'demo' };
      const record = {
        schemaVersion: 1,
        ...observation,
        ...scope,
        observationId: factHash([scope.scopeId, observation.collection, observation.entityId, observation.source]),
        observedAt: '2000-01-01T00:00:00.000Z',
        deletedAt: null
      };
      validateFact(record, scope);
      facts.add(keyOf(observation.collection, observation.entityId));
    }
  const projected = structuredClone(state);
  if (projectProvenance)
    projectSqliteProvenance(db, projected, {
      initialState,
      hasFact: (collection, id) => facts.has(keyOf(collection, id))
    });
  return { ledger, rows, facts, binding, state: projected };
}
export const readRestoreContext = store => store.readSync((db, state) => readRestoreSnapshot(db, state));

export function assertRestoreReadiness(current, candidate) {
  const a = current.binding,
    b = candidate.binding;
  if (a && b && (a.serverOrigin !== b.serverOrigin || a.ownerId !== b.ownerId)) {
    throw conflict(
      'LOCAL_RESTORE_BINDING_CONFLICT',
      '备份与当前资料的同步服务器或账号不同，不能在当前资料中恢复；未切换资料。'
    );
  }
  for (const collection of LOCAL_DATA_COLLECTIONS) {
    // 当前资料里仍存在的对象（例如云端已退休、但本机私有记录仍引用而保留的版本副本）恢复后也只是原样保留，
    // 不会复活任何已删除的东西；只有当前资料里已经没有的"已知删除"对象才拒绝恢复。
    const presentNow = new Set((current.state[collection] ?? []).map(item => item.id));
    for (const record of candidate.state[collection]) {
      const key = keyOf(collection, record.id);
      if ((current.facts.has(key) || candidate.facts.has(key)) && !presentNow.has(record.id)) {
        throw conflict(
          'LOCAL_RESTORE_DELETION_CONFLICT',
          '备份包含当前已知永久删除的对象，不能恢复到当前资料；备份和原资料已保留。'
        );
      }
    }
  }
  try {
    assertNoKnowledgeArtifactProvenanceDowngrade(current.state, candidate.state);
  } catch (error) {
    if (error.code !== 'KNOWLEDGE_ARTIFACT_PROVENANCE_CONFLICT') throw error;
    throw conflict(
      'LOCAL_RESTORE_PROVENANCE_CONFLICT',
      '此备份会覆盖或降级当前已保存的来源事实，不能恢复到当前资料；备份和原资料已保留。'
    );
  }
  return a ?? b;
}

/** 所有 owner 排空后调用；同步候选事务完成后才允许发布活动目录指针。 */
export function mergeRestoreFacts(candidateStore, current) {
  candidateStore.syncTransaction((db, state) => {
    const candidate = readRestoreSnapshot(db, state);
    const binding = assertRestoreReadiness(current, candidate);
    if (!current.ledger || !candidate.ledger) throw invalidFacts('恢复候选尚未完成删除事实初始化。');
    const scope = current.ledger.scope;
    const coverage = {
      ...current.ledger.coverage,
      legacyHistory: [current.ledger.coverage, candidate.ledger.coverage].some(
        value => value.legacyHistory === 'incomplete'
      )
        ? 'incomplete'
        : 'none-new-store'
    };
    const put = (key, value) => db.prepare('INSERT OR REPLACE INTO metadata VALUES (?,?)').run(key, value);
    put('deletionFactsScope', JSON.stringify(scope));
    put('deletionFactsCoverage', JSON.stringify(coverage));
    if (binding) {
      put('sync:serverUrl', JSON.stringify(binding.serverOrigin));
      put('sync:ownerId', JSON.stringify(binding.ownerId));
    }
    put('sync:clientPaused', 'true');
    db.exec('DELETE FROM deletion_facts');
    const insert = db.prepare(
      'INSERT INTO deletion_facts VALUES (?,?,?,?) ON CONFLICT(collection,entity_id) DO NOTHING'
    );
    // 当前同 key 的原始 JSON/hash 字节优先，绝不以候选覆盖首次事实。
    for (const row of current.rows) insert.run(row.collection, row.entity_id, row.record_hash, row.record_json);
    for (const row of candidate.rows) {
      if (current.facts.has(keyOf(row.collection, row.entity_id))) continue;
      const record = { ...JSON.parse(row.record_json), scopeId: scope.scopeId, ownerId: scope.ownerId };
      record.observationId = factHash([record.scopeId, record.collection, record.entityId, record.source]);
      insert.run(row.collection, row.entity_id, factHash(record), JSON.stringify(record));
    }
    validateSqliteDeletionFacts(db);
  });
}
