import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const changed = () => new Error('SQLite 来源在复制期间已变化，请停止写入后重新检查。');
const sameFile = (expected, actual) =>
  actual?.isFile() &&
  actual.nlink === 1n &&
  ['dev', 'ino', 'size', 'mtimeNs', 'ctimeNs'].every(key => expected[key] === actual[key]);

function sourceStat(file, required = false) {
  let stat;
  try {
    stat = fs.lstatSync(file, { bigint: true });
  } catch (error) {
    if (error.code === 'ENOENT' && !required) return null;
    throw error;
  }
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1n)
    throw new Error('SQLite 来源及副文件必须是独立普通文件。');
  return stat;
}

function assertNoRollbackJournal(source) {
  if (sourceStat(`${source}-journal`))
    throw new Error('SQLite 来源存在回滚日志，可能需要恢复；已停止检查并保留原始资料。');
}

/** 不在来源打开 SQLite；复制稳定的 DB/WAL/SHM，存在回滚日志时保守拒绝。 */
export function openReadonlySqliteSnapshot(source, { allowSidecars = true } = {}) {
  const files = ['', '-wal', '-shm'].map(suffix => {
    const stat = sourceStat(`${source}${suffix}`, suffix === '');
    if (suffix && stat && !allowSidecars) throw new Error('备份检查不接受 SQLite WAL/SHM 副文件。');
    return { source: `${source}${suffix}`, name: `local.sqlite${suffix}`, stat };
  });
  // journal 查询必须位于初始/最终文件身份校验的区间内，避免 spill/rollback 穿过两端窗口。
  assertNoRollbackJournal(source);
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'knowra-sqlite-inspect-'));
  const databasePath = path.join(directory, 'local.sqlite');
  let database;
  const close = () => {
    try {
      database?.close();
    } finally {
      database = undefined;
      fs.rmSync(directory, { recursive: true, force: true });
    }
  };
  try {
    for (const file of files) {
      if (!file.stat) continue;
      const fd = fs.openSync(
        file.source,
        fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0) | (fs.constants.O_NONBLOCK ?? 0)
      );
      try {
        if (!sameFile(file.stat, fs.fstatSync(fd, { bigint: true }))) throw changed();
        const target = fs.openSync(path.join(directory, file.name), 'wx', 0o600);
        try {
          const buffer = Buffer.allocUnsafe(1024 * 1024);
          let remaining = file.stat.size;
          while (remaining > 0n) {
            const length = Number(remaining < BigInt(buffer.length) ? remaining : BigInt(buffer.length));
            const count = fs.readSync(fd, buffer, 0, length, null);
            if (!count) throw changed();
            let written = 0;
            while (written < count) written += fs.writeSync(target, buffer, written, count - written);
            remaining -= BigInt(count);
          }
        } finally {
          fs.closeSync(target);
        }
        if (!sameFile(file.stat, fs.fstatSync(fd, { bigint: true }))) throw changed();
      } finally {
        fs.closeSync(fd);
      }
    }
    assertNoRollbackJournal(source);
    for (const file of files) {
      const actual = sourceStat(file.source);
      if (file.stat ? !sameFile(file.stat, actual) : actual !== null) throw changed();
    }
    database = new DatabaseSync(databasePath, { readOnly: true });
    return { database, databasePath, close };
  } catch (error) {
    close();
    throw error;
  }
}
