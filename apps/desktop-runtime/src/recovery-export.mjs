import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { backup } from 'node:sqlite';
import { openReadonlySqliteSnapshot } from './sqlite-readonly-snapshot.mjs';
import { lockDataDirectory } from './data-directory.mjs';
import { readActiveDirectory } from './restore-directory.mjs';
import { copyRecoveryDraftFiles } from './recovery-draft-files.mjs';

/** 不依赖应用 schema 的救援导出；SQLite 仅打开临时快照，根目录互斥仍使用锁文件。必须先关闭运行服务。 */
export async function exportLocalRecovery(dataDirectory, destination) {
  if (!path.isAbsolute(dataDirectory) || !path.isAbsolute(destination))
    throw new Error('数据目录和导出目录必须是绝对路径。');
  if (fs.existsSync(destination)) throw new Error('导出目录已存在，禁止覆盖。');
  const release = lockDataDirectory(dataDirectory);
  let snapshot;
  let created = false;
  try {
    const activeDirectory = readActiveDirectory(dataDirectory);
    if (!fs.existsSync(path.join(activeDirectory, 'local.sqlite'))) throw new Error('本地数据库不存在。');
    snapshot = openReadonlySqliteSnapshot(path.join(activeDirectory, 'local.sqlite'));
    const db = snapshot.database;
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.mkdirSync(destination, { mode: 0o700 });
    created = true;
    await backup(db, path.join(destination, 'local.sqlite'));
    const tables = new Set(
      db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
        .all()
        .map(row => row.name)
    );
    const payload = {
      schemaVersion: db.prepare('PRAGMA user_version').get().user_version,
      exportedAt: new Date().toISOString(),
      tables: {}
    };
    for (const table of ['metadata', 'entities', 'sync_outbox', 'sync_uploads', 'sync_conflicts', 'sync_recovery'])
      if (tables.has(table)) payload.tables[table] = db.prepare(`SELECT * FROM ${table}`).all();
    fs.writeFileSync(path.join(destination, 'recovery.json'), JSON.stringify(payload, null, 2), { mode: 0o600 });
    const uploads = path.join(activeDirectory, 'uploads');
    if (fs.existsSync(uploads))
      fs.cpSync(uploads, path.join(destination, 'uploads'), { recursive: true, dereference: false });
    // 同时保留当前原生草稿和恢复来源的草稿；救援复制不要求草稿可解析。
    copyRecoveryDraftFiles(activeDirectory, destination, dataDirectory);
    function inventory(relative = '') {
      return fs.readdirSync(path.join(destination, relative), { withFileTypes: true }).flatMap(entry => {
        if (entry.isSymbolicLink()) throw new Error('救援导出不接受符号链接。');
        const name = path.join(relative, entry.name);
        if (entry.isDirectory()) return inventory(name);
        const file = path.join(destination, name);
        fs.chmodSync(file, 0o600);
        return [
          {
            path: name.split(path.sep).join('/'),
            sha256: createHash('sha256').update(fs.readFileSync(file)).digest('hex')
          }
        ];
      });
    }
    const files = inventory();
    fs.writeFileSync(
      path.join(destination, 'manifest.json'),
      JSON.stringify({ version: 1, createdAt: payload.exportedAt, files }, null, 2),
      { mode: 0o600 }
    );
    return { directory: destination, schemaVersion: payload.schemaVersion, files: files.length };
  } catch (error) {
    if (created) fs.rmSync(destination, { recursive: true, force: true });
    throw error;
  } finally {
    try {
      snapshot?.close();
    } finally {
      release();
    }
  }
}
