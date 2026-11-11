import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createPostgresTestDatabase } from '../../../scripts/test-support/postgres-test-database.mjs';

const ownerId = 'demo';
const deviceId = 'synthetic-retirement-old';
const successorDeviceId = 'synthetic-retirement-new';
const allowedDevices = `${deviceId},${successorDeviceId}`;
const realPostgres = {
  skip: !process.env.KNOWRA_SYNC_TEST_DATABASE_URL
    ? '未设置 KNOWRA_SYNC_TEST_DATABASE_URL；不连接 PostgreSQL。'
    : process.env.KNOWRA_SYNC_TEST_ALLOW_WRITES !== '1'
      ? '未设置 KNOWRA_SYNC_TEST_ALLOW_WRITES=1；不连接 PostgreSQL。'
      : false,
  timeout: 120000
};
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');

// 仅在显式测试环境执行。helper 校验回环 Knowra 测试库，迁移随机 schema 并负责删除。
// 两个应用实例使用独立连接；所有文件也只落入本测试新建的临时目录。
async function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'knowra-retirement-real-pg-'));
  const apps = [];
  let database;
  const environment = {
    KNOWRA_SYNC_PUSH_ENABLED: 'true',
    KNOWRA_SYNC_ALLOWED_DEVICE_IDS: allowedDevices,
    KNOWRA_SYNC_VERIFY_SCOPED_AFTER: '1'
  };
  const previous = Object.fromEntries(Object.keys(environment).map(key => [key, process.env[key]]));
  t.after(async () => {
    const failures = [];
    for (const app of apps) {
      try {
        await app.close();
      } catch (error) {
        failures.push(error);
      }
    }
    try {
      await database?.close();
    } catch (error) {
      failures.push(error);
    }
    try {
      fs.rmSync(root, { recursive: true, force: true });
    } catch (error) {
      failures.push(error);
    }
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    if (failures.length) throw new AggregateError(failures, '真实 PG 退役测试清理失败');
  });
  // 只修改当前测试进程，不修改配置文件、持久准入规则或数据库连接目标。
  Object.assign(process.env, environment);
  database = await createPostgresTestDatabase();
  assert.match(database.schema, /^knowra_test_[a-f0-9]{32}$/);
  const { createPostgresAppContext } = await import('../src/postgres-app.factory.ts');
  const { syncContract } = await import('../src/modules/sync/protocol-contract.ts');
  const { noteContent, syncKey } = await import('../src/modules/sync/journal.ts');
  const { validateDeviceRetirements } = await import('../src/modules/sync/device-retirement.ts');
  const open = async name => {
    const app = await createPostgresAppContext({
      databaseUrl: database.databaseUrl,
      ownerId,
      storageRootDir: path.join(root, name),
      uploadsDir: path.join(root, name, 'uploads')
    });
    apps.push(app);
    return app;
  };
  const a = await open('writer');
  const b = await open('observer');
  const space = await a.http.knowledge.createDefaultKnowledgeSpace();
  const note = await a.http.knowledge.createNote({
    spaceId: space.id,
    title: '真实 PG 合成退役样本',
    rawMarkdown: '退役前的合成正文'
  });
  const journal = async (app = b) => {
    const row = await app.prisma.syncJournal.findUnique({ where: { ownerId } });
    assert.ok(row, '必须回读真实 SyncJournal JSONB 行');
    const [version] = await app.prisma.$queryRawUnsafe(
      'SELECT xmin::text AS version FROM "SyncJournal" WHERE "ownerId" = $1',
      ownerId
    );
    // xmin 可区分没有写入与把同样的 JSONB 重写一次；不依赖 updatedAt。
    return { payload: row.payload, xmin: version.version };
  };
  const operation = async ({
    protocolVersion = 2,
    id = deviceId,
    operationId = 'synthetic-original',
    sequence = 1
  } = {}) => {
    const { payload } = await journal();
    const current = await a.modules.knowledge.noteService.getNote(note.id);
    const common = {
      ...syncContract(),
      protocolVersion,
      deviceId: id,
      operationId,
      datasetEpoch: payload.epoch
    };
    const baseRevision = payload.revisions[syncKey('notes', note.id)];
    if (protocolVersion === 1)
      return {
        ...common,
        noteId: note.id,
        baseRevision,
        value: { ...noteContent(current), favorite: true }
      };
    return {
      ...common,
      sequence,
      changes: [{ collection: 'notes', id: note.id, baseRevision, value: { ...current, favorite: true } }],
      dependencies: [
        { collection: 'spaces', id: space.id, baseRevision: payload.revisions[syncKey('spaces', space.id)] }
      ]
    };
  };
  const command = op => ({
    ...syncContract(),
    action: 'retire-device',
    acceptJournalUpgrade: true,
    ownerId,
    datasetEpoch: op.datasetEpoch,
    deviceId: op.deviceId,
    successorDeviceId,
    recoveryId: 'synthetic-explicit-recovery',
    requests: [{ operationId: op.operationId, datasetEpoch: op.datasetEpoch, requestHash: hash(op) }]
  });
  const retirementQuery = command => ({
    ...syncContract(),
    deviceId: command.deviceId,
    recoveryId: command.recoveryId
  });
  const persistedNote = () => b.prisma.note.findUnique({ where: { id: note.id } });
  return {
    a,
    b,
    note,
    database,
    journal,
    operation,
    command,
    retirementQuery,
    persistedNote,
    syncContract,
    validateDeviceRetirements
  };
}

function assertBinding(f, journal, command, result) {
  assert.equal(journal.version, 2);
  f.validateDeviceRetirements(journal);
  const record = journal.retiredDevices[command.deviceId];
  assert.deepEqual(record, result.retirement);
  const binding = {
    ownerId: command.ownerId,
    datasetEpoch: command.datasetEpoch,
    deviceId: command.deviceId,
    successorDeviceId: command.successorDeviceId,
    recoveryId: command.recoveryId,
    requests: command.requests
  };
  for (const [key, value] of Object.entries(binding)) assert.deepEqual(record[key], value);
  assert.equal(record.bindingHash, hash(binding));
  assert.ok(Number.isFinite(Date.parse(record.retiredAt)));
}

// 明确的先后顺序与独立连接回读，不把该测试描述成同时在途请求的锁竞争或物理断电演练。
test('真实 PostgreSQL：显式退役、双实例屏障与内容导入回滚保留 v2 和绑定', realPostgres, async t => {
  const f = await fixture(t);
  const backup = await f.a.http.storage.exportKnowledgeBase();
  const original = await f.operation();
  const legacy = await f.operation({ protocolVersion: 1, operationId: 'synthetic-legacy-late' });
  const command = f.command(original);
  const before = await f.journal();
  const originalNote = await f.persistedNote();
  assert.equal(before.payload.version, 1);
  assert.equal((await f.b.http.sync.status()).recovery.journalVersion, 1);
  assert.equal((await f.b.http.sync.deviceRetirement(f.retirementQuery(command))).status, 'missing');
  await assert.rejects(f.a.http.sync.retireDevice({ ...command, action: undefined }), {
    code: 'SYNC_RECOVERY_INVALID'
  });
  await assert.rejects(f.a.http.sync.retireDevice({ ...command, acceptJournalUpgrade: false }), {
    code: 'SYNC_RECOVERY_FORMAT_ACCEPTANCE_REQUIRED'
  });
  await assert.rejects(f.a.http.sync.retireDevice({ ...command, successorDeviceId: 'synthetic-unapproved' }), {
    code: 'SYNC_DEVICE_NOT_ENABLED'
  });
  assert.deepEqual(await f.journal(), before, '被拒绝的动作和只读查询不能升级或重写 journal');
  assert.equal(process.env.KNOWRA_SYNC_ALLOWED_DEVICE_IDS, allowedDevices);

  const result = await f.a.http.sync.retireDevice(command);
  assert.equal(result.status, 'retired');
  assert.equal(result.journalVersion, 2);
  const protectedRow = await f.journal();
  assertBinding(f, protectedRow.payload, command, result);
  assert.equal(protectedRow.payload.epoch, before.payload.epoch);
  assert.equal(protectedRow.payload.head, before.payload.head);
  assert.deepEqual(protectedRow.payload.revisions, before.payload.revisions);
  assert.deepEqual(protectedRow.payload.receipts, before.payload.receipts);
  assert.deepEqual(await f.persistedNote(), originalNote);
  assert.deepEqual((await f.b.http.sync.deviceRetirement(f.retirementQuery(command))).retirement, result.retirement);
  await assert.rejects(f.b.http.sync.retireDevice({ ...command, recoveryId: 'synthetic-other-recovery' }), {
    code: 'SYNC_RECOVERY_MISMATCH'
  });
  await assert.rejects(f.b.http.sync.push(legacy), { code: 'SYNC_DEVICE_RETIRED' });
  await assert.rejects(f.b.http.sync.pushBatch(original), { code: 'SYNC_DEVICE_RETIRED' });
  await assert.rejects(
    f.b.http.sync.pushBatch({ ...original, sequence: 999, operationId: 'synthetic-higher-sequence' }),
    {
      code: 'SYNC_DEVICE_RETIRED'
    }
  );
  assert.deepEqual(await f.journal(), protectedRow);
  assert.deepEqual(await f.persistedNote(), originalNote);

  const successor = await f.operation({ id: successorDeviceId, operationId: 'synthetic-successor' });
  assert.equal((await f.b.http.sync.pushBatch(successor)).status, 'accepted');
  assert.equal((await f.persistedNote()).favorite, true);
  await f.a.http.knowledge.updateNote({ id: f.note.id }, { rawMarkdown: '退役后的合成正文' });
  assert.equal((await f.persistedNote()).rawMarkdown, '退役后的合成正文');
  await assert.rejects(f.b.http.sync.pushBatch(await f.operation({ id: 'synthetic-unapproved' })), {
    code: 'SYNC_DEVICE_NOT_ENABLED'
  });
  const beforeRestore = await f.journal();
  await f.a.http.storage.importKnowledgeBase(backup);
  const restored = await f.journal();
  assertBinding(f, restored.payload, command, result);
  assert.deepEqual(restored.payload.retiredDevices, beforeRestore.payload.retiredDevices);
  assert.notEqual(restored.payload.epoch, beforeRestore.payload.epoch);
  assert.equal((await f.persistedNote()).rawMarkdown, '退役前的合成正文');
  assert.equal((await f.persistedNote()).favorite, false);
  assert.deepEqual((await f.b.http.sync.deviceRetirement(f.retirementQuery(command))).retirement, result.retirement);
  // 使用新 epoch 和当前修订，证明拒绝源于作废事实，而非旧世代或冲突。
  await assert.rejects(f.b.http.sync.push(await f.operation({ protocolVersion: 1 })), { code: 'SYNC_DEVICE_RETIRED' });
  await assert.rejects(f.b.http.sync.pushBatch(await f.operation({ sequence: 1000 })), { code: 'SYNC_DEVICE_RETIRED' });
  await assert.rejects(f.b.http.sync.pushBatch(await f.operation({ id: 'synthetic-unapproved' })), {
    code: 'SYNC_DEVICE_NOT_ENABLED'
  });
  assert.deepEqual(await f.journal(), restored);
  assert.equal(
    (
      await f.b.http.sync.pushBatch(
        await f.operation({ id: successorDeviceId, operationId: 'synthetic-after-restore' })
      )
    ).status,
    'accepted'
  );
  assert.equal(process.env.KNOWRA_SYNC_ALLOWED_DEVICE_IDS, allowedDevices);
});

for (const protocolVersion of [1, 2]) {
  test(`真实 PostgreSQL：v${protocolVersion} 原请求先提交，退役后只读返回原回执`, realPostgres, async t => {
    const f = await fixture(t);
    const original = await f.operation({ protocolVersion });
    const push = app => (protocolVersion === 1 ? app.http.sync.push(original) : app.http.sync.pushBatch(original));
    const accepted = await push(f.a);
    assert.equal(accepted.status, 'accepted');
    assert.equal((await f.persistedNote()).favorite, true);
    const command = f.command(original);
    const result = await f.b.http.sync.retireDevice(command);
    const protectedRow = await f.journal();
    const note = await f.persistedNote();
    assertBinding(f, protectedRow.payload, command, result);
    assert.deepEqual(await push(f.a), accepted);
    const receipt = await f.a.http.sync.operationReceipt({
      ...f.syncContract(),
      deviceId,
      operationId: original.operationId,
      datasetEpoch: original.datasetEpoch,
      requestHash: hash(original)
    });
    assert.equal(receipt.status, 'found');
    assert.deepEqual(receipt.result, accepted);
    assert.deepEqual(await f.journal(), protectedRow, '回执读取和精确重试均不能重写真实 JSONB 行');
    assert.deepEqual(await f.persistedNote(), note);
    const later = await f.operation({ protocolVersion, operationId: 'synthetic-after-retirement', sequence: 999 });
    await assert.rejects(protocolVersion === 1 ? f.a.http.sync.push(later) : f.a.http.sync.pushBatch(later), {
      code: 'SYNC_DEVICE_RETIRED'
    });
    assert.deepEqual(await f.journal(), protectedRow);
    assert.deepEqual(await f.persistedNote(), note);
  });
}

test('真实 PostgreSQL：journal 写入故障使退役与版本升级一同回滚', realPostgres, async t => {
  const f = await fixture(t);
  const command = f.command(await f.operation());
  const before = await f.journal();
  const note = await f.persistedNote();
  // 标识符仅取 helper 生成且已验证的随机 schema，绝不创建 public 或其他 schema 的对象。
  const table = `"${f.database.schema}"."SyncJournal"`;
  const triggerFunction = `"${f.database.schema}"."fail_retirement_journal"`;
  await f.a.prisma.$executeRawUnsafe(`CREATE FUNCTION ${triggerFunction}() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF NEW."ownerId" = 'demo' AND NEW.payload ->> 'version' = '2' THEN
        RAISE EXCEPTION 'synthetic retirement journal failure';
      END IF;
      RETURN NEW;
    END $$`);
  try {
    await f.a.prisma.$executeRawUnsafe(`CREATE TRIGGER retirement_journal_failure BEFORE INSERT OR UPDATE ON ${table}
      FOR EACH ROW EXECUTE FUNCTION ${triggerFunction}()`);
    try {
      await assert.rejects(f.a.http.sync.retireDevice(command), /synthetic retirement journal failure/);
      assert.deepEqual(await f.journal(), before, '失败事务不能留下作废事实、v2 或新 JSONB 行版本');
      assert.deepEqual(await f.persistedNote(), note);
      assert.equal((await f.b.http.sync.deviceRetirement(f.retirementQuery(command))).status, 'missing');
      assert.equal((await f.b.http.sync.status()).recovery.journalVersion, 1);
      assert.deepEqual(await f.journal(), before);
    } finally {
      await f.a.prisma.$executeRawUnsafe(`DROP TRIGGER retirement_journal_failure ON ${table}`);
    }
  } finally {
    await f.a.prisma.$executeRawUnsafe(`DROP FUNCTION ${triggerFunction}()`);
  }
  const result = await f.b.http.sync.retireDevice(command);
  assertBinding(f, (await f.journal()).payload, command, result);
  await assert.rejects(f.a.http.sync.pushBatch(await f.operation({ sequence: 999 })), { code: 'SYNC_DEVICE_RETIRED' });
});
