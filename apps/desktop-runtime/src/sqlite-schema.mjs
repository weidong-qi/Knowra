import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { AI_SQLITE_DDL, AI_ACCESS_SQLITE_DDL, AI_CONVERSATION_SQLITE_DDL } from './ai-sqlite-schema.mjs';

export const LOCAL_DATABASE_VERSION = 8;
export const SYNC_PROTOCOL_VERSION = 1;

export function initializeDatabase(db, filePath) {
  const version = db.prepare('PRAGMA user_version').get().user_version;
  if (version === LOCAL_DATABASE_VERSION) return upgradeOptionalAi(db, filePath);
  if (version >= 3 && version <= 7) {
    upgradeSyncSafetyGate(db, filePath, version);
    return upgradeOptionalAi(db, filePath);
  }
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
  upgradeSyncSafetyGate(db, filePath, 3, { backup: false });
  return upgradeOptionalAi(db, filePath, { backup: false });
}

/** v8 起 user_version 是强制兼容门禁，可选 AI 的进度独立保存。旧库只读检查仍用原版本。 */
export function readAiSchemaVersion(db, version = db.prepare('PRAGMA user_version').get().user_version) {
  if (version >= 1 && version <= 7) return version;
  if (version !== LOCAL_DATABASE_VERSION) throw new Error('本地数据库版本不受支持，请升级应用。');
  const value = db.prepare("SELECT value FROM metadata WHERE key='aiSchemaVersion'").get()?.value;
  if (!/^[3-7]$/.test(value ?? '')) throw new Error('本地 AI schema 版本缺失或不受支持；原资料已保留。');
  return Number(value);
}

function upgradeSyncSafetyGate(db, filePath, version, { backup = true } = {}) {
  const dataVersion = db.prepare('PRAGMA data_version').get().data_version;
  if (backup) createGateBackup(db, filePath, version);
  db.exec('BEGIN IMMEDIATE');
  try {
    if (
      db.prepare('PRAGMA data_version').get().data_version !== dataVersion ||
      db.prepare('PRAGMA user_version').get().user_version !== version
    )
      throw new Error('SQLite 来源在升级前备份期间已变化，已停止升级；原资料与备份均保留。');
    // 不读取/重写任何 sync:* 事实、队列、恢复会话或设备身份。
    db.prepare('INSERT OR REPLACE INTO metadata VALUES (?,?)').run('aiSchemaVersion', String(version));
    db.exec('PRAGMA user_version = 8; COMMIT;');
  } catch (error) {
    if (db.isTransaction) db.exec('ROLLBACK');
    throw error;
  }
}

function createGateBackup(db, filePath, version) {
  const destination = `${filePath}.before-v8-${randomUUID()}.bak`;
  let backup;
  try {
    db.prepare('VACUUM INTO ?').run(destination);
    fs.chmodSync(destination, 0o600);
    backup = new DatabaseSync(destination, { readOnly: true });
    if (
      backup.prepare('PRAGMA user_version').get().user_version !== version ||
      backup
        .prepare('PRAGMA integrity_check')
        .all()
        .some(row => row.integrity_check !== 'ok')
    )
      throw new Error('v8 升级前 SQLite 备份校验失败；原数据库未升级。');
    backup.close();
    backup = undefined;
    for (const file of process.platform === 'win32' ? [destination] : [destination, path.dirname(destination)]) {
      const fd = fs.openSync(file, file === destination ? fs.constants.O_RDWR : fs.constants.O_RDONLY);
      try {
        fs.fsyncSync(fd);
      } finally {
        fs.closeSync(fd);
      }
    }
  } catch (error) {
    backup?.close();
    // 只移除本次唯一命名的未通过校验副本；原库与其他备份不动。
    fs.rmSync(destination, { force: true });
    throw error;
  }
}

function upgradeOptionalAi(db, filePath, { backup = true } = {}) {
  // v8 描述符损坏不能猜测进度或覆盖，即使核心仍然可读也要停止启动。
  const version = readAiSchemaVersion(db);
  try {
    if (version === 3) upgradeAiSchema(db, filePath, { backup });
    else if (version === 4) {
      upgradeAiAnswerSchema(db, filePath, { backup });
      upgradeAiAccessSchema(db, filePath, { backup: false });
    } else if (version === 5) upgradeAiAccessSchema(db, filePath, { backup });
    else if (version === 6) upgradeAiConversationSchema(db, filePath, { backup });
    return null;
  } catch (error) {
    // 失败只关闭 AI；强制 v8 门禁保留，不自动降回可被旧版打开的 v3–v7。
    return { aiError: error };
  }
}

function setAiSchemaVersion(db, version) {
  db.prepare('INSERT OR REPLACE INTO metadata VALUES (?,?)').run('aiSchemaVersion', String(version));
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
    setAiSchemaVersion(db, 5);
    db.exec('COMMIT');
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
    setAiSchemaVersion(db, 4);
    db.exec('COMMIT');
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
    setAiSchemaVersion(db, 6);
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
    setAiSchemaVersion(db, 7);
    db.exec('COMMIT');
  } catch (error) {
    if (db.isTransaction) db.exec('ROLLBACK');
    throw error;
  }
}
