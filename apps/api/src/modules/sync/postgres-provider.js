import { assertNoKnowledgeArtifactProvenanceDowngrade } from '../knowledge/domain/knowledge-artifact-provenance-state.js';
import {
  planHistoryRetention,
  applyHistoryRetentionPlan,
  changedHistoryNoteIds,
  HISTORY_RETENTION_COLLECTIONS
} from '../knowledge/domain/history-retention.js';
import { readPostgresHistoryRetentionReferences } from '../../infrastructure/history-retention-references.js';
import { assertSnapshotBinding, snapshotBinding } from './protocol-contract.ts';
import { createBatchSyncService } from './batch-service.js';
import { applyPostgresState } from './postgres-batch.js';
import { AsyncLocalStorage } from 'node:async_hooks';
import { PERSISTENCE_TRANSACTION_ACTIVE } from '../../infrastructure/transaction-context.ts';
import * as maps from '../knowledge/infrastructure/postgres/mappers.js';
import { appendChanges, createJournal, loadJournal, syncError } from './journal.ts';
import { createSyncService } from './service.js';
import { applyNoteOperation } from './local-provider.js';

const collections = {
  spaces: ['knowledgeSpace', 'mapSpace'],
  folders: ['folder', 'mapFolder'],
  tags: ['tag', 'mapTag'],
  tagGroups: ['tagGroup', 'mapTagGroup'],
  notes: ['note', 'mapNote'],
  noteVersions: ['noteVersion', 'mapNoteVersion'],
  attachments: ['attachment', 'mapAttachment'],
  contentAnnotations: ['contentAnnotation', 'mapAnnotation'],
  knowledgeItems: ['knowledgeItem', 'mapKnowledgeItem'],
  knowledgeEvidence: ['knowledgeEvidence', 'mapKnowledgeEvidence'],
  learningObjectives: ['learningObjective', 'mapLearningObjective'],
  examProfiles: ['examProfile', 'mapExamProfile'],
  examFocuses: ['examFocus', 'mapExamFocus'],
  questions: ['question', 'mapQuestion'],
  questionObjectives: ['questionObjective', 'mapQuestionObjective'],
  questionSources: ['questionSource', 'mapQuestionSource'],
  annotationExclusions: ['annotationExclusion'],
  annotationRevisions: ['annotationRevision'],
  analysisScopeSnapshots: ['analysisScopeSnapshot'],
  knowledgeArtifactProvenance: ['knowledgeArtifactProvenance', 'mapKnowledgeArtifactProvenance']
};

async function readCollection(db, collection, ids) {
  const [model, mapper] = collections[collection];
  const rows = await db[model].findMany({
    ...(ids ? { where: { id: { in: ids } } } : {}),
    orderBy: { id: 'asc' },
    ...(model === 'note' ? { include: { noteTags: { orderBy: { tagId: 'asc' } } } } : {})
  });
  return rows.map(row => (mapper ? maps[mapper](row) : JSON.parse(JSON.stringify(row))));
}

async function snapshot(db) {
  const result = {};
  for (const collection of Object.keys(collections)) result[collection] = await readCollection(db, collection);
  return result;
}

// 批量写入只触及已知 ID：未触及的集合与行沿用事务开头的状态，仅按 ID 重读被写入的行。
async function scopedSnapshot(db, before, touched) {
  const result = {};
  for (const collection of Object.keys(collections)) {
    const ids = touched[collection];
    if (!ids?.size) {
      result[collection] = [...before[collection]];
      continue;
    }
    const fresh = new Map((await readCollection(db, collection, [...ids])).map(item => [item.id, item]));
    const kept = before[collection].flatMap(item =>
      !ids.has(item.id) ? [item] : fresh.has(item.id) ? [fresh.get(item.id)] : []
    );
    const known = new Set(before[collection].map(item => item.id));
    result[collection] = [...kept, ...[...fresh.values()].filter(item => !known.has(item.id))];
  }
  return result;
}

// 校验开关：同时全表读取并与按 ID 重建的后像逐项比对，供测试证明两者等价。
async function assertScopedMatchesFull(db, scoped) {
  const full = await snapshot(db);
  for (const collection of Object.keys(collections)) {
    const left = new Map(scoped[collection].map(item => [item.id, JSON.stringify(item)]));
    const right = new Map(full[collection].map(item => [item.id, JSON.stringify(item)]));
    if (left.size !== right.size || [...right].some(([id, value]) => left.get(id) !== value)) {
      throw new Error(`同步后像按 ID 重建与全表读取不一致：${collection}`);
    }
  }
}

// 维护世代重建只需主体身份；不读取正文/文件，也不改变业务表。
export async function loadPostgresSyncIdentityState(db) {
  return Object.fromEntries(
    await Promise.all(
      Object.entries(collections).map(async ([collection, [model]]) => [
        collection,
        await db[model].findMany({ select: { id: true } })
      ])
    )
  );
}

// 所有 repository 共用当前事务连接；业务、派生来源和同步日志一次提交。
export function createPostgresSyncRuntime(client, ownerId) {
  const scope = new AsyncLocalStorage();
  /** @type {Set<PropertyKey>} */
  const modelNames = new Set([...Object.values(collections).map(([model]) => model), 'noteTag', 'user']);
  /** @type {Set<PropertyKey>} */
  const mutations = new Set(['create', 'createMany', 'update', 'updateMany', 'upsert', 'delete', 'deleteMany']);
  async function historyReferences(tx) {
    try {
      return await readPostgresHistoryRetentionReferences(tx, ownerId);
    } catch {
      return null;
    } // 私有扩展异常时停止淘汰，核心保存仍可继续。
  }
  async function transaction(operation) {
    if (scope.getStore()) return operation(proxy);
    return client.$transaction(
      async tx => {
        await tx.$queryRawUnsafe('SELECT pg_advisory_xact_lock(1266775634, 32)::text');
        const before = await snapshot(tx);
        const row = await tx.syncJournal.findUnique({ where: { ownerId } });
        // version 随每次写入递增；after 仅在其后无写入时可复用，避免同一事务重复全表读取。
        const context = { tx, before, journal: loadJournal(row?.payload, before), version: 0, after: null };
        return scope.run(context, async () => {
          const result = await operation(proxy);
          // 事务内没有任何写入时后像即前像；批量写入后的后像已由 preview 按 ID 重建。
          let after =
            context.version === 0
              ? before
              : context.after?.version === context.version
                ? context.after.state
                : await snapshot(tx);
          const noteIds = changedHistoryNoteIds(before, after);
          if (!context.touched && noteIds.size) {
            const references = await historyReferences(tx);
            if (references !== null) {
              const retained = applyHistoryRetentionPlan(
                after,
                planHistoryRetention(after, { noteIds, externalReferences: references })
              );
              if (
                HISTORY_RETENTION_COLLECTIONS.some(name => (retained[name]?.length ?? 0) !== (after[name]?.length ?? 0))
              ) {
                await applyPostgresState(tx, after, retained);
                after = retained;
              }
            }
          }
          assertNoKnowledgeArtifactProvenanceDowngrade(before, after);
          // 整库导入删除日志行；用新世代重新建立基线。
          const exists = await tx.syncJournal.findUnique({ where: { ownerId } });
          const journal =
            exists?.payload?.epoch && exists.payload.epoch !== context.journal.epoch
              ? loadJournal(exists.payload, after)
              : row && !exists
                ? createJournal(after)
                : appendChanges(context.journal, before, after);
          // 日志载荷可达数十 MB：Prisma 的 Json 参数序列化比文本 ::jsonb 慢一个数量级，故用原生 SQL 整体替换。
          await tx.$executeRawUnsafe(
            `INSERT INTO "SyncJournal" ("ownerId", payload) VALUES ($1, $2::jsonb)
          ON CONFLICT ("ownerId") DO UPDATE SET payload = EXCLUDED.payload`,
            ownerId,
            JSON.stringify(journal)
          );
          return result;
        });
      },
      { isolationLevel: 'ReadCommitted', maxWait: 10000, timeout: 60000 }
    );
  }
  const delegates = new Map();
  const proxy = new Proxy(client, {
    get(_target, key) {
      if (key === PERSISTENCE_TRANSACTION_ACTIVE) return Boolean(scope.getStore());
      if (key === '$transaction')
        return operation => {
          if (typeof operation !== 'function') throw new TypeError('同步持久化需要交互式事务。');
          return transaction(operation);
        };
      if (modelNames.has(key)) {
        if (!delegates.has(key))
          delegates.set(
            key,
            new Proxy(
              {},
              {
                get:
                  (_model, method) =>
                  (...args) => {
                    const invoke = () => {
                      const context = scope.getStore();
                      if (context && mutations.has(method)) context.version++;
                      return (context?.tx ?? client)[key][method](...args);
                    };
                    return mutations.has(method) && !scope.getStore() ? transaction(invoke) : invoke();
                  }
              }
            )
          );
        return delegates.get(key);
      }
      const context = scope.getStore();
      const target = context?.tx ?? client;
      const value = target[key];
      if (typeof value !== 'function') return value;
      // 原生 SQL 可能写入任意表：保守视为有写入，后像回到全表读取。
      if (context && typeof key === 'string' && /^\$(execute|query)Raw/.test(key))
        return (...args) => {
          context.version++;
          return value.apply(target, args);
        };
      return value.bind(target);
    }
  });
  return {
    client: proxy,
    service(noteService, transfer) {
      const access = callback => transaction(async () => callback(scope.getStore().before, scope.getStore().journal));
      const read = async callback => {
        const row = await client.syncJournal.findUnique({ where: { ownerId } });
        return row ? callback(null, loadJournal(row.payload, {})) : access(callback);
      };
      const provider = {
        historyReferences: () => historyReferences(scope.getStore().tx),
        read,
        mutate: access,
        snapshotPage: async ({ snapshotId, start, size, contract, ownerId: requestedOwner }) => {
          const [row] = await client.$queryRawUnsafe(
            `SELECT
            payload ->> 'epoch' AS epoch,
            (payload -> 'snapshots' -> $2) - 'entries' AS binding,
            payload -> 'snapshots' -> $2 ->> 'cursor' AS cursor,
            payload -> 'snapshots' -> $2 ->> 'expiresAt' AS expires,
            jsonb_array_length(payload -> 'snapshots' -> $2 -> 'entries') AS count,
            jsonb_path_query_array(payload -> 'snapshots' -> $2, $3::jsonpath) AS entries
            FROM "SyncJournal" WHERE "ownerId" = $1`,
            ownerId,
            String(snapshotId),
            `$.entries[${start} to ${start + size - 1}]`
          );
          if (!row?.expires || Number(row.expires) < Date.now())
            throw syncError('CURSOR_EXPIRED', '初始化快照已过期。');
          const binding = assertSnapshotBinding(row.binding, contract, requestedOwner, row.epoch);
          if (binding.snapshotId !== snapshotId || binding.count !== row.count)
            throw syncError('SYNC_SNAPSHOT_CONTRACT_MISMATCH', '初始化快照绑定不一致。');
          if (start > row.count) throw syncError('CURSOR_INVALID', '快照分页无效。', 422);
          return {
            ...snapshotBinding(binding),
            entries: row.entries,
            nextOffset: start + size < row.count ? start + size : null
          };
        },
        preview: async () => {
          const context = scope.getStore();
          let state = context.after?.version === context.version ? context.after.state : null;
          if (!state && context.touched && context.touchedVersion === context.version) {
            state = await scopedSnapshot(context.tx, context.before, context.touched);
            if (process.env.KNOWRA_SYNC_VERIFY_SCOPED_AFTER === '1') await assertScopedMatchesFull(context.tx, state);
          }
          state ??= await snapshot(context.tx);
          context.after = { version: context.version, state };
          return { state, journal: appendChanges(structuredClone(context.journal), context.before, state) };
        },
        applyNote: (operation, current) => applyNoteOperation(noteService, operation, current),
        // 批量写入前事务内尚无其他写入，事务开头读取的状态即当前状态。
        applyState: async next => {
          const context = scope.getStore();
          if (context.version) throw new Error('同步批量写入必须发生在事务内其他写入之前。');
          context.version++;
          context.touched = await applyPostgresState(context.tx, context.before, next);
          context.touchedVersion = context.version;
        }
      };
      return { ...createSyncService(provider, ownerId), ...createBatchSyncService(provider, ownerId, transfer) };
    }
  };
}
