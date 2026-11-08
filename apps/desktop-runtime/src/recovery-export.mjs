import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { backup } from 'node:sqlite';
import { openReadonlySqliteSnapshot } from './sqlite-readonly-snapshot.mjs';
import { lockDataDirectoryForRecovery } from './data-directory.mjs';
import { readActiveDirectory } from './restore-directory.mjs';
import { listArchivedDraftFiles } from './recovery-draft-files.mjs';
import { captureBackupDirectory, createOwnedBackupDirectory } from './backup-transfer-files.mjs';
import {
  captureRecoveryDestination,
  captureRecoverySource,
  requireExternalRecoveryTemporaryDirectory
} from './recovery-export-files.mjs';
import { createOwnedTemporaryDirectory } from './owned-temporary-directory.mjs';

/** 离线救援三阶段：准备协调锁 → 源目录零写入的检查/导出 → 释放协调锁。不得启动运行服务。 */
export async function exportLocalRecovery(dataDirectory, destination) {
  if (!path.isAbsolute(dataDirectory) || !path.isAbsolute(destination))
    throw new Error('数据目录和导出目录必须是绝对路径。');
  const origin = captureBackupDirectory(dataDirectory);
  dataDirectory = origin.directory;
  const target = captureRecoveryDestination(destination, dataDirectory);
  const temporaryParent = requireExternalRecoveryTemporaryDirectory(os.tmpdir(), dataDirectory);
  origin.check();
  // 准备阶段允许创建/恢复协调锁；持续持有 startup gate，旧版失败启动也不会写源根目录。
  const release = lockDataDirectoryForRecovery(dataDirectory);
  let snapshot, temporary, output;
  try {
    const source = captureRecoverySource(dataDirectory);
    origin.check();
    const activeDirectory = readActiveDirectory(dataDirectory);
    if (!fs.existsSync(path.join(activeDirectory, 'local.sqlite'))) throw new Error('本地数据库不存在。');
    snapshot = openReadonlySqliteSnapshot(path.join(activeDirectory, 'local.sqlite'));
    const db = snapshot.database;
    temporaryParent.check();
    temporary = createOwnedTemporaryDirectory('knowra-recovery-export-', temporaryParent.directory, {
      outside: dataDirectory
    });
    const databaseFile = path.join(temporary.directory, 'local.sqlite');
    const fd = fs.openSync(databaseFile, 'wx', 0o600);
    try {
      temporary.record('local.sqlite', fs.fstatSync(fd));
    } finally {
      fs.closeSync(fd);
    }
    await backup(db, databaseFile);
    temporary.check();
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
    source.check();
    origin.check();
    output = createOwnedBackupDirectory(target.parent, target.name);
    const files = [];
    const write = (name, bytes) => {
      output.write(name, bytes);
      files.push({ path: name, sha256: createHash('sha256').update(bytes).digest('hex') });
    };
    write('local.sqlite', temporary.read('local.sqlite'));
    write('recovery.json', Buffer.from(JSON.stringify(payload, null, 2)));
    const relative = file => path.relative(dataDirectory, file).split(path.sep).join('/');
    const uploads = `${relative(path.join(activeDirectory, 'uploads'))}/`;
    // 损坏的 uploads 若是普通文件，仍保留旧救援入口的原字节，不静默丢弃。
    const uploadsEntry = uploads.slice(0, -1);
    if (source.entries.get(uploadsEntry)?.isFile()) write('uploads', source.read(uploadsEntry));
    for (const [name, stat] of source.entries)
      if (name.startsWith(uploads) && stat.isFile()) write(`uploads/${name.slice(uploads.length)}`, source.read(name));
    // 根目录草稿与活动资料集归档均保留原字节；损坏 JSON 也能救援，不加载应用 schema。
    const primary = 'recovery-drafts.json';
    let primaryDigest;
    if (source.entries.has(primary)) {
      const bytes = source.read(primary);
      primaryDigest = createHash('sha256').update(bytes).digest('hex');
      write(primary, bytes);
    }
    const archives = [...new Set([dataDirectory, activeDirectory])].flatMap(directory =>
      listArchivedDraftFiles(directory, { verify: false }).map(item => item.file)
    );
    if (activeDirectory !== dataDirectory && source.entries.has(relative(path.join(activeDirectory, primary))))
      archives.push(path.join(activeDirectory, primary));
    const copied = new Set();
    for (const file of archives) {
      const bytes = source.read(relative(file));
      const digest = createHash('sha256').update(bytes).digest('hex');
      if (digest === primaryDigest || copied.has(digest)) continue;
      copied.add(digest);
      write(`recovery-draft-archives/${digest}.json`, bytes);
    }
    source.check();
    origin.check();
    output.check();
    // 完整清单是发布标志；失败只清理仍属于本次操作的目录和文件。
    output.write(
      'manifest.json',
      Buffer.from(JSON.stringify({ version: 1, createdAt: payload.exportedAt, files }, null, 2))
    );
    source.check();
    origin.check();
    output.check();
    return { directory: output.root, schemaVersion: payload.schemaVersion, files: files.length };
  } catch (error) {
    output?.remove('manifest.json');
    output?.cleanup();
    throw error;
  } finally {
    try {
      try {
        snapshot?.close();
      } finally {
        temporary?.cleanup();
      }
    } finally {
      // 检查阶段到此结束。收尾阶段真实删除协调锁，不伪造任何时间。
      release();
    }
  }
}
