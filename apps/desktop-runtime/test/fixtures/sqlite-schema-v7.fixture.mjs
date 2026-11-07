// 冻结自 main 654714d2 的 v7 初始化器，仅替换 AI DDL 导入路径；禁止跟随现役门禁更新。
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { AI_SQLITE_DDL, AI_ACCESS_SQLITE_DDL, AI_CONVERSATION_SQLITE_DDL } from '../../src/ai-sqlite-schema.mjs';

export const LOCAL_DATABASE_VERSION = 7;
export const SYNC_PROTOCOL_VERSION = 1;

export function initializeDatabase(db, filePath) {
  const version = db.prepare('PRAGMA user_version').get().user_version;
  if (version === LOCAL_DATABASE_VERSION) return;
  if (version === 6) return tryAiUpgrade(() => upgradeAiConversationSchema(db, filePath));
  if (version === 5) return tryAiUpgrade(() => upgradeAiAccessSchema(db, filePath));
  if (version === 4)
    return tryAiUpgrade(() => {
      upgradeAiAnswerSchema(db, filePath);
      upgradeAiAccessSchema(db, filePath);
    });
  if (version === 3) return tryAiUpgrade(() => upgradeAiSchema(db, filePath));
  if (version === 2) {
    const backup = `${filePath}.before-v3-${Date.now()}.bak`;
    db.prepare('VACUUM INTO ?').run(backup);
    fs.chmodSync(backup, 0o600);
    db.exec(`BEGIN IMMEDIATE;
      INSERT OR REPLACE INTO metadata VALUES ('entitySyncVersion', '2');
      PRAGMA user_version = 3;
      COMMIT;`);
    return initializeDatabase(db, filePath);
  }
  if (version === 1) {
    const backup = `${filePath}.before-v2-${Date.now()}.bak`;
    db.prepare('VACUUM INTO ?').run(backup);
    fs.chmodSync(backup, 0o600);
    db.exec(`BEGIN IMMEDIATE;
      CREATE TABLE sync_uploads (note_id TEXT PRIMARY KEY, request TEXT NOT NULL, local_revision INTEGER NOT NULL);
      CREATE TABLE sync_conflicts (note_id TEXT PRIMARY KEY, payload TEXT NOT NULL);
      CREATE TABLE sync_recovery (id TEXT PRIMARY KEY, payload TEXT NOT NULL);
      PRAGMA user_version = 2;
      COMMIT;`);
    return initializeDatabase(db, filePath);
  }
  if (version !== 0) throw new Error(`不支持的本地数据库版本 ${version}，请升级应用；原数据库未修改。`);
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all();
  if (tables.length) throw new Error('检测到未标记版本的数据库，已停止初始化，原数据未覆盖。');
  db.exec('BEGIN IMMEDIATE');
  try {
    db.exec(`
      CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE entities (
        collection TEXT NOT NULL, id TEXT NOT NULL, payload TEXT NOT NULL,
        local_revision INTEGER NOT NULL, PRIMARY KEY (collection, id)
      );
      CREATE TABLE sync_base (
        collection TEXT NOT NULL, id TEXT NOT NULL, server_revision INTEGER,
        payload TEXT, PRIMARY KEY (collection, id)
      );
      CREATE TABLE sync_outbox (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT, operation_id TEXT UNIQUE NOT NULL,
        device_id TEXT NOT NULL, protocol_version INTEGER NOT NULL,
        state TEXT NOT NULL CHECK(state IN ('pending','sending','acknowledged','retry_wait','blocked_dependency','conflict','failed_permanent')),
        changes TEXT NOT NULL, dependencies TEXT NOT NULL, created_at TEXT NOT NULL
      );
      CREATE TABLE local_revisions (
        collection TEXT NOT NULL, id TEXT NOT NULL, revision INTEGER NOT NULL,
        last_operation_id TEXT NOT NULL, PRIMARY KEY (collection, id)
      );
      CREATE TABLE sync_uploads (note_id TEXT PRIMARY KEY, request TEXT NOT NULL, local_revision INTEGER NOT NULL);
      CREATE TABLE sync_conflicts (note_id TEXT PRIMARY KEY, payload TEXT NOT NULL);
      CREATE TABLE sync_recovery (id TEXT PRIMARY KEY, payload TEXT NOT NULL);
      INSERT OR REPLACE INTO metadata VALUES ('entitySyncVersion', '2');
      PRAGMA user_version = 3;
    `);
    db.exec('COMMIT');
    fs.chmodSync(filePath, 0o600);
  } catch (error) {
    if (db.isTransaction) db.exec('ROLLBACK');
    throw error;
  }
  return tryAiUpgrade(() => upgradeAiSchema(db, filePath, { backup: false }));
}

function tryAiUpgrade(operation) {
  try {
    operation();
    return null;
  } catch (error) {
    // 这里只捕获独立 AI schema 的升级；核心表版本/完整性故障继续向上抛出。
    return { aiError: error };
  }
}

function upgradeAiAnswerSchema(db, filePath, { backup = true } = {}) {
  if (backup) {
    const destination = `${filePath}.before-v5-${Date.now()}.bak`;
    db.prepare('VACUUM INTO ?').run(destination);
    fs.chmodSync(destination, 0o600);
  }
  db.exec('BEGIN IMMEDIATE');
  try {
    const columns = new Set(
      db
        .prepare('PRAGMA table_info(ai_jobs)')
        .all()
        .map(column => column.name)
    );
    if (!columns.has('question')) db.exec('ALTER TABLE ai_jobs ADD COLUMN question TEXT');
    if (!columns.has('result_json')) db.exec('ALTER TABLE ai_jobs ADD COLUMN result_json TEXT');
    db.exec('PRAGMA user_version = 5; COMMIT;');
  } catch (error) {
    if (db.isTransaction) db.exec('ROLLBACK');
    throw error;
  }
}

function upgradeAiSchema(db, filePath, { backup = true } = {}) {
  if (backup) {
    const destination = `${filePath}.before-v4-${Date.now()}.bak`;
    db.prepare('VACUUM INTO ?').run(destination);
    fs.chmodSync(destination, 0o600);
  }
  db.exec('BEGIN IMMEDIATE');
  try {
    db.exec(AI_SQLITE_DDL);
    db.prepare('INSERT OR REPLACE INTO metadata VALUES (?, ?)').run('aiRuntimeEpoch', randomUUID());
    db.exec('PRAGMA user_version = 4; COMMIT;');
  } catch (error) {
    if (db.isTransaction) db.exec('ROLLBACK');
    throw error;
  }
  upgradeAiAnswerSchema(db, filePath, { backup: false });
  upgradeAiAccessSchema(db, filePath, { backup: false });
}

function upgradeAiAccessSchema(db, filePath, { backup = true } = {}) {
  if (backup) {
    const destination = `${filePath}.before-v6-${Date.now()}.bak`;
    db.prepare('VACUUM INTO ?').run(destination);
    fs.chmodSync(destination, 0o600);
  }
  db.exec('BEGIN IMMEDIATE');
  try {
    db.exec(AI_ACCESS_SQLITE_DDL);
    db.exec('PRAGMA user_version = 6');
    db.exec('COMMIT');
  } catch (error) {
    if (db.isTransaction) db.exec('ROLLBACK');
    throw error;
  }
  upgradeAiConversationSchema(db, filePath, { backup: false });
}

function upgradeAiConversationSchema(db, filePath, { backup = true } = {}) {
  if (backup) {
    const destination = `${filePath}.before-v7-${Date.now()}.bak`;
    db.prepare('VACUUM INTO ?').run(destination);
    fs.chmodSync(destination, 0o600);
  }
  db.exec('BEGIN IMMEDIATE');
  try {
    db.exec(AI_CONVERSATION_SQLITE_DDL);
    db.exec('PRAGMA user_version = 7');
    db.exec('COMMIT');
  } catch (error) {
    if (db.isTransaction) db.exec('ROLLBACK');
    throw error;
  }
}
