import { ACCESS_KINDS, accessError, createAiAccessStore, validateAccessRecord } from './access-records.js';
import { hashRecord } from './record-contract.ts';

const definitions = {
  aiAccessPolicy: { table: 'ai_access_policies', id: 'policy_id', parent: null },
  aiRunGrant: { table: 'ai_run_grants', id: 'grant_id', parent: 'policy_id' },
  aiRequestManifest: { table: 'ai_request_manifests', id: 'manifest_id', parent: 'grant_id' }
};

/** PostgreSQL v2 私有表；修改策略使用记录哈希 CAS，旧任务表不改写。 */
export function createPostgresAiAccessStore({ client, repository, ownerId }) {
  if (!client || !repository || !ownerId)
    throw new TypeError('PostgreSQL AI access store needs client, repository and owner');
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
    identity: () => repository.identity(),
    async get(kind, id) {
      const { table, id: column } = definitions[kind];
      const rows = await client.$queryRawUnsafe(
        `SELECT * FROM ${table} WHERE ${column} = $1 AND owner_id = $2`,
        id,
        ownerId
      );
      return decode(kind, rows[0]);
    },
    async list(kind) {
      const { table } = definitions[kind];
      return (await client.$queryRawUnsafe(`SELECT * FROM ${table} WHERE owner_id = $1`, ownerId)).map(row =>
        decode(kind, row)
      );
    },
    async insert(kind, record) {
      if (record.ownerId !== ownerId) accessError('AI_SCOPE_FORBIDDEN', '授权记录 owner 不匹配。');
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
      await client.$executeRawUnsafe(
        `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${values.map((_, index) => `$${index + 1}`).join(', ')})`,
        ...values
      );
    },
    async compareAndSwap(record, expectedHash) {
      const changed = await client.$transaction(async tx => {
        await tx.$queryRawUnsafe('SELECT pg_advisory_xact_lock(1266775634, 32)::text');
        return tx.$executeRawUnsafe(
          `UPDATE ai_access_policies
        SET revision = $1, record_hash = $2, record_json = $3
        WHERE policy_id = $4 AND owner_id = $5 AND record_hash = $6`,
          record.revision,
          hashRecord(record),
          JSON.stringify(record),
          record.policyId,
          ownerId,
          expectedHash
        );
      });
      if (Number(changed) !== 1) accessError('AI_RECORD_CONFLICT', '授权策略已变化。');
    }
  });
}
