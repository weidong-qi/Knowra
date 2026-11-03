import type { DatasetIdentity } from '../task-workspaces/repository-port.ts';
import type {
  AiRecordFields,
  AiSqlError,
  AiSqlEpochRow,
  AiSqlEventRow,
  AiSqlTransaction,
  AiSqlValue,
  PostgresAiRepositoryOptions,
  RawAiSqlRow
} from './record-infrastructure-types.ts';
import type {
  AiEvent,
  AiReadEvent,
  AiRecord,
  AiRecordByKind,
  AiRecordCollections,
  AiRecordKind
} from './record-types.ts';
import { randomUUID } from 'node:crypto';
import { AI_RECORD_KINDS } from './record-contract.ts';
import { createEmptyAiState, createJsonAiRepository } from './record-state.ts';
import { AI_SQL_DEFINITIONS, decodeAiRow, encodeAiRow } from './record-sql-map.ts';

const KINDS = Object.keys(AI_SQL_DEFINITIONS) as AiRecordKind[];
const readRows = <Row = RawAiSqlRow>(db: AiSqlTransaction, sql: string, ...values: AiSqlValue[]) =>
  db.$queryRawUnsafe<Row[]>(sql, ...values);
const writeRows = (db: AiSqlTransaction, sql: string, ...values: AiSqlValue[]) => db.$executeRawUnsafe(sql, ...values);

function assertKind(kind: AiRecordKind) {
  const definition = AI_SQL_DEFINITIONS[kind];
  if (!definition) throw new TypeError('未知的 AI 记录类型。');
  return definition;
}

async function ensureIdentity(db: AiSqlTransaction, ownerId: string): Promise<DatasetIdentity> {
  await writeRows(
    db,
    `INSERT INTO ai_runtime_epochs (owner_id, dataset_id, dataset_epoch, updated_at)
    VALUES ($1, $2, $3, $4) ON CONFLICT (owner_id) DO NOTHING`,
    ownerId,
    randomUUID(),
    randomUUID(),
    new Date().toISOString()
  );
  const [row] = await readRows<AiSqlEpochRow>(
    db,
    'SELECT dataset_id, dataset_epoch FROM ai_runtime_epochs WHERE owner_id = $1',
    ownerId
  );
  return { datasetId: row.dataset_id, datasetEpoch: row.dataset_epoch };
}

function ownerSelection(kind: AiRecordKind) {
  const { table } = assertKind(kind);
  return ['aiJobAttempt', 'aiUsageRecord'].includes(kind)
    ? `FROM ${table} r JOIN ai_jobs j ON j.job_id = r.job_id WHERE j.owner_id = $1`
    : `FROM ${table} r WHERE r.owner_id = $1`;
}

async function loadState(db: AiSqlTransaction, identity: DatasetIdentity, ownerId: string) {
  const state = createEmptyAiState(identity);
  for (const kind of KINDS) {
    (state as Record<keyof AiRecordCollections, AiRecord[]>)[AI_RECORD_KINDS[kind].collection] = (
      await readRows(db, `SELECT r.* ${ownerSelection(kind)}`, ownerId)
    ).map(row => decodeAiRow(kind, row));
  }
  state.events = (
    await readRows<AiSqlEventRow>(
      db,
      `SELECT e.job_id, e.sequence, e.event_kind, e.safe_payload_json, e.created_at
    FROM ai_job_events e JOIN ai_jobs j ON j.job_id = e.job_id WHERE j.owner_id = $1 ORDER BY e.job_id, e.sequence`,
      ownerId
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

async function insertRow<Kind extends AiRecordKind>(db: AiSqlTransaction, kind: Kind, record: AiRecordByKind[Kind]) {
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

async function replaceRow<Kind extends AiRecordKind>(db: AiSqlTransaction, kind: Kind, record: AiRecordByKind[Kind]) {
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

const retryable = (error: unknown) =>
  (error as AiSqlError | null | undefined)?.code === 'P2034' ||
  (error as AiSqlError | null | undefined)?.code === '23505' ||
  (error as AiSqlError | null | undefined)?.code === '40001' ||
  (error as AiSqlError | null | undefined)?.meta?.code === '23505' ||
  (error as AiSqlError | null | undefined)?.meta?.code === '40001';

/** PostgreSQL 使用数据库唯一约束和 SERIALIZABLE 事务保护并发插入。 */
export function createPostgresAiRepository({ client, ownerId }: PostgresAiRepositoryOptions) {
  if (!client?.$transaction || !ownerId) throw new TypeError('PostgreSQL AI repository needs client and owner');

  async function mutate<Kind extends AiRecordKind>(
    action: 'insert' | 'replace',
    kind: Kind,
    input: AiRecordByKind[Kind],
    expectedHash?: string
  ): Promise<AiRecordByKind[Kind]>;
  async function mutate(action: 'event', kind: null, input: AiEvent): Promise<AiEvent>;
  async function mutate(
    action: 'insert' | 'replace' | 'event',
    kind: AiRecordKind | null,
    input: AiRecord | AiEvent,
    expectedHash?: string
  ): Promise<AiRecord | AiEvent | undefined> {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      try {
        return await client.$transaction(
          async db => {
            const identity = await ensureIdentity(db, ownerId);
            if ((input as AiRecordFields)?.ownerId && (input as AiRecordFields).ownerId !== ownerId)
              throw new Error('AI 记录不属于当前 owner。');
            const state = await loadState(db, identity, ownerId);
            const repository = createJsonAiRepository({
              getState: () => state,
              runTransaction: operation => operation(),
              onChange: () => {}
            });
            if (action === 'insert') {
              const before = state[AI_RECORD_KINDS[kind!].collection].length;
              const result = repository.insert(kind!, input as AiRecord);
              if (state[AI_RECORD_KINDS[kind!].collection].length !== before) await insertRow(db, kind!, result);
              return result;
            }
            if (action === 'replace') {
              const result = repository.replace(kind!, input as AiRecord, expectedHash!);
              await replaceRow(db, kind!, result);
              return result;
            }
            const event = repository.appendEvent(input as AiEvent);
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
    async get<Kind extends AiRecordKind>(kind: Kind, id: string) {
      const { id: idColumn } = assertKind(kind);
      const [row] = await readRows(client, `SELECT r.* ${ownerSelection(kind)} AND r.${idColumn} = $2`, ownerId, id);
      return decodeAiRow(kind, row as RawAiSqlRow | undefined);
    },
    async list<Kind extends AiRecordKind>(kind: Kind, filter: Partial<AiRecordByKind[Kind]> = {}) {
      return (await readRows(client, `SELECT r.* ${ownerSelection(kind)}`, ownerId))
        .map(row => decodeAiRow(kind, row))
        .filter(record =>
          Object.entries(filter).every(
            ([key, value]) => (record as AiRecordFields)[key as keyof AiRecordFields] === value
          )
        );
    },
    insert: <Kind extends AiRecordKind>(kind: Kind, input: AiRecordByKind[Kind]) => mutate('insert', kind, input),
    replace: <Kind extends AiRecordKind>(kind: Kind, input: AiRecordByKind[Kind], expectedHash: string) =>
      mutate('replace', kind, input, expectedHash),
    appendEvent: (input: AiEvent) => mutate('event', null, input),
    async listEvents(jobId: string): Promise<AiReadEvent[]> {
      return (
        await readRows<AiSqlEventRow>(
          client,
          `SELECT e.job_id, e.sequence, e.event_kind, e.safe_payload_json, e.created_at
        FROM ai_job_events e JOIN ai_jobs j ON j.job_id = e.job_id WHERE j.owner_id = $1 AND e.job_id = $2 ORDER BY e.sequence`,
          ownerId,
          jobId
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
