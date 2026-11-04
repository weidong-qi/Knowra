import { createPostgresPurgeTaskReader } from './asset-purge-task-state.ts';
import type { QuerySqlPort } from './core-operation-types.ts';

const privateTables = [
  ['ai_conversation_records', 'record_json'],
  ['ai_access_policies', 'record_json'],
  ['ai_run_grants', 'record_json'],
  ['ai_request_manifests', 'record_json'],
  ['ai_note_action_states', 'state_json'],
  ['core_operation_receipts', 'receipt_json'],
  ['ai_actions', 'plan_json'],
  ['ai_actions', 'receipt_json']
];

/** 在调用方已有事务中读取；未迁移/损坏的私有记录使自动清理停止，不能当作没有引用。 */
export async function readPostgresHistoryRetentionReferences(tx: QuerySqlPort, ownerId: string): Promise<unknown[]> {
  const records: unknown[] = [await createPostgresPurgeTaskReader(tx, ownerId)()];
  for (const [table, column] of privateTables) {
    const fields = await tx.$queryRawUnsafe(
      `SELECT a.attname::text AS name FROM pg_attribute a
      WHERE a.attrelid = to_regclass($1) AND a.attnum > 0 AND NOT a.attisdropped`,
      table
    );
    if (!fields.some(field => field.name === column) || !fields.some(field => field.name === 'owner_id')) {
      throw new Error('私有历史引用表不完整，暂不清理。');
    }
    const rows = await tx.$queryRawUnsafe(`SELECT ${column} AS value FROM ${table} WHERE owner_id = $1`, ownerId);
    for (const row of rows)
      if (row.value !== null) records.push(typeof row.value === 'string' ? JSON.parse(row.value) : row.value);
  }
  return records;
}
