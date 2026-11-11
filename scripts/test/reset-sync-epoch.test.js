import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { resetJournalKeepingTombstones, createJournal, syncKey } from '../../apps/api/src/modules/sync/journal.ts';
import { syncContract } from '../../apps/api/src/modules/sync/protocol-contract.ts';
import { createEmptyLocalState } from '../../apps/api/src/infrastructure/local-data-schema.ts';
import { createPostgresTestDatabase } from '../test-support/postgres-test-database.mjs';
import { createPostgresAppContext } from '../../apps/api/src/postgres-app.factory.js';
import { createFileDataStore } from '../../apps/api/src/infrastructure/file-data-store.ts';
import { createAppContext } from '../../apps/api/src/app.factory.ts';

test('手动恢复 JSON 后重建世代，保留业务数据并备份原日志', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'knowra-reset-sync-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const filePath = path.join(root, 'cloud.json');
  const store = createFileDataStore(filePath);
  const context = createAppContext({ dataStore: store, storageRootDir: root, uploadsDir: path.join(root, 'uploads') });
  const space = context.modules.knowledge.knowledgeSpaceService.createDefaultKnowledgeSpace({ userId: 'demo' });
  context.modules.knowledge.noteService.createNote({ title: '恢复保留', rawMarkdown: '原始正文', spaceId: space.id });
  const before = JSON.stringify(store.state);
  const epoch = store.getSyncJournal().epoch;
  const output = execFileSync(
    process.execPath,
    [
      fileURLToPath(new URL('../reset-sync-epoch.mjs', import.meta.url)),
      '--driver',
      'local-json',
      '--data-file',
      filePath
    ],
    { encoding: 'utf8' }
  );
  const result = JSON.parse(output);
  const restored = createFileDataStore(filePath);
  assert.notEqual(result.datasetEpoch, epoch);
  assert.equal(restored.getSyncJournal().epoch, result.datasetEpoch);
  assert.equal(JSON.stringify(restored.state), before);
  assert.equal(JSON.parse(fs.readFileSync(result.backup, 'utf8')).sync.epoch, epoch);
});

const script = fileURLToPath(new URL('../reset-sync-epoch.mjs', import.meta.url));
const candidate = { id: 'deleted-concept', title: '合成知识', canonicalStatement: '合成定义', sourceMode: 'manual' };
function batch(epoch, item) {
  return {
    ...syncContract(),
    protocolVersion: 2,
    deviceId: 'old-device',
    operationId: 'late-create',
    datasetEpoch: epoch,
    sequence: 1,
    changes: [{ collection: 'knowledgeItems', id: item.id, baseRevision: null, value: item }],
    dependencies: []
  };
}

test('JSON世代重建保留已知墓碑：新世代旧设备/迟到创建/旧备份不能复活ID', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'knowra-reset-facts-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, 'cloud.json'),
    store = createFileDataStore(file);
  const open = dataStore =>
    createAppContext({ dataStore, storageRootDir: root, uploadsDir: path.join(root, 'uploads') });
  const app = open(store),
    k = app.modules.knowledge;
  k.knowledgeSpaceService.createDefaultKnowledgeSpace({ userId: 'demo' });
  const { item } = k.knowledgeItemService.createCandidate(candidate);
  const snapshot = app.http.storage.exportKnowledgeBase();
  const trashed = k.knowledgeItemService.trash(item.id);
  k.permanentlyDeleteKnowledgeItem(item.id, { expectedUpdatedAt: trashed.updatedAt });
  const previous = structuredClone(store.getSyncJournal());
  const result = JSON.parse(
    execFileSync(process.execPath, [script, '--driver', 'local-json', '--data-file', file], { encoding: 'utf8' })
  );
  const restarted = createFileDataStore(file),
    current = restarted.getSyncJournal(),
    restored = open(restarted);
  assert.notEqual(current.epoch, previous.epoch);
  assert.equal(result.retainedTombstones, Object.keys(previous.tombstones).length);
  assert.deepEqual(current.tombstones, previous.tombstones);
  assert.deepEqual(JSON.parse(fs.readFileSync(result.backup, 'utf8')).sync.tombstones, previous.tombstones);
  assert.deepEqual(current.changes, []);
  assert.deepEqual(current.receipts, {});
  assert.deepEqual(current.snapshots, {});
  assert.deepEqual(current.deviceSequences, {});
  assert.equal(current.head, 0);
  assert.throws(() => restored.modules.knowledge.knowledgeItemService.createCandidate(candidate), {
    code: 'KNOWLEDGE_ITEM_ID_DELETED'
  });
  await assert.rejects(restored.http.sync.pushBatch(batch(previous.epoch, item)), { code: 'DATASET_CHANGED' });
  await assert.rejects(restored.http.sync.pushBatch(batch(current.epoch, item)), { code: 'ENTITY_DELETED' });
  assert.throws(() => restored.http.storage.importKnowledgeBase(snapshot), { code: 'IMPORT_DELETED_ID' });
  assert.equal(restarted.state.knowledgeItems.length, 0);
});

test('世代重建补出旧日志删除事实，并拒绝墓碑与恢复主体冲突/损坏', () => {
  const state = createEmptyLocalState(),
    journal = createJournal(state),
    key = syncKey('tags', 'deleted-tag');
  journal.revisions[key] = 7;
  delete journal.tombstones;
  journal.deviceSequences = { old: 99 };
  const reset = resetJournalKeepingTombstones(journal, state);
  assert.equal(reset.tombstones[key].revision, 7);
  assert.equal(reset.revisions[key], 7);
  assert.deepEqual(reset.deviceSequences, {});
  state.tags.push({ id: 'deleted-tag' });
  assert.throws(() => resetJournalKeepingTombstones(reset, state), { code: 'SYNC_RESET_DELETED_ID_PRESENT' });
  state.tags = [];
  for (const bad of [null, { ...reset.tombstones[key], id: 'different' }, { ...reset.tombstones[key], revision: 0 }]) {
    assert.throws(() => resetJournalKeepingTombstones({ ...reset, tombstones: { [key]: bad } }, state), {
      code: 'SYNC_STORAGE_INVALID'
    });
  }
});

test('JSON恢复主体与已知墓碑冲突时命令失败，原文件字节不变', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'knowra-reset-conflict-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, 'cloud.json'),
    store = createFileDataStore(file);
  const app = createAppContext({ dataStore: store, storageRootDir: root, uploadsDir: path.join(root, 'uploads') });
  const space = app.modules.knowledge.knowledgeSpaceService.createDefaultKnowledgeSpace({ userId: 'demo' });
  const tag = app.modules.knowledge.tagService.createTag({ spaceId: space.id, name: '冲突标签' });
  const document = JSON.parse(fs.readFileSync(file, 'utf8'));
  document.sync.tombstones[syncKey('tags', tag.id)] = {
    collection: 'tags',
    id: tag.id,
    revision: 2,
    eventId: 'synthetic',
    deletedAt: null
  };
  fs.writeFileSync(file, JSON.stringify(document));
  const before = fs.readFileSync(file);
  assert.throws(
    () => execFileSync(process.execPath, [script, '--driver', 'local-json', '--data-file', file], { stdio: 'pipe' }),
    error => error.stderr.toString().includes('SYNC_RESET_DELETED_ID_PRESENT')
  );
  assert.deepEqual(fs.readFileSync(file), before);
});

test('JSON旧证据待修正时仍先校验原始墓碑，损坏或主体冲突均不写主文件', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'knowra-reset-legacy-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const scenario of ['malformed', 'collision']) {
    const state = createEmptyLocalState();
    state.knowledgeItems.push({ id: 'live-k', title: '合成知识', sourceMode: 'manual', reviewStatus: 'candidate' });
    // 普通store加载会补status/applicabilityStatus并持久化，此处必须在任何写入前拒绝。
    state.knowledgeEvidence.push({ id: 'e1', knowledgeItemId: 'live-k', sourceType: 'manual', quoteText: '合成证据' });
    const journal = createJournal(state);
    const key = syncKey(
      scenario === 'collision' ? 'knowledgeItems' : 'tags',
      scenario === 'collision' ? 'live-k' : 'deleted-tag'
    );
    journal.revisions[key] = 7;
    journal.tombstones[key] =
      scenario === 'malformed'
        ? null
        : { collection: 'knowledgeItems', id: 'live-k', revision: 7, eventId: 'synthetic', deletedAt: null };
    const file = path.join(root, `${scenario}.json`);
    const document = { schemaVersion: 6, ...state, sync: journal, customMetadata: { preserved: true } };
    fs.writeFileSync(file, JSON.stringify(document));
    const before = fs.readFileSync(file);
    const expected = scenario === 'malformed' ? 'SYNC_STORAGE_INVALID' : 'SYNC_RESET_DELETED_ID_PRESENT';
    assert.throws(
      () => execFileSync(process.execPath, [script, '--driver', 'local-json', '--data-file', file], { stdio: 'pipe' }),
      error => error.stderr.toString().includes(expected)
    );
    assert.deepEqual(fs.readFileSync(file), before);
    const backup = fs.readdirSync(root).find(name => name.startsWith(`${scenario}.json.before-sync-reset-`));
    assert.deepEqual(fs.readFileSync(path.join(root, backup)), before);
    if (scenario === 'malformed') {
      journal.tombstones[key] = {
        collection: 'tags',
        id: 'deleted-tag',
        revision: 7,
        eventId: 'synthetic',
        deletedAt: null
      };
      fs.writeFileSync(file, JSON.stringify(document));
      const result = JSON.parse(
        execFileSync(process.execPath, [script, '--driver', 'local-json', '--data-file', file], { encoding: 'utf8' })
      );
      const after = JSON.parse(fs.readFileSync(file, 'utf8'));
      assert.notEqual(result.datasetEpoch, journal.epoch);
      assert.deepEqual(after.sync.tombstones, journal.tombstones);
      assert.equal(after.knowledgeEvidence[0].status, 'valid');
      assert.equal(after.knowledgeEvidence[0].applicabilityStatus, 'active');
      assert.deepEqual(after.customMetadata, document.customMetadata);
    }
  }
});

test(
  '真实PostgreSQL世代重建保留墓碑，旧ID阻断、已知事实冲突及多日志故障整体回滚',
  {
    skip: !process.env.KNOWRA_SYNC_TEST_DATABASE_URL,
    timeout: 60000
  },
  async t => {
    const database = await createPostgresTestDatabase();
    t.after(() => database.close());
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'knowra-reset-pg-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const app = await createPostgresAppContext({
      databaseUrl: database.databaseUrl,
      storageRootDir: root,
      uploadsDir: path.join(root, 'uploads')
    });
    t.after(() => app.close());
    const k = app.modules.knowledge;
    await k.knowledgeSpaceService.createDefaultKnowledgeSpace({ userId: 'demo' });
    const { item } = await k.knowledgeItemService.createCandidate(candidate);
    const originalRow = await app.prisma.knowledgeItem.findUnique({ where: { id: item.id } });
    const snapshot = await app.http.storage.exportKnowledgeBase();
    const trashed = await k.knowledgeItemService.trash(item.id);
    await k.permanentlyDeleteKnowledgeItem(item.id, { expectedUpdatedAt: trashed.updatedAt });
    const previous = (await app.prisma.syncJournal.findUnique({ where: { ownerId: 'demo' } })).payload;
    const reset = () =>
      execFileSync(process.execPath, [script, '--driver', 'postgres'], {
        encoding: 'utf8',
        env: { ...process.env, KNOWRA_SYNC_RESET_DATABASE_URL: database.databaseUrl }
      });
    const result = JSON.parse(reset());
    const current = (await app.prisma.syncJournal.findUnique({ where: { ownerId: 'demo' } })).payload;
    assert.notEqual(current.epoch, previous.epoch);
    assert.equal(result.resetJournals, 1);
    assert.deepEqual(current.tombstones, previous.tombstones);
    await assert.rejects(k.knowledgeItemService.createCandidate(candidate), { code: 'KNOWLEDGE_ITEM_ID_DELETED' });
    await assert.rejects(app.http.sync.pushBatch(batch(previous.epoch, item)), { code: 'DATASET_CHANGED' });
    await assert.rejects(app.http.sync.pushBatch(batch(current.epoch, item)), { code: 'ENTITY_DELETED' });
    await assert.rejects(app.http.storage.importKnowledgeBase(snapshot), { code: 'IMPORT_DELETED_ID' });
    // 模拟外部错误恢复把已删主体放回：世代重建只能拒绝，不能擅自级联删掉它。
    await app.prisma.knowledgeItem.create({ data: originalRow });
    const conflicting = await app.prisma.syncJournal.findMany();
    assert.throws(reset, error => error.stderr.toString().includes('SYNC_RESET_DELETED_ID_PRESENT'));
    assert.deepEqual(await app.prisma.syncJournal.findMany(), conflicting);
    assert(await app.prisma.knowledgeItem.findUnique({ where: { id: item.id } }));
    await app.prisma.knowledgeItem.delete({ where: { id: item.id } });
    const journal = (await app.prisma.syncJournal.findUnique({ where: { ownerId: 'demo' } })).payload;
    await app.prisma.syncJournal.create({ data: { ownerId: 'secondary', payload: journal } });
    const allBefore = await app.prisma.syncJournal.findMany({ orderBy: { ownerId: 'asc' } });
    await app.prisma.$executeRawUnsafe(
      `CREATE FUNCTION fail_reset_journal() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."ownerId" = 'secondary' THEN RAISE EXCEPTION 'injected reset failure'; END IF; RETURN NEW; END $$`
    );
    await app.prisma.$executeRawUnsafe(
      `CREATE TRIGGER reset_journal_failure BEFORE UPDATE ON "SyncJournal" FOR EACH ROW EXECUTE FUNCTION fail_reset_journal()`
    );
    try {
      assert.throws(reset);
      assert.deepEqual(await app.prisma.syncJournal.findMany({ orderBy: { ownerId: 'asc' } }), allBefore);
    } finally {
      await app.prisma.$executeRawUnsafe('DROP TRIGGER reset_journal_failure ON "SyncJournal"');
      await app.prisma.$executeRawUnsafe('DROP FUNCTION fail_reset_journal()');
    }
  }
);
