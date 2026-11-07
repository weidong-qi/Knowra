import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { createConversationAttachmentService } from '../../api/src/modules/ai/conversation-attachments.js';
import { createSqliteDataStore } from '../src/sqlite-data-store.mjs';
import { initializeDatabase, readAiSchemaVersion } from '../src/sqlite-schema.mjs';
import { initializeDatabase as initializeV7 } from './fixtures/sqlite-schema-v7.fixture.mjs';
import { createRuntimeBackup, inspectRuntimeBackup } from '../src/backup.mjs';
import { createNote, openWorkspace, removeAiTablesForLegacyFixture, temporaryDirectory } from './helpers.mjs';
import { prepareRestoredDirectory } from '../src/restore-directory.mjs';

const rows = db =>
  Object.fromEntries(
    db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
      .all()
      .map(({ name }) => [name, db.prepare(`SELECT * FROM "${name.replaceAll('"', '""')}"`).all()])
  );
const version = db => db.prepare('PRAGMA user_version').get().user_version;
const gateBackups = root => fs.readdirSync(root).filter(name => name.startsWith('local.sqlite.before-v8-'));
function seedV7(t) {
  const root = temporaryDirectory(t);
  const workspace = openWorkspace(root);
  createNote(workspace, '合成 v7 离线正文');
  workspace.store.syncTransaction(db => {
    // 合成的原样持久事实；迁移没有权力解释、换号、修复或清除此处内容。
    for (const key of [
      'entityUpload',
      'sendingUpload',
      'preparedUpload',
      'safetyPause',
      'senderDeviceId',
      'recoverySession',
      'recoveryPendingKeys',
      'recoveryBarriers'
    ])
      db.prepare('INSERT OR REPLACE INTO metadata VALUES (?,?)').run(`sync:${key}`, JSON.stringify({ sentinel: key }));
    db.prepare('INSERT INTO sync_uploads VALUES (?,?,?)').run('synthetic-note', '{"sentinel":"legacy-request"}', 5);
  });
  workspace.store.close();
  fs.writeFileSync(path.join(root, 'uploads', 'synthetic.txt'), '合成附件，不在 schema .bak 中');
  const file = path.join(root, 'local.sqlite');
  const db = new DatabaseSync(file);
  db.exec("DELETE FROM metadata WHERE key='aiSchemaVersion'; PRAGMA user_version=7");
  const before = rows(db);
  db.close();
  return { root, file, before };
}

test('v7→v8 先创建可验证数据库备份，保全身份/冻结事实/队列；冻结旧初始化器拒开 v8', t => {
  const f = seedV7(t);
  const store = createSqliteDataStore(f.file);
  store.readSync(db => {
    assert.equal(version(db), 8);
    assert.equal(readAiSchemaVersion(db), 7);
    const after = rows(db);
    after.metadata = after.metadata.filter(row => row.key !== 'aiSchemaVersion');
    assert.deepEqual(after, f.before);
  });
  store.close();
  assert.equal(gateBackups(f.root).length, 1);
  const backupFile = path.join(f.root, gateBackups(f.root)[0]);
  assert.equal(fs.statSync(backupFile).mode & 0o777, 0o600);
  const backup = new DatabaseSync(backupFile, { readOnly: true });
  assert.equal(version(backup), 7);
  assert.equal(backup.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
  assert.deepEqual(rows(backup), f.before);
  assert.equal(initializeV7(backup, backupFile), undefined);
  backup.close();
  const beforeOpen = fs.readFileSync(f.file);
  const upgraded = new DatabaseSync(f.file);
  assert.throws(() => initializeV7(upgraded, f.file), /不支持的本地数据库版本 8/);
  upgraded.close();
  assert.deepEqual(fs.readFileSync(f.file), beforeOpen);
  createSqliteDataStore(f.file).close();
  assert.equal(gateBackups(f.root).length, 1, '重启不重复升级或清除旧备份');
  assert.equal(fs.readFileSync(path.join(f.root, 'uploads', 'synthetic.txt'), 'utf8'), '合成附件，不在 schema .bak 中');
});

test('v8 门禁事务失败回滚为 v7，升级前原库副本仍可供旧初始化器打开', t => {
  const f = seedV7(t);
  let db = new DatabaseSync(f.file);
  db.exec(
    "CREATE TRIGGER synthetic_gate_failure BEFORE INSERT ON metadata WHEN NEW.key='aiSchemaVersion' BEGIN SELECT RAISE(ABORT,'synthetic-v8-failure'); END"
  );
  const before = rows(db);
  db.close();
  assert.throws(() => createSqliteDataStore(f.file), /synthetic-v8-failure/);
  db = new DatabaseSync(f.file);
  assert.equal(version(db), 7);
  assert.equal(db.isTransaction, false);
  assert.deepEqual(rows(db), before);
  assert.equal(initializeV7(db, f.file), undefined);
  db.close();
  const backup = new DatabaseSync(path.join(f.root, gateBackups(f.root)[0]));
  assert.equal(version(backup), 7);
  assert.deepEqual(rows(backup), before);
  backup.close();
});

test('升级前备份权限或落盘步骤失败时停止，v7 和原冻结记录不变', t => {
  for (const method of ['chmodSync', 'fsyncSync']) {
    const f = seedV7(t);
    const bytes = fs.readFileSync(f.file);
    const mock = t.mock.method(fs, method, () => {
      throw new Error(`synthetic-${method}`);
    });
    assert.throws(() => createSqliteDataStore(f.file), new RegExp(`synthetic-${method}`));
    mock.mock.restore();
    assert.deepEqual(fs.readFileSync(f.file), bytes);
    assert.deepEqual(gateBackups(f.root), []);
    const db = new DatabaseSync(f.file, { readOnly: true });
    assert.equal(version(db), 7);
    assert.deepEqual(rows(db), f.before);
    db.close();
  }
});

test('可选 AI 升级失败仍保留 v8 门禁与独立进度，修复后重试不降级', t => {
  const f = seedV7(t);
  const raw = new DatabaseSync(f.file);
  raw.exec(`DROP TABLE ai_conversation_records; PRAGMA user_version=6;
    CREATE TRIGGER synthetic_ai_failure BEFORE INSERT ON metadata WHEN NEW.key='aiSchemaVersion' AND NEW.value='7'
    BEGIN SELECT RAISE(ABORT,'synthetic-ai-failure'); END;`);
  raw.close();
  for (let attempt = 0; attempt < 2; attempt++) {
    const store = createSqliteDataStore(f.file);
    assert.match(store.aiRuntimeError.message, /synthetic-ai-failure/);
    assert.equal(store.aiConversationStore, null);
    store.readSync(db => {
      assert.equal(version(db), 8);
      assert.equal(readAiSchemaVersion(db), 6);
      assert.throws(() => initializeV7(db, f.file), /版本 8/);
    });
    store.close();
  }
  const db = new DatabaseSync(f.file);
  db.exec('DROP TRIGGER synthetic_ai_failure');
  db.close();
  const store = createSqliteDataStore(f.file);
  assert.equal(store.aiRuntimeError, null);
  store.readSync(db => {
    assert.equal(version(db), 8);
    assert.equal(readAiSchemaVersion(db), 7);
  });
  store.close();
});

test('v8 AI 描述符缺失或未来版本均拒绝覆盖，原库保留', t => {
  for (const marker of [null, '99']) {
    const f = seedV7(t);
    createSqliteDataStore(f.file).close();
    const db = new DatabaseSync(f.file);
    if (marker === null) db.exec("DELETE FROM metadata WHERE key='aiSchemaVersion'");
    else db.prepare("UPDATE metadata SET value=? WHERE key='aiSchemaVersion'").run(marker);
    db.close();
    const before = fs.readFileSync(f.file);
    assert.throws(() => createSqliteDataStore(f.file), /schema 版本/);
    assert.deepEqual(fs.readFileSync(f.file), before);
  }
});

test('v8 完整备份可校验恢复且生成新资料集；schema .bak 不冒充附件完整备份', t => {
  const f = seedV7(t);
  const store = createSqliteDataStore(f.file);
  const dataset = store.getStatus().datasetId;
  const full = createRuntimeBackup(store, f.root);
  assert.equal(inspectRuntimeBackup(full).valid, true);
  store.close();
  const restored = prepareRestoredDirectory(f.root, full);
  const reopened = createSqliteDataStore(path.join(restored, 'local.sqlite'));
  assert.notEqual(reopened.getStatus().datasetId, dataset);
  assert.equal(
    fs.readFileSync(path.join(restored, 'uploads', 'synthetic.txt'), 'utf8'),
    '合成附件，不在 schema .bak 中'
  );
  reopened.close();
});

test('直接初始化 v8 不因用户版本相同忽略描述符，未知 user_version 不覆盖', t => {
  const root = temporaryDirectory(t),
    file = path.join(root, 'local.sqlite');
  const db = new DatabaseSync(file);
  db.exec('PRAGMA user_version=99');
  assert.throws(() => initializeDatabase(db, file), /不支持/);
  assert.equal(version(db), 99);
  db.close();
});

for (const legacyVersion of [1, 2, 3, 4, 5, 6]) {
  test(`合成 v${legacyVersion} 旧库到 v8 保全同步事实并完成可选 AI 进度`, t => {
    const f = seedV7(t),
      db = new DatabaseSync(f.file);
    if (legacyVersion <= 3) removeAiTablesForLegacyFixture(db);
    else {
      db.exec('DROP TABLE ai_conversation_records');
      if (legacyVersion <= 5)
        db.exec('DROP TABLE ai_request_manifests; DROP TABLE ai_run_grants; DROP TABLE ai_access_policies');
      if (legacyVersion === 4)
        db.exec('ALTER TABLE ai_jobs DROP COLUMN question; ALTER TABLE ai_jobs DROP COLUMN result_json');
    }
    if (legacyVersion === 1) db.exec('DROP TABLE sync_uploads; DROP TABLE sync_conflicts; DROP TABLE sync_recovery');
    db.exec(`PRAGMA user_version=${legacyVersion}`);
    const beforeMetadata = db.prepare("SELECT * FROM metadata WHERE key LIKE 'sync:%' ORDER BY key").all();
    const beforeQueue = db.prepare('SELECT * FROM sync_outbox ORDER BY sequence').all();
    db.close();
    const store = createSqliteDataStore(f.file);
    assert.equal(store.aiRuntimeError, null);
    store.readSync(upgraded => {
      assert.equal(version(upgraded), 8);
      assert.equal(readAiSchemaVersion(upgraded), 7);
      assert.deepEqual(
        upgraded.prepare("SELECT * FROM metadata WHERE key LIKE 'sync:%' ORDER BY key").all(),
        beforeMetadata
      );
      assert.deepEqual(upgraded.prepare('SELECT * FROM sync_outbox ORDER BY sequence').all(), beforeQueue);
    });
    store.close();
    const backup = new DatabaseSync(path.join(f.root, gateBackups(f.root)[0]), { readOnly: true });
    // v1/v2 沿用既有分段升级，v8 的副本是到达 v3 后的库，而不是整链回到 v1/v2 的承诺。
    assert.equal(version(backup), Math.max(legacyVersion, 3));
    backup.close();
  });
}

test('v1/v2 分段迁移后门禁失败会停在 v3，原始各阶段备份保留而非伪称整链原子', t => {
  const f = seedV7(t),
    db = new DatabaseSync(f.file);
  removeAiTablesForLegacyFixture(db);
  db.exec(`DROP TABLE sync_uploads; DROP TABLE sync_conflicts; DROP TABLE sync_recovery; PRAGMA user_version=1;
    CREATE TRIGGER synthetic_gate_failure BEFORE INSERT ON metadata WHEN NEW.key='aiSchemaVersion'
    BEGIN SELECT RAISE(ABORT,'synthetic-partial-upgrade'); END`);
  db.close();
  assert.throws(() => createSqliteDataStore(f.file), /synthetic-partial-upgrade/);
  const current = new DatabaseSync(f.file, { readOnly: true });
  assert.equal(version(current), 3);
  current.close();
  for (const [prefix, expected] of [
    ['local.sqlite.before-v2-', 1],
    ['local.sqlite.before-v3-', 2],
    ['local.sqlite.before-v8-', 3]
  ]) {
    const filename = fs.readdirSync(f.root).find(name => name.startsWith(prefix));
    assert(filename);
    const backup = new DatabaseSync(path.join(f.root, filename), { readOnly: true });
    assert.equal(version(backup), expected);
    assert.equal(backup.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
    backup.close();
  }
});

test('备份后第二连接改变版本或正文时锁内拒绝覆盖，保留外部已提交事实', t => {
  for (const sql of ['PRAGMA user_version=99', "UPDATE metadata SET value='external-change' WHERE key='deviceId'"]) {
    const f = seedV7(t);
    const original = fs.fsyncSync;
    let changed = false;
    const mock = t.mock.method(fs, 'fsyncSync', fd => {
      original(fd);
      if (changed) return;
      changed = true;
      const writer = new DatabaseSync(f.file);
      writer.exec(sql);
      writer.close();
    });
    assert.throws(() => createSqliteDataStore(f.file), /来源.*变化/);
    mock.mock.restore();
    const db = new DatabaseSync(f.file, { readOnly: true });
    assert.equal(version(db), sql.includes('99') ? 99 : 7);
    assert.equal(db.prepare("SELECT value FROM metadata WHERE key='aiSchemaVersion'").get(), undefined);
    if (!sql.includes('99'))
      assert.equal(db.prepare("SELECT value FROM metadata WHERE key='deviceId'").get().value, 'external-change');
    db.close();
    assert.equal(gateBackups(f.root).length, 1);
  }
});

test('备份文件 fsync 使用可写句柄，目录不套用文件权限', t => {
  const f = seedV7(t),
    original = fs.openSync;
  const flags = [];
  const mock = t.mock.method(fs, 'openSync', (file, flag, ...args) => {
    if (String(file).includes('.before-v8-')) flags.push(flag);
    return original(file, flag, ...args);
  });
  createSqliteDataStore(f.file).close();
  mock.mock.restore();
  assert(flags.includes(fs.constants.O_RDWR));
});

test('较低 AI 描述符不能让现存会话附件跳过创建/恢复备份的文件核验', async t => {
  const root = temporaryDirectory(t),
    file = path.join(root, 'local.sqlite');
  const store = createSqliteDataStore(file);
  t.after(() => store.close());
  const conversation = await store.aiConversationStore.createConversation({
    ownerId: 'demo',
    actorId: 'demo',
    spaceId: 'synthetic-space'
  });
  const service = createConversationAttachmentService({
    conversationStore: store.aiConversationStore,
    uploadsDir: path.join(root, 'uploads'),
    ownerId: 'demo'
  });
  t.after(() => service.close());
  const attachment = await service.upload({
    conversationId: conversation.conversationId,
    uploadKey: 'synthetic-upload',
    fileName: 'synthetic.txt',
    mimeType: 'text/plain',
    bytes: Buffer.from('合成会话附件')
  });
  const full = createRuntimeBackup(store, root);
  const relative = `uploads/ai-conversations/${attachment.attachmentId}.bin`;
  store.syncTransaction(db => db.prepare("UPDATE metadata SET value='6' WHERE key='aiSchemaVersion'").run());
  fs.unlinkSync(path.join(root, relative));
  assert.throws(() => createRuntimeBackup(store, root), /对话附件.*校验失败/);
  const db = new DatabaseSync(path.join(full, 'local.sqlite'));
  db.exec("UPDATE metadata SET value='6' WHERE key='aiSchemaVersion'");
  db.close();
  fs.unlinkSync(path.join(full, relative));
  const manifestPath = path.join(full, 'manifest.json'),
    manifest = JSON.parse(fs.readFileSync(manifestPath));
  manifest.files = manifest.files.filter(entry => entry.path !== relative);
  for (const entry of manifest.files) {
    const bytes = fs.readFileSync(path.join(full, entry.path));
    entry.sha256 = createHash('sha256').update(bytes).digest('hex');
    entry.size = bytes.length;
  }
  fs.writeFileSync(manifestPath, JSON.stringify(manifest));
  assert.throws(() => inspectRuntimeBackup(full), /对话附件.*校验失败/);
});
