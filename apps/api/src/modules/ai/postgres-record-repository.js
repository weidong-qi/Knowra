import { randomUUID } from 'node:crypto';
import { AI_RECORD_KINDS } from './record-contract.js';
import { createEmptyAiState, createJsonAiRepository } from './record-state.js';
import { AI_SQL_DEFINITIONS, decodeAiRow, encodeAiRow } from './record-sql-map.js';

const KINDS = /** @type {import('./record-types.ts').AiRecordKind[]} */ (Object.keys(AI_SQL_DEFINITIONS));
/** @template [Row=import('./record-infrastructure-types.ts').RawAiSqlRow]
 * @param {import('./record-infrastructure-types.ts').AiSqlTransaction} db
 * @param {string} sql
 * @param {...import('./record-infrastructure-types.ts').AiSqlValue} values
 * @returns {Promise<Row[]>} */
const readRows = (db, sql, ...values) => db.$queryRawUnsafe(sql, ...values);
/** @param {import('./record-infrastructure-types.ts').AiSqlTransaction} db
 * @param {string} sql
 * @param {...import('./record-infrastructure-types.ts').AiSqlValue} values */
const writeRows = (db, sql, ...values) => db.$executeRawUnsafe(sql, ...values);

function assertKind(kind) {
  const definition = AI_SQL_DEFINITIONS[kind];
  if (!definition) throw new TypeError('未知的 AI 记录类型。');
  return definition;
}

async function ensureIdentity(db, ownerId) {
  await writeRows(
    db,
    `INSERT INTO ai_runtime_epochs (owner_id, dataset_id, dataset_epoch, updated_at)
    VALUES ($1, $2, $3, $4) ON CONFLICT (owner_id) DO NOTHING`,
    ownerId,
    randomUUID(),
    randomUUID(),
    new Date().toISOString()
  );
  /** @type {import('./record-infrastructure-types.ts').AiSqlEpochRow[]} */
  const [row] = await readRows(
    db,
    'SELECT dataset_id, dataset_epoch FROM ai_runtime_epochs WHERE owner_id = $1',
    ownerId
  );
  return { datasetId: row.dataset_id, datasetEpoch: row.dataset_epoch };
}

function ownerSelection(kind) {
  const { table } = assertKind(kind);
  return ['aiJobAttempt', 'aiUsageRecord'].includes(kind)
    ? `FROM ${table} r JOIN ai_jobs j ON j.job_id = r.job_id WHERE j.owner_id = $1`
    : `FROM ${table} r WHERE r.owner_id = $1`;
}

async function loadState(db, identity, ownerId) {
  const state = createEmptyAiState(identity);
  for (const kind of KINDS) {
    /** @type {Record<keyof import('./record-types.ts').AiRecordCollections, import('./record-types.ts').AiRecord[]>} */ (
      state
    )[AI_RECORD_KINDS[kind].collection] = (await readRows(db, `SELECT r.* ${ownerSelection(kind)}`, ownerId)).map(row =>
      decodeAiRow(kind, row)
    );
  }
  state.events = (
    await /** @type {Promise<import('./record-infrastructure-types.ts').AiSqlEventRow[]>} */ (
      readRows(
        db,
        `SELECT e.job_id, e.sequence, e.event_kind, e.safe_payload_json, e.created_at
    FROM ai_job_events e JOIN ai_jobs j ON j.job_id = e.job_id WHERE j.owner_id = $1 ORDER BY e.job_id, e.sequence`,
        ownerId
      )
    )
  ).map(row => ({
    jobId: row.job_id,
    sequence: row.sequence,
    eventKind: row.event_kind,
    safePayload: JSON.parse(row.safe_payload_json),
    createdAt: row.created_at
  }));
  return state;
}

async function insertRow(db, kind, record) {
  const definition = assertKind(kind);
  const row = encodeAiRow(kind, record);
  const names = Object.keys(row);
  await writeRows(
    db,
    `INSERT INTO ${definition.table} (${names.join(', ')})
    VALUES (${names.map((_, index) => `$${index + 1}`).join(', ')})`,
    ...Object.values(row)
  );
}

async function replaceRow(db, kind, record) {
  const definition = assertKind(kind);
  const row = encodeAiRow(kind, record);
  const names = Object.keys(row).filter(name => name !== definition.id);
  await writeRows(
    db,
    `UPDATE ${definition.table}
    SET ${names.map((name, index) => `${name} = $${index + 1}`).join(', ')}
    WHERE ${definition.id} = $${names.length + 1}`,
    ...names.map(name => row[name]),
    row[definition.id]
  );
}

/** @param {import('./record-infrastructure-types.ts').AiSqlError | null | undefined} error */
const retryable = error =>
  error?.code === 'P2034' ||
  error?.code === '23505' ||
  error?.code === '40001' ||
  error?.meta?.code === '23505' ||
  error?.meta?.code === '40001';

/** PostgreSQL 使用数据库唯一约束和 SERIALIZABLE 事务保护并发插入。
 * @param {import('./record-infrastructure-types.ts').PostgresAiRepositoryOptions} options */
export function createPostgresAiRepository({ client, ownerId }) {
  if (!client?.$transaction || !ownerId) throw new TypeError('PostgreSQL AI repository needs client and owner');

  async function mutate(action, kind, input, expectedHash) {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      try {
        return await client.$transaction(
          async db => {
            const identity = await ensureIdentity(db, ownerId);
            if (input?.ownerId && input.ownerId !== ownerId) throw new Error('AI 记录不属于当前 owner。');
            const state = await loadState(db, identity, ownerId);
            const repository = createJsonAiRepository({
              getState: () => state,
              runTransaction: operation => operation(),
              onChange: () => {}
            });
            if (action === 'insert') {
              const before = state[AI_RECORD_KINDS[kind].collection].length;
              const result = repository.insert(kind, input);
              if (state[AI_RECORD_KINDS[kind].collection].length !== before) await insertRow(db, kind, result);
              return result;
            }
            if (action === 'replace') {
              const result = repository.replace(kind, input, expectedHash);
              await replaceRow(db, kind, result);
              return result;
            }
            const event = repository.appendEvent(input);
            await writeRows(
              db,
              `INSERT INTO ai_job_events (job_id, sequence, event_kind, safe_payload_json, created_at)
            VALUES ($1, $2, $3, $4, $5)`,
              event.jobId,
              event.sequence,
              event.eventKind,
              JSON.stringify(event.safePayload),
              event.createdAt
            );
            return event;
          },
          { isolationLevel: 'Serializable', maxWait: 5000, timeout: 15000 }
        );
      } catch (error) {
        if (!retryable(error) || attempt === 3) throw error;
      }
    }
  }

  return {
    identity: () => client.$transaction(db => ensureIdentity(db, ownerId)),
    async get(kind, id) {
      const { id: idColumn } = assertKind(kind);
      const [row] = await readRows(client, `SELECT r.* ${ownerSelection(kind)} AND r.${idColumn} = $2`, ownerId, id);
      return decodeAiRow(kind, row);
    },
    async list(kind, filter = {}) {
      return (await readRows(client, `SELECT r.* ${ownerSelection(kind)}`, ownerId))
        .map(row => decodeAiRow(kind, row))
        .filter(record => Object.entries(filter).every(([key, value]) => record[key] === value));
    },
    insert: (kind, input) => mutate('insert', kind, input),
    replace: (kind, input, expectedHash) => mutate('replace', kind, input, expectedHash),
    appendEvent: input => mutate('event', null, input),
    async listEvents(jobId) {
      return (
        await /** @type {Promise<import('./record-infrastructure-types.ts').AiSqlEventRow[]>} */ (
          readRows(
            client,
            `SELECT e.job_id, e.sequence, e.event_kind, e.safe_payload_json, e.created_at
        FROM ai_job_events e JOIN ai_jobs j ON j.job_id = e.job_id WHERE j.owner_id = $1 AND e.job_id = $2 ORDER BY e.sequence`,
            ownerId,
            jobId
          )
        )
      ).map(row => ({
        jobId: row.job_id,
        sequence: row.sequence,
        eventKind: row.event_kind,
        safePayload: JSON.parse(row.safe_payload_json),
        createdAt: row.created_at
      }));
    },
    async rotateEpoch() {
      return client.$transaction(async db => {
        await ensureIdentity(db, ownerId);
        const epoch = randomUUID();
        await writeRows(
          db,
          'UPDATE ai_runtime_epochs SET dataset_epoch = $1, updated_at = $2 WHERE owner_id = $3',
          epoch,
          new Date().toISOString(),
          ownerId
        );
        return epoch;
      });
    }
  };
}
