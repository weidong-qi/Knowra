import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { openReadonlySqliteSnapshot } from '../src/sqlite-readonly-snapshot.mjs';
import { temporaryDirectory } from './helpers.mjs';

function directoryState(directory) {
  return [
    fs.statSync(directory, { bigint: true }).mtimeNs,
    fs
      .readdirSync(directory)
      .sort()
      .map(name => {
        const file = path.join(directory, name);
        return [name, fs.lstatSync(file, { bigint: true }).mtimeNs, fs.readFileSync(file)];
      })
  ];
}

function createSource(t, { wal = false } = {}) {
  const directory = temporaryDirectory(t);
  const file = path.join(directory, 'local.sqlite');
  const db = new DatabaseSync(file);
  if (wal) db.exec('PRAGMA journal_mode = WAL; PRAGMA wal_autocheckpoint = 0;');
  db.exec("CREATE TABLE sample (value TEXT); INSERT INTO sample VALUES ('committed');");
  return { directory, file, db };
}

test('WAL 模式主文件没有副文件时，检查不在原目录生成 WAL/SHM，副本只读且可重复清理', t => {
  const source = createSource(t, { wal: true });
  source.db.close();
  assert.deepEqual(fs.readdirSync(source.directory), ['local.sqlite']);
  const before = directoryState(source.directory);
  for (let attempt = 0; attempt < 2; attempt++) {
    const snapshot = openReadonlySqliteSnapshot(source.file);
    assert.equal(snapshot.database.prepare('SELECT value FROM sample').get().value, 'committed');
    assert.throws(() => snapshot.database.exec("INSERT INTO sample VALUES ('forbidden')"), /readonly/i);
    assert.notEqual(path.dirname(snapshot.databasePath), source.directory);
    assert.equal(fs.statSync(snapshot.databasePath).mode & 0o777, 0o600);
    snapshot.close();
    snapshot.close();
    assert.equal(fs.existsSync(path.dirname(snapshot.databasePath)), false);
  }
  assert.deepEqual(directoryState(source.directory), before);
});

test('复制 DB/WAL/SHM 包含尚未 checkpoint 的已提交数据，原文件内容及 mtime 不变', t => {
  const source = createSource(t, { wal: true });
  t.after(() => source.db.close());
  assert(fs.statSync(`${source.file}-wal`).size > 0);
  assert(fs.existsSync(`${source.file}-shm`));
  const before = directoryState(source.directory);
  const snapshot = openReadonlySqliteSnapshot(source.file);
  try {
    assert.equal(snapshot.database.prepare('SELECT value FROM sample').get().value, 'committed');
    for (const suffix of ['-wal', '-shm']) assert(fs.existsSync(`${snapshot.databasePath}${suffix}`));
  } finally {
    snapshot.close();
  }
  assert.deepEqual(directoryState(source.directory), before);
});

test('只有 DB/WAL 的离线副本也能读取 WAL，检查失败不写回源目录', t => {
  const source = createSource(t, { wal: true });
  t.after(() => source.db.close());
  const directory = temporaryDirectory(t);
  const file = path.join(directory, 'offline.sqlite');
  for (const suffix of ['', '-wal']) fs.copyFileSync(`${source.file}${suffix}`, `${file}${suffix}`);
  const before = directoryState(directory);
  const snapshot = openReadonlySqliteSnapshot(file);
  try {
    assert.equal(snapshot.database.prepare('SELECT value FROM sample').get().value, 'committed');
    assert.throws(() => snapshot.database.prepare('SELECT * FROM missing_table').all(), /no such table/);
  } finally {
    snapshot.close();
  }
  assert.equal(fs.existsSync(path.dirname(snapshot.databasePath)), false);
  assert.deepEqual(directoryState(directory), before);
});

test('损坏数据库查询失败仍可清理副本，拒绝符号链接、硬链接及特殊副文件', t => {
  const source = createSource(t);
  source.db.close();
  fs.writeFileSync(source.file, 'invalid sqlite');
  const before = directoryState(source.directory);
  const created = [];
  const mkdtemp = fs.mkdtempSync;
  t.mock.method(fs, 'mkdtempSync', (...args) => {
    const directory = mkdtemp(...args);
    created.push(directory);
    return directory;
  });
  const snapshot = openReadonlySqliteSnapshot(source.file);
  try {
    assert.throws(() => snapshot.database.prepare('SELECT * FROM sqlite_master').all(), /not a database/);
  } finally {
    snapshot.close();
  }
  assert.equal(created.length, 1);
  assert.equal(fs.existsSync(created[0]), false);
  assert.deepEqual(directoryState(source.directory), before);
  const other = path.join(source.directory, 'other.sqlite');
  fs.symlinkSync(source.file, other);
  assert.throws(() => openReadonlySqliteSnapshot(other), /普通文件/);
  fs.unlinkSync(other);
  fs.linkSync(source.file, other);
  assert.throws(() => openReadonlySqliteSnapshot(other), /普通文件/);
  fs.unlinkSync(other);
  fs.mkdirSync(`${source.file}-wal`);
  assert.throws(() => openReadonlySqliteSnapshot(source.file), /普通文件/);
});

test('复制期间源文件变化或副文件出现时停止，不产生可用检查结果', t => {
  const source = createSource(t);
  source.db.close();
  const read = fs.readSync;
  for (const change of [
    () => fs.appendFileSync(source.file, 'changed'),
    () => fs.writeFileSync(`${source.file}-wal`, 'new sidecar')
  ]) {
    const original = fs.readFileSync(source.file);
    const created = [];
    const mkdtemp = fs.mkdtempSync;
    const tempMock = t.mock.method(fs, 'mkdtempSync', (...args) => {
      const directory = mkdtemp(...args);
      created.push(directory);
      return directory;
    });
    let changed = false;
    const readMock = t.mock.method(fs, 'readSync', (...args) => {
      const count = read(...args);
      if (count > 0 && !changed) {
        changed = true;
        change();
      }
      return count;
    });
    assert.throws(() => openReadonlySqliteSnapshot(source.file), /复制期间已变化/);
    assert(created.every(directory => !fs.existsSync(directory)));
    readMock.mock.restore();
    tempMock.mock.restore();
    fs.writeFileSync(source.file, original);
    fs.rmSync(`${source.file}-wal`, { force: true });
  }
});

for (const mode of ['DELETE', 'PERSIST']) {
  test(`${mode} hot journal 不得遗漏：主库副本会泄漏未提交页，快照检查必须拒绝且源目录不变`, t => {
    const root = temporaryDirectory(t);
    const directory = path.join(root, 'source');
    fs.mkdirSync(directory);
    const file = path.join(directory, 'local.sqlite');
    const child = spawnSync(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        `
      import { DatabaseSync } from 'node:sqlite';
      const db = new DatabaseSync(process.argv[1]);
      db.exec('PRAGMA journal_mode = ' + process.argv[2] + '; PRAGMA synchronous = FULL; PRAGMA cache_size = 5; CREATE TABLE sample (id INTEGER PRIMARY KEY, value TEXT); BEGIN IMMEDIATE;');
      const insert = db.prepare('INSERT INTO sample VALUES (?, ?)');
      for (let id = 0; id < 128; id++) insert.run(id, 'committed'.padEnd(3000, 'c'));
      db.exec('COMMIT; BEGIN IMMEDIATE;');
      const update = db.prepare('UPDATE sample SET value = ? WHERE id = ?');
      for (let id = 0; id < 128; id++) update.run('uncommitted'.padEnd(3000, 'u'), id);
      process.kill(process.pid, 'SIGKILL');
    `,
        file,
        mode
      ],
      { encoding: 'utf8' }
    );
    assert.equal(child.signal, 'SIGKILL', child.stderr);
    assert(fs.statSync(`${file}-journal`).size > 512);
    const before = directoryState(directory);
    const incomplete = path.join(root, 'without-journal.sqlite');
    fs.copyFileSync(file, incomplete);
    const incompleteDb = new DatabaseSync(incomplete, { readOnly: true });
    try {
      assert(incompleteDb.prepare("SELECT COUNT(*) AS n FROM sample WHERE value LIKE 'uncommitted%'").get().n > 0);
    } finally {
      incompleteDb.close();
    }
    assert.throws(() => openReadonlySqliteSnapshot(file), /存在回滚日志/);
    assert.deepEqual(directoryState(directory), before);
    // 仅在独立合成副本恢复，证明源 journal 保留的是未提交事务前的已提交内容。
    const recovered = path.join(root, 'recovered.sqlite');
    for (const suffix of ['', '-journal']) fs.copyFileSync(`${file}${suffix}`, `${recovered}${suffix}`);
    const recoveredDb = new DatabaseSync(recovered);
    try {
      assert.equal(recoveredDb.prepare("SELECT COUNT(*) AS n FROM sample WHERE value LIKE 'committed%'").get().n, 128);
      assert.equal(recoveredDb.prepare("SELECT COUNT(*) AS n FROM sample WHERE value LIKE 'uncommitted%'").get().n, 0);
    } finally {
      recoveredDb.close();
    }
    assert.deepEqual(directoryState(directory), before);
  });
}

test('冷 PERSIST 或空回滚日志也保守拒绝，不在来源判断或执行恢复', t => {
  const source = createSource(t);
  source.db.close();
  const writer = new DatabaseSync(source.file);
  writer.exec("PRAGMA journal_mode = PERSIST; UPDATE sample SET value = 'still committed';");
  writer.close();
  assert(fs.existsSync(`${source.file}-journal`));
  const before = directoryState(source.directory);
  assert.throws(() => openReadonlySqliteSnapshot(source.file), /存在回滚日志/);
  assert.deepEqual(directoryState(source.directory), before);
  fs.truncateSync(`${source.file}-journal`);
  const emptyBefore = directoryState(source.directory);
  assert.throws(() => openReadonlySqliteSnapshot(source.file), /存在回滚日志/);
  assert.deepEqual(directoryState(source.directory), emptyBefore);
});

test('复制期间出现回滚日志时拒绝结果并清理临时副本', t => {
  const source = createSource(t);
  source.db.close();
  const created = [];
  const mkdtemp = fs.mkdtempSync;
  t.mock.method(fs, 'mkdtempSync', (...args) => {
    const directory = mkdtemp(...args);
    created.push(directory);
    return directory;
  });
  const read = fs.readSync;
  t.mock.method(fs, 'readSync', (...args) => {
    const count = read(...args);
    fs.writeFileSync(`${source.file}-journal`, 'synthetic new journal');
    return count;
  });
  assert.throws(() => openReadonlySqliteSnapshot(source.file), /存在回滚日志/);
  assert(created.every(directory => !fs.existsSync(directory)));
});

test('禁止副文件模式拒绝现有 WAL/SHM，也拒绝复制期间新出现的副文件', t => {
  const source = createSource(t, { wal: true });
  assert.throws(() => openReadonlySqliteSnapshot(source.file, { allowSidecars: false }), /不接受.*副文件/);
  source.db.close();
  const created = [];
  const mkdtemp = fs.mkdtempSync;
  t.mock.method(fs, 'mkdtempSync', (...args) => {
    const directory = mkdtemp(...args);
    created.push(directory);
    return directory;
  });
  const read = fs.readSync;
  t.mock.method(fs, 'readSync', (...args) => {
    const count = read(...args);
    fs.writeFileSync(`${source.file}-wal`, 'unlisted sidecar');
    return count;
  });
  assert.throws(() => openReadonlySqliteSnapshot(source.file, { allowSidecars: false }), /复制期间已变化/);
  assert(created.every(directory => !fs.existsSync(directory)));
});

test('journal 检查必须夹在文件身份稳定区间内：检查后 spill、末次检查前 rollback 不能夹带未提交页', t => {
  const root = temporaryDirectory(t);
  const directory = path.join(root, 'source');
  fs.mkdirSync(directory);
  const file = path.join(directory, 'local.sqlite');
  const writer = new DatabaseSync(file);
  writer.exec(
    'PRAGMA journal_mode = DELETE; PRAGMA synchronous = FULL; PRAGMA cache_size = 5; CREATE TABLE sample (id INTEGER PRIMARY KEY, value TEXT); BEGIN IMMEDIATE;'
  );
  const insert = writer.prepare('INSERT INTO sample VALUES (?, ?)');
  for (let id = 0; id < 128; id++) insert.run(id, 'committed'.padEnd(3000, 'c'));
  writer.exec('COMMIT');
  const update = writer.prepare('UPDATE sample SET value = ? WHERE id = ?');
  const lstat = fs.lstatSync;
  let checks = 0;
  let inTransaction = false;
  let rolledBack = false;
  t.mock.method(fs, 'lstatSync', (target, ...args) => {
    if (target !== `${file}-journal`) return lstat(target, ...args);
    checks++;
    if (checks === 1) {
      try {
        return lstat(target, ...args);
      } catch (error) {
        assert.equal(error.code, 'ENOENT');
        // 确定性调度：首次 journal 查询确实返回“不存在”，随后真实事务写出未提交页。
        writer.exec('BEGIN IMMEDIATE');
        inTransaction = true;
        for (let id = 0; id < 128; id++) update.run('uncommitted'.padEnd(3000, 'u'), id);
        assert(fs.statSync(target).size > 512);
        throw error;
      }
    }
    if (checks === 2) {
      // 旧顺序已完成最后一次主文件 stat；新顺序则尚未开始最终文件身份校验。
      writer.exec('ROLLBACK');
      inTransaction = false;
      rolledBack = true;
    }
    return lstat(target, ...args);
  });
  const created = [];
  const mkdtemp = fs.mkdtempSync;
  t.mock.method(fs, 'mkdtempSync', (...args) => {
    const temporary = mkdtemp(...args);
    created.push(temporary);
    return temporary;
  });
  let snapshot;
  let leaked = null;
  try {
    assert.throws(() => {
      snapshot = openReadonlySqliteSnapshot(file);
      leaked = snapshot.database.prepare("SELECT COUNT(*) AS n FROM sample WHERE value LIKE 'uncommitted%'").get().n;
    }, /复制期间已变化|存在回滚日志/);
    // 新顺序也可在复制前发现文件身份变化并提早拒绝；由 fixture 回滚其合成写入。
    if (inTransaction) {
      writer.exec('ROLLBACK');
      inTransaction = false;
      rolledBack = true;
    }
    assert.equal(leaked, null);
    assert.equal(rolledBack, true);
    assert.equal(writer.prepare("SELECT COUNT(*) AS n FROM sample WHERE value LIKE 'committed%'").get().n, 128);
    assert(created.every(temporary => !fs.existsSync(temporary)));
  } finally {
    snapshot?.close();
    if (inTransaction) writer.exec('ROLLBACK');
    writer.close();
    t.diagnostic(JSON.stringify({ journalChecks: checks, leakedUncommittedRows: leaked }));
  }
});
