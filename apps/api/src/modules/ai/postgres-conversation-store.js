import { randomUUID } from 'node:crypto';
import {
  CONVERSATION_KINDS,
  emptyConversationState,
  conversationError,
  validateConversationRecord,
  validateConversationState
} from './conversation-records.js';
import { createAiConversationStore } from './conversation-store.js';
import { hashRecord } from './record-contract.ts';

const retryable = error =>
  ['P2034', '23505', '40001'].includes(error?.code) || ['23505', '40001'].includes(error?.meta?.code);

export function createPostgresAiConversationStore({ client, repository, ownerId }, options) {
  if (!client?.$transaction || !repository || !ownerId)
    throw new TypeError('PostgreSQL AI conversation store needs client, repository and owner');
  async function load(db) {
    const state = emptyConversationState();
    for (const row of await db.$queryRawUnsafe('SELECT * FROM ai_conversation_records WHERE owner_id = $1', ownerId)) {
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
  return createAiConversationStore(
    {
      identity: () => repository.identity(),
      read: () => load(client),
      async write(action) {
        for (let attempt = 0; attempt < 4; attempt += 1) {
          try {
            return await client.$transaction(
              async db => {
                // 与 v1 任务共用资料集标识；锁定 owner 的 epoch 行后再修改会话。
                await db.$executeRawUnsafe(
                  `INSERT INTO ai_runtime_epochs (owner_id, dataset_id, dataset_epoch, updated_at)
              VALUES ($1, $2, $3, $4) ON CONFLICT (owner_id) DO NOTHING`,
                  ownerId,
                  randomUUID(),
                  randomUUID(),
                  new Date().toISOString()
                );
                const [epoch] = await db.$queryRawUnsafe(
                  'SELECT dataset_id, dataset_epoch FROM ai_runtime_epochs WHERE owner_id = $1 FOR UPDATE',
                  ownerId
                );
                const identity = { datasetId: epoch.dataset_id, datasetEpoch: epoch.dataset_epoch };
                const state = await load(db),
                  previous = new Map();
                for (const [kind, definition] of Object.entries(CONVERSATION_KINDS)) {
                  for (const record of state[definition.collection])
                    previous.set(`${kind}:${record[definition.id]}`, hashRecord(record));
                }
                const result = action(state, identity);
                for (const [kind, definition] of Object.entries(CONVERSATION_KINDS)) {
                  for (const record of state[definition.collection]) {
                    if (record.ownerId !== ownerId) throw new Error('AI 会话 owner 不匹配。');
                    const recordId = record[definition.id],
                      recordHash = hashRecord(record);
                    if (previous.get(`${kind}:${recordId}`) === recordHash) continue;
                    const changed = await db.$executeRawUnsafe(
                      `INSERT INTO ai_conversation_records
                  (kind, record_id, owner_id, dataset_id, dataset_epoch, space_id, record_hash, record_json)
                  VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                  ON CONFLICT (kind, record_id) DO UPDATE SET record_hash = EXCLUDED.record_hash,
                    record_json = EXCLUDED.record_json
                  WHERE ai_conversation_records.owner_id = EXCLUDED.owner_id
                    AND ai_conversation_records.dataset_id = EXCLUDED.dataset_id
                    AND ai_conversation_records.dataset_epoch = EXCLUDED.dataset_epoch
                    AND ai_conversation_records.space_id = EXCLUDED.space_id`,
                      kind,
                      recordId,
                      record.ownerId,
                      record.datasetId,
                      record.datasetEpoch,
                      record.spaceId,
                      recordHash,
                      JSON.stringify(record)
                    );
                    if (Number(changed) !== 1)
                      conversationError('AI_IDEMPOTENCY_CONFLICT', '会话记录 ID 与其他资料集冲突。');
                  }
                }
                return structuredClone(result);
              },
              { isolationLevel: 'Serializable', maxWait: 5000, timeout: 15000 }
            );
          } catch (error) {
            if (!retryable(error) || attempt === 3) throw error;
          }
        }
      }
    },
    options
  );
}
