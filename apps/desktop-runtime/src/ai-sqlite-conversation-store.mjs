import {
  CONVERSATION_KINDS,
  emptyConversationState,
  validateConversationRecord,
  validateConversationState
} from '../../api/src/modules/ai/conversation-records.ts';
import { createAiConversationStore } from '../../api/src/modules/ai/conversation-store.ts';
import { hashRecord } from '../../api/src/modules/ai/record-contract.ts';

function loadRows(db) {
  const state = emptyConversationState();
  for (const row of db.prepare('SELECT * FROM ai_conversation_records').all()) {
    const definition = CONVERSATION_KINDS[row.kind];
    if (!definition) throw new Error('AI 会话记录类型无效。');
    const record = validateConversationRecord(row.kind, JSON.parse(row.record_json));
    if (
      record[definition.id] !== row.record_id ||
      record.ownerId !== row.owner_id ||
      record.datasetId !== row.dataset_id ||
      record.datasetEpoch !== row.dataset_epoch ||
      record.spaceId !== row.space_id ||
      hashRecord(record) !== row.record_hash
    ) {
      throw new Error('AI 会话私有索引与正文不一致。');
    }
    state[definition.collection].push(record);
  }
  return validateConversationState(state);
}

export function createSqliteAiConversationStore(db, options) {
  const identity = () => ({
    datasetId: db.prepare("SELECT value FROM metadata WHERE key = 'datasetId'").get().value,
    datasetEpoch: db.prepare("SELECT value FROM metadata WHERE key = 'aiRuntimeEpoch'").get().value
  });
  const load = () => loadRows(db);
  return createAiConversationStore(
    {
      identity,
      read: load,
      write(action) {
        const owns = !db.isTransaction;
        if (owns) db.exec('BEGIN IMMEDIATE');
        try {
          const state = load(),
            previous = new Map();
          for (const [kind, definition] of Object.entries(CONVERSATION_KINDS)) {
            for (const record of state[definition.collection])
              previous.set(`${kind}:${record[definition.id]}`, hashRecord(record));
          }
          const result = action(state, identity());
          for (const [kind, definition] of Object.entries(CONVERSATION_KINDS)) {
            for (const record of state[definition.collection]) {
              const recordId = record[definition.id],
                recordHash = hashRecord(record);
              if (previous.get(`${kind}:${recordId}`) === recordHash) continue;
              const changed = db
                .prepare(
                  `INSERT INTO ai_conversation_records
              (kind, record_id, owner_id, dataset_id, dataset_epoch, space_id, record_hash, record_json)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT(kind, record_id) DO UPDATE SET record_hash = excluded.record_hash,
                record_json = excluded.record_json
              WHERE ai_conversation_records.owner_id = excluded.owner_id
                AND ai_conversation_records.dataset_id = excluded.dataset_id
                AND ai_conversation_records.dataset_epoch = excluded.dataset_epoch
                AND ai_conversation_records.space_id = excluded.space_id`
                )
                .run(
                  kind,
                  recordId,
                  record.ownerId,
                  record.datasetId,
                  record.datasetEpoch,
                  record.spaceId,
                  recordHash,
                  JSON.stringify(record)
                );
              if (changed.changes !== 1) throw new Error('AI 会话记录 ID 与其他资料集冲突。');
            }
          }
          if (owns) db.exec('COMMIT');
          return structuredClone(result);
        } catch (error) {
          if (owns && db.isTransaction) db.exec('ROLLBACK');
          throw error;
        }
      }
    },
    options
  );
}

export function validateSqliteConversationRows(db) {
  return loadRows(db);
}
