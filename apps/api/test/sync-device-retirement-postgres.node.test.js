import assert from 'node:assert/strict';
import test from 'node:test';
import { applyJsonMigration, buildJsonMigrationPlan } from '../src/infrastructure/migration/json-to-postgres.ts';
import { createEmptyLocalState } from '../src/infrastructure/local-data-schema.js';
import { createPostgresSyncRuntime } from '../src/modules/sync/postgres-provider.ts';
import { createJournal, requestHash } from '../src/modules/sync/journal.ts';
import { syncContract } from '../src/modules/sync/protocol-contract.ts';

const ownerId = 'synthetic-owner';
const deviceId = 'synthetic-old-device';
const successorDeviceId = 'synthetic-new-device';
const models = [
  'user',
  'knowledgeSpace',
  'folder',
  'tagGroup',
  'tag',
  'note',
  'noteTag',
  'pdfAnnotation',
  'attachment',
  'contentAnnotation',
  'annotationExclusion',
  'annotationRevision',
  'analysisScopeSnapshot',
  'noteVersion',
  'knowledgeItem',
  'knowledgeEvidence',
  'knowledgeArtifactProvenance',
  'learningObjective',
  'examProfile',
  'examFocus',
  'question',
  'questionObjective',
  'questionSource',
  'personalTodo',
  'syncJournal'
];

// 仅验证真实应用代码对 Prisma 的调用契约，不导入/实例化 PrismaClient，不连接数据库。
// 串行队列和事务副本是测试替身的假设，不是真实 PG 锁、隔离或故障持久性证据。
function postgresContractDouble(journals) {
  let committed = Object.fromEntries(models.map(model => [model, []]));
  committed.syncJournal = structuredClone(journals);
  const events = [];
  let tail = Promise.resolve();
  let nextTransactionId = 0;
  let failJournalWrite = false;

  function connection(rows, transaction) {
    function record(method, data = {}) {
      if (transaction) assert.equal(transaction.locked, true, `${method} 必须在取得事务锁之后`);
      events.push({ transactionId: transaction?.id ?? null, method, ...structuredClone(data) });
    }
    function write(method, data) {
      assert.ok(transaction, `${method} 不能在事务外执行`);
      record(method, data);
    }
    function persistJournal(data, method) {
      write(method, { data, visibleJournals: committed.syncJournal });
      const existing = rows().syncJournal.findIndex(row => row.ownerId === data.ownerId);
      if (existing < 0) rows().syncJournal.push(structuredClone(data));
      else rows().syncJournal[existing] = structuredClone(data);
      if (failJournalWrite) {
        failJournalWrite = false;
        throw new Error('合成 journal 持久化失败');
      }
      return structuredClone(data);
    }
    const db = Object.fromEntries(
      models.map(model => [
        model,
        {
          async findMany(options = {}) {
            record(`${model}.findMany`);
            const result = rows()[model];
            return structuredClone(options.select?.id ? result.map(({ id }) => ({ id })) : result);
          },
          async count() {
            record(`${model}.count`);
            return rows()[model].length;
          },
          async deleteMany() {
            write(`${model}.deleteMany`);
            const count = rows()[model].length;
            rows()[model] = [];
            return { count };
          },
          async createMany({ data }) {
            write(`${model}.createMany`, { data });
            rows()[model].push(...structuredClone(data));
            return { count: data.length };
          }
        }
      ])
    );
    db.syncJournal.findUnique = async ({ where }) => {
      const row = rows().syncJournal.find(row => row.ownerId === where.ownerId) ?? null;
      record('syncJournal.findUnique', { ownerId: where.ownerId, version: row?.payload.version });
      return structuredClone(row);
    };
    db.syncJournal.create = async ({ data }) => persistJournal(data, 'syncJournal.create');
    db.$queryRawUnsafe = async (sql, ...parameters) => {
      assert.ok(transaction, '事务锁不能在事务外取得');
      assert.equal(transaction.locked, false, '每个外层事务先取得一次锁');
      if (parameters.length) {
        assert.equal(sql, 'SELECT pg_advisory_xact_lock($1::integer, $2::integer)::text AS lock_acquired');
        assert.deepEqual(parameters, [1266775634, 32]);
      } else {
        assert.equal(sql, 'SELECT pg_advisory_xact_lock(1266775634, 32)::text');
      }
      transaction.locked = true;
      record('lock', { sql, parameters });
      return [];
    };
    db.$executeRawUnsafe = async (sql, journalOwner, payload) => {
      assert.match(
        sql,
        /^INSERT INTO "SyncJournal" \("ownerId", payload\) VALUES \(\$1, \$2::jsonb\)\s+ON CONFLICT \("ownerId"\) DO UPDATE SET payload = EXCLUDED\.payload$/
      );
      persistJournal({ ownerId: journalOwner, payload: JSON.parse(payload) }, 'syncJournal.sqlUpsert');
      return 1;
    };
    return db;
  }

  const client = connection(() => committed, null);
  client.$transaction = (operation, options) => {
    const id = ++nextTransactionId;
    const pending = tail.then(async () => {
      const staged = structuredClone(committed);
      const transaction = { id, locked: false };
      events.push({ transactionId: id, method: 'begin', options });
      try {
        const result = await operation(connection(() => staged, transaction));
        assert.equal(transaction.locked, true);
        committed = staged;
        events.push({ transactionId: id, method: 'commit' });
        return result;
      } catch (error) {
        events.push({ transactionId: id, method: 'rollback' });
        throw error;
      }
    });
    tail = pending.catch(() => {});
    return pending;
  };
  return {
    client,
    events,
    rows: () => structuredClone(committed),
    failNextJournalWrite: () => {
      failJournalWrite = true;
    }
  };
}

function fixture(t, journalOwners = [ownerId]) {
  for (const [key, value] of Object.entries({
    KNOWRA_SYNC_PUSH_ENABLED: 'true',
    KNOWRA_SYNC_ALLOWED_DEVICE_IDS: `${deviceId},${successorDeviceId}`
  })) {
    const previous = process.env[key];
    process.env[key] = value;
    t.after(() => {
      if (previous === undefined) delete process.env[key];
      else process.env[key] = previous;
    });
  }
  const db = postgresContractDouble(journalOwners.map(id => ({ ownerId: id, payload: createJournal({}) })));
  const service = (id = ownerId) =>
    createPostgresSyncRuntime(db.client, id).service(
      new Proxy({}, { get: () => () => assert.fail('退役或被拒绝的旧请求不能调用笔记写入服务') })
    );
  const journal = (id = ownerId) => db.rows().syncJournal.find(row => row.ownerId === id).payload;
  return { ...db, service, journal };
}

function batch(epoch) {
  return {
    ...syncContract(),
    protocolVersion: 2,
    deviceId,
    sequence: 1,
    operationId: 'synthetic-original-operation',
    datasetEpoch: epoch,
    changes: [{ collection: 'notes', id: 'synthetic-note', baseRevision: null, value: null }],
    dependencies: []
  };
}

function legacy(epoch) {
  return {
    ...syncContract(),
    protocolVersion: 1,
    deviceId,
    operationId: 'synthetic-legacy-operation',
    datasetEpoch: epoch,
    noteId: 'synthetic-note',
    baseRevision: null,
    value: { title: '合成笔记', rawMarkdown: '合成内容', deleted: false, tagIds: [] }
  };
}

function retirementCommand(epoch, id = ownerId) {
  const operation = batch(epoch);
  return {
    ...syncContract(),
    action: 'retire-device',
    acceptJournalUpgrade: true,
    ownerId: id,
    datasetEpoch: epoch,
    deviceId,
    successorDeviceId,
    recoveryId: 'synthetic-recovery',
    requests: [{ operationId: operation.operationId, datasetEpoch: epoch, requestHash: requestHash(operation) }]
  };
}

function migrationPlan(title) {
  const prepared = buildJsonMigrationPlan({
    ownerId,
    input: {
      spaces: [{ id: 'synthetic-space', userId: ownerId, name: '合成资料库' }],
      folders: [],
      tags: [],
      notes: [{ id: 'synthetic-note', spaceId: 'synthetic-space', title, rawMarkdown: title, tagIds: [] }],
      attachments: [],
      contentAnnotations: []
    }
  });
  assert.equal(prepared.canApply, true, JSON.stringify(prepared.report.errors));
  return prepared;
}

const restore = (db, prepared) =>
  applyJsonMigration({ client: db.client, ...prepared, requireEmptyTarget: false, replaceExisting: true });

function assertLockFirst(events, isolationLevel) {
  const begin = events.find(event => event.method === 'begin');
  assert.ok(begin);
  assert.equal(begin.options.isolationLevel, isolationLevel);
  const transactionEvents = events.filter(event => event.transactionId === begin.transactionId);
  assert.equal(transactionEvents[1].method, 'lock');
  return transactionEvents;
}

test('PG 契约替身：退役先取得既有事务锁，记录与 v2 同次提交，重建服务仍拒绝旧 v1/v2', async t => {
  const db = fixture(t);
  const before = db.rows();
  const command = retirementCommand(db.journal().epoch);
  const result = await db.service().retireDevice(command);
  const transactionEvents = assertLockFirst(db.events, 'ReadCommitted');
  assert.equal(transactionEvents.at(-1).method, 'commit');
  const writes = transactionEvents.filter(event => event.method === 'syncJournal.sqlUpsert');
  assert.equal(writes.length, 1);
  assert.equal(writes[0].data.ownerId, ownerId);
  assert.equal(writes[0].data.payload.version, 2);
  assert.deepEqual(writes[0].data.payload.retiredDevices[deviceId], result.retirement);
  assert.deepEqual(writes[0].visibleJournals, before.syncJournal);
  assert.deepEqual(db.journal(), writes[0].data.payload);
  assert.deepEqual(db.rows(), { ...before, syncJournal: [writes[0].data] });
  assert.equal(result.status, 'retired');
  assert.equal(result.journalVersion, 2);
  assert.equal(db.journal().epoch, command.datasetEpoch);
  assert.deepEqual(db.journal().revisions, before.syncJournal[0].payload.revisions);

  const reopened = db.service();
  const protectedRows = db.rows();
  await assert.rejects(reopened.push(legacy(command.datasetEpoch)), { code: 'SYNC_DEVICE_RETIRED' });
  await assert.rejects(reopened.pushBatch(batch(command.datasetEpoch)), { code: 'SYNC_DEVICE_RETIRED' });
  await assert.rejects(
    reopened.pushBatch({ ...batch(command.datasetEpoch), sequence: 999, operationId: 'synthetic-later-operation' }),
    { code: 'SYNC_DEVICE_RETIRED' }
  );
  assert.deepEqual(db.rows(), protectedRows);
  assert.equal(db.events.filter(event => event.method === 'syncJournal.sqlUpsert').length, 1);
});

test('PG 契约替身：v2 已读取旧日志但晚入事务时，仍在同一锁内看到退役并拒绝', async t => {
  const db = fixture(t);
  const service = db.service();
  const epoch = db.journal().epoch;
  const retirement = service.retireDevice(retirementCommand(epoch));
  const latePush = service.pushBatch(batch(epoch));
  await Promise.all([retirement, assert.rejects(latePush, { code: 'SYNC_DEVICE_RETIRED' })]);
  const preRead = db.events.find(event => event.method === 'syncJournal.findUnique' && event.transactionId === null);
  assert.equal(preRead.version, 1);
  const commitIndex = db.events.findIndex(event => event.method === 'commit');
  assert.ok(db.events.indexOf(preRead) < commitIndex);
  const lateTransaction = assertLockFirst(db.events.slice(commitIndex + 1), 'ReadCommitted');
  assert.ok(lateTransaction.some(event => event.method === 'syncJournal.findUnique' && event.version === 2));
  assert.equal(lateTransaction.at(-1).method, 'rollback');
  assert.equal(db.events.filter(event => event.method === 'syncJournal.sqlUpsert').length, 1);
  assert.equal(db.rows().note.length, 0);
});

test('PG 契约替身：退役 journal 写入失败整体回滚，重试才同时提交记录与 v2', async t => {
  const db = fixture(t);
  const before = db.rows();
  const command = retirementCommand(db.journal().epoch);
  db.failNextJournalWrite();
  await assert.rejects(db.service().retireDevice(command), /合成 journal 持久化失败/);
  assert.deepEqual(db.rows(), before);
  assert.equal(db.journal().version, 1);
  assert.equal(db.journal().retiredDevices, undefined);
  const failed = assertLockFirst(db.events, 'ReadCommitted');
  assert.equal(failed.at(-1).method, 'rollback');
  assert.equal(failed.find(event => event.method === 'syncJournal.sqlUpsert').data.payload.version, 2);
  const result = await db.service().retireDevice(command);
  assert.equal(db.journal().version, 2);
  assert.deepEqual(db.journal().retiredDevices[deviceId], result.retirement);
});

test('PG 契约替身：业务内容回滚保留目标退役记录与 v2，换 epoch 后旧编号仍被拒绝', async t => {
  const db = fixture(t);
  await restore(db, migrationPlan('合成当前正文'));
  await db.service().retireDevice(retirementCommand(db.journal().epoch));
  const protectedJournal = db.journal();
  db.events.length = 0;
  const report = await restore(db, migrationPlan('合成旧备份正文'));
  assert.equal(report.status, 'applied');
  assert.equal(db.rows().note[0].title, '合成旧备份正文');
  assert.equal(db.rows().note[0].rawMarkdown, '合成旧备份正文');
  assert.equal(db.journal().version, 2);
  assert.notEqual(db.journal().epoch, protectedJournal.epoch);
  assert.deepEqual(db.journal().retiredDevices, protectedJournal.retiredDevices);
  const transactionEvents = assertLockFirst(db.events, 'Serializable');
  assert.equal(transactionEvents.at(-1).method, 'commit');
  const journalWrite = transactionEvents.find(event => event.method === 'syncJournal.create');
  assert.deepEqual(journalWrite.visibleJournals, [{ ownerId, payload: protectedJournal }]);
  assert.deepEqual(journalWrite.data.payload, db.journal());
  const protectedRows = db.rows();
  await assert.rejects(db.service().push(legacy(db.journal().epoch)), { code: 'SYNC_DEVICE_RETIRED' });
  await assert.rejects(db.service().pushBatch(batch(db.journal().epoch)), { code: 'SYNC_DEVICE_RETIRED' });
  await assert.rejects(db.service().pushBatch(batch(protectedJournal.epoch)), { code: 'DATASET_CHANGED' });
  assert.deepEqual(db.rows(), protectedRows);
});

test('PG 契约替身：导入在删除前拒绝其他 owner 的受保护 journal，不改动任何目标行', async t => {
  const foreignOwner = 'synthetic-other-owner';
  const db = fixture(t, [ownerId, foreignOwner]);
  await db.service(foreignOwner).retireDevice(retirementCommand(db.journal(foreignOwner).epoch, foreignOwner));
  const before = db.rows();
  const prepared = migrationPlan('不应导入的合成内容');
  const beforeReport = structuredClone(prepared.report);
  db.events.length = 0;
  await assert.rejects(restore(db, prepared), { code: 'SYNC_PROTECTED_OWNER_MISMATCH' });
  assert.deepEqual(db.rows(), before);
  assert.deepEqual(prepared.report, beforeReport);
  assert.equal(db.journal(foreignOwner).version, 2);
  const transactionEvents = assertLockFirst(db.events, 'Serializable');
  assert.equal(transactionEvents.at(-1).method, 'rollback');
  assert.equal(
    transactionEvents.some(event => /\.(deleteMany|createMany|create|sqlUpsert)$/.test(event.method)),
    false
  );
});

test('PG 契约替身：省略 owner 的合法空 plan 仍保留默认 demo 的 v2 与退役账本', async t => {
  const db = fixture(t, ['demo']);
  await db.service('demo').retireDevice(retirementCommand(db.journal('demo').epoch, 'demo'));
  const protectedJournal = db.journal('demo');
  const prepared = buildJsonMigrationPlan({ input: createEmptyLocalState() });
  assert.equal(prepared.canApply, true, JSON.stringify(prepared.report.errors));
  assert.deepEqual(prepared.plan.users, []);
  db.events.length = 0;
  const report = await restore(db, prepared);
  assert.equal(report.status, 'applied');
  assert.equal(db.rows().syncJournal.length, 1);
  assert.equal(db.rows().syncJournal[0].ownerId, 'demo');
  assert.equal(db.journal('demo').version, 2);
  assert.notEqual(db.journal('demo').epoch, protectedJournal.epoch);
  assert.deepEqual(db.journal('demo').retiredDevices, protectedJournal.retiredDevices);
  const transactionEvents = assertLockFirst(db.events, 'Serializable');
  assert.equal(transactionEvents.at(-1).method, 'commit');
  await assert.rejects(db.service('demo').pushBatch(batch(db.journal('demo').epoch)), {
    code: 'SYNC_DEVICE_RETIRED'
  });
});

test('PG 契约替身：导入替换正文后 journal 写入失败，正文、epoch 与退役账本一起回滚', async t => {
  const db = fixture(t);
  await restore(db, migrationPlan('合成当前正文'));
  await db.service().retireDevice(retirementCommand(db.journal().epoch));
  const before = db.rows();
  const prepared = migrationPlan('合成旧备份正文');
  const beforeReport = structuredClone(prepared.report);
  db.events.length = 0;
  db.failNextJournalWrite();
  await assert.rejects(restore(db, prepared), /合成 journal 持久化失败/);
  assert.deepEqual(db.rows(), before);
  assert.deepEqual(prepared.report, beforeReport);
  const transactionEvents = assertLockFirst(db.events, 'Serializable');
  assert.equal(transactionEvents.at(-1).method, 'rollback');
  const noteWrite = transactionEvents.find(event => event.method === 'note.createMany');
  const journalWrite = transactionEvents.find(event => event.method === 'syncJournal.create');
  assert.equal(noteWrite.data[0].rawMarkdown, '合成旧备份正文');
  assert.ok(transactionEvents.indexOf(noteWrite) < transactionEvents.indexOf(journalWrite));
  assert.equal(journalWrite.data.payload.version, 2);
  assert.notEqual(journalWrite.data.payload.epoch, db.journal().epoch);
  assert.deepEqual(journalWrite.data.payload.retiredDevices, db.journal().retiredDevices);
});
