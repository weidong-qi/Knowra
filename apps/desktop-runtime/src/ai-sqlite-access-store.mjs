import {
  ACCESS_KINDS,
  accessError,
  createAiAccessStore,
  validateAccessRecord,
  validateAccessRelationships
} from '../../api/src/modules/ai/access-records.js';
import { hashRecord } from '../../api/src/modules/ai/record-contract.ts';

const definitions = {
  aiAccessPolicy: { table: 'ai_access_policies', id: 'policy_id', parent: null },
  aiRunGrant: { table: 'ai_run_grants', id: 'grant_id', parent: 'policy_id' },
  aiRequestManifest: { table: 'ai_request_manifests', id: 'manifest_id', parent: 'grant_id' }
};

export function validateSqliteAccessRows(db) {
  const state = { accessPolicies: [], runGrants: [], requestManifests: [] };
  for (const [kind, { table, id }] of Object.entries(definitions)) {
    for (const row of db.prepare(`SELECT * FROM ${table}`).all()) {
      const record = validateAccessRecord(kind, JSON.parse(row.record_json));
      if (
        record[ACCESS_KINDS[kind].id] !== row[id] ||
        record.ownerId !== row.owner_id ||
        record.datasetId !== row.dataset_id ||
        record.datasetEpoch !== row.dataset_epoch ||
        record.spaceId !== row.space_id ||
        (kind === 'aiAccessPolicy' && record.revision !== row.revision) ||
        hashRecord(record) !== row.record_hash
      ) {
        throw new Error('AI v2 私有索引与正文不一致。');
      }
      state[ACCESS_KINDS[kind].collection].push(record);
    }
  }
  validateAccessRelationships(state);
}

export function createSqliteAiAccessStore(db) {
  const readMeta = key => db.prepare('SELECT value FROM metadata WHERE key = ?').get(key)?.value;
  function decode(kind, row) {
    if (!row) return null;
    const record = validateAccessRecord(kind, JSON.parse(row.record_json));
    if (
      record[ACCESS_KINDS[kind].id] !== row[definitions[kind].id] ||
      record.ownerId !== row.owner_id ||
      record.datasetId !== row.dataset_id ||
      record.datasetEpoch !== row.dataset_epoch ||
      record.spaceId !== row.space_id ||
      (kind === 'aiAccessPolicy' && record.revision !== row.revision) ||
      hashRecord(record) !== row.record_hash
    )
      throw new Error('AI v2 私有索引与正文不一致。');
    return record;
  }
  return createAiAccessStore({
    identity: () => ({ datasetId: readMeta('datasetId'), datasetEpoch: readMeta('aiRuntimeEpoch') }),
    get: (kind, id) => {
      const { table, id: column } = definitions[kind];
      return decode(kind, db.prepare(`SELECT * FROM ${table} WHERE ${column} = ?`).get(id));
    },
    list: kind =>
      db
        .prepare(`SELECT * FROM ${definitions[kind].table}`)
        .all()
        .map(row => decode(kind, row)),
    insert: (kind, record) => {
      const { table, id, parent } = definitions[kind];
      const columns = [
        id,
        ...(parent ? [parent] : []),
        'owner_id',
        'dataset_id',
        'dataset_epoch',
        'space_id',
        ...(kind === 'aiAccessPolicy' ? ['revision'] : []),
        'record_hash',
        'record_json'
      ];
      const values = [
        record[ACCESS_KINDS[kind].id],
        ...(parent ? [record[parent === 'policy_id' ? 'policyId' : 'grantId']] : []),
        record.ownerId,
        record.datasetId,
        record.datasetEpoch,
        record.spaceId,
        ...(kind === 'aiAccessPolicy' ? [record.revision] : []),
        hashRecord(record),
        JSON.stringify(record)
      ];
      db.prepare(`INSERT INTO ${table} (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`).run(
        ...values
      );
    },
    compareAndSwap: (record, expectedHash) => {
      const result = db
        .prepare(
          `UPDATE ai_access_policies
        SET revision = ?, record_hash = ?, record_json = ?
        WHERE policy_id = ? AND owner_id = ? AND record_hash = ?`
        )
        .run(
          record.revision,
          hashRecord(record),
          JSON.stringify(record),
          record.policyId,
          record.ownerId,
          expectedHash
        );
      if (result.changes !== 1) accessError('AI_RECORD_CONFLICT', '授权策略已变化。');
    }
  });
}
