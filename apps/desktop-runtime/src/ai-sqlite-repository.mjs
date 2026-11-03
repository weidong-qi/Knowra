import { randomUUID } from 'node:crypto';
import { AI_SQL_DEFINITIONS, encodeAiRow, decodeAiRow } from '../../api/src/modules/ai/record-sql-map.ts';
import { createAiRecordRepository } from '../../api/src/modules/ai/record-repository.ts';

/** SQLite 私有表不走 entities、sync_outbox 或普通快照导出。 */
export function createSqliteAiRepository(db) {
  const readMeta = key => db.prepare('SELECT value FROM metadata WHERE key = ?').get(key)?.value;
  function transaction(operation) {
    if (db.isTransaction) return operation();
    db.exec('BEGIN IMMEDIATE');
    try {
      const result = operation();
      if (result?.then) throw new TypeError('SQLite AI 事务不能包含异步操作。');
      db.exec('COMMIT');
      return result;
    } catch (error) {
      if (db.isTransaction) db.exec('ROLLBACK');
      throw error;
    }
  }
  const adapter = {
    identity: () => ({ datasetId: readMeta('datasetId'), datasetEpoch: readMeta('aiRuntimeEpoch') }),
    transaction,
    get(kind, id) {
      const def = AI_SQL_DEFINITIONS[kind];
      return decodeAiRow(kind, db.prepare(`SELECT * FROM ${def.table} WHERE ${def.id} = ?`).get(id));
    },
    list(kind) {
      const def = AI_SQL_DEFINITIONS[kind];
      return db
        .prepare(`SELECT * FROM ${def.table}`)
        .all()
        .map(row => decodeAiRow(kind, row));
    },
    insert(kind, record) {
      const { table } = AI_SQL_DEFINITIONS[kind];
      const row = encodeAiRow(kind, record);
      const names = Object.keys(row);
      db.prepare(`INSERT INTO ${table} (${names.join(', ')}) VALUES (${names.map(() => '?').join(', ')})`).run(
        ...Object.values(row)
      );
    },
    replace(kind, record) {
      const { table, id } = AI_SQL_DEFINITIONS[kind];
      const row = encodeAiRow(kind, record);
      const names = Object.keys(row).filter(name => name !== id);
      db.prepare(`UPDATE ${table} SET ${names.map(name => `${name} = ?`).join(', ')} WHERE ${id} = ?`).run(
        ...names.map(name => row[name]),
        row[id]
      );
    },
    listEvents(jobId) {
      return db
        .prepare(
          'SELECT job_id, sequence, event_kind, safe_payload_json, created_at FROM ai_job_events WHERE job_id = ? ORDER BY sequence'
        )
        .all(jobId)
        .map(row => ({
          jobId: row.job_id,
          sequence: row.sequence,
          eventKind: row.event_kind,
          safePayload: JSON.parse(row.safe_payload_json),
          createdAt: row.created_at
        }));
    },
    insertEvent(event) {
      db.prepare(
        'INSERT INTO ai_job_events (job_id, sequence, event_kind, safe_payload_json, created_at) VALUES (?, ?, ?, ?, ?)'
      ).run(event.jobId, event.sequence, event.eventKind, JSON.stringify(event.safePayload), event.createdAt);
    },
    rotateEpoch() {
      return transaction(() => {
        const epoch = randomUUID();
        db.prepare('INSERT OR REPLACE INTO metadata VALUES (?, ?)').run('aiRuntimeEpoch', epoch);
        return epoch;
      });
    }
  };
  return createAiRecordRepository(adapter);
}
