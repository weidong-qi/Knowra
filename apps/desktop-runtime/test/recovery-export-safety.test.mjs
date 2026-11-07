import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import * as locks from '../src/data-directory.mjs';
import { exportLocalRecovery } from '../src/recovery-export.mjs';

const lockModule = new URL('../src/data-directory.mjs', import.meta.url).href;
const recoveryModule = new URL('../src/recovery-export.mjs', import.meta.url).href;

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'knowra-recovery-safety-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const source = path.join(root, 'source');
  fs.mkdirSync(source);
  const db = new DatabaseSync(path.join(source, 'local.sqlite'));
  db.exec(`PRAGMA user_version = 99;
    CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT);
    CREATE TABLE entities (collection TEXT, id TEXT, payload TEXT, revision INTEGER);
    INSERT INTO metadata VALUES ('datasetId', 'synthetic-dataset');`);
  db.prepare('INSERT INTO entities VALUES (?, ?, ?, ?)').run(
    'notes',
    'synthetic-note',
    '{"rawMarkdown":"synthetic note"}',
    1
  );
  db.close();
  fs.mkdirSync(path.join(source, 'uploads'));
  fs.writeFileSync(path.join(source, 'uploads', 'synthetic.txt'), 'synthetic attachment');
  fs.writeFileSync(path.join(source, 'recovery-drafts.json'), 'synthetic damaged draft');
  // 整个调用允许锁造成真实目录时间变化，不通过时间精度碰巧相等来证明零写入。
  fs.utimesSync(source, new Date('2000-01-01'), new Date('2000-01-01'));
  return { root, source, destination: path.join(root, 'export') };
}

function treeState(root, relative = '') {
  const file = path.join(root, relative);
  const stat = fs.lstatSync(file, { bigint: true });
  const record = [relative, stat.ino, stat.mode, stat.size, stat.mtimeNs, stat.ctimeNs];
  return stat.isDirectory()
    ? [
        record,
        ...fs
          .readdirSync(file)
          .sort()
          .flatMap(name => treeState(root, path.join(relative, name)))
      ]
    : [[...record, fs.readFileSync(file)]];
}

function originalFiles(state) {
  return state.filter(([name]) => name && name !== 'runtime.lock' && name !== 'startup.lock');
}

function assertReleased(source) {
  assert.equal(fs.existsSync(path.join(source, 'startup.lock')), false);
  assert.equal(fs.existsSync(path.join(source, 'runtime.lock')), false);
}

function legacyAttempt(source) {
  const result = spawnSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `
    import { lockDataDirectory } from ${JSON.stringify(lockModule)};
    let release;
    try { release = lockDataDirectory(process.argv[1]); console.log(JSON.stringify({ acquired: true })); }
    catch (error) { console.log(JSON.stringify({ acquired: false, message: error.message })); }
    finally { release?.(); }
  `,
      source
    ],
    { encoding: 'utf8', timeout: 5000 }
  );
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

function watchTemporaryDirectories(t) {
  const directories = [];
  const original = fs.mkdtempSync;
  t.mock.method(fs, 'mkdtempSync', function (prefix, ...args) {
    const directory = original.call(this, prefix, ...args);
    if (/knowra-(?:sqlite-inspect|recovery-export)-$/.test(String(prefix))) directories.push(directory);
    return directory;
  });
  return () => directories.forEach(directory => assert.equal(fs.existsSync(directory), false, directory));
}

test('三阶段救援：两锁覆盖整个检查期，旧版和第二个救援均被拒，源目录列表字节mtime完全不变', async t => {
  const { root, source, destination } = fixture(t);
  const original = treeState(source);
  const checkTemporary = watchTemporaryDirectories(t);
  const pending = exportLocalRecovery(source, destination);
  try {
    assert.equal(fs.existsSync(path.join(source, 'startup.lock')), true);
    assert.equal(fs.existsSync(path.join(source, 'runtime.lock')), true);
    const inspection = treeState(source);
    const result = legacyAttempt(source);
    assert.equal(result.acquired, false);
    assert.match(result.message, /正在启动/);
    await assert.rejects(exportLocalRecovery(source, path.join(root, 'second')), /正在启动/);
    assert.deepEqual(treeState(source), inspection);
    const unlink = fs.unlinkSync;
    let boundaryChecked = false;
    t.mock.method(fs, 'unlinkSync', function (file, ...args) {
      if (String(file) === path.join(fs.realpathSync(source), 'runtime.lock')) {
        assert.deepEqual(treeState(source), inspection);
        boundaryChecked = true;
      }
      return unlink.call(this, file, ...args);
    });
    const exported = await pending;
    assert.equal(boundaryChecked, true);
    assert.equal(exported.schemaVersion, 99, '不加载或迁移未来 schema');
    assert.equal(fs.readFileSync(path.join(destination, 'uploads', 'synthetic.txt'), 'utf8'), 'synthetic attachment');
    assert.equal(fs.readFileSync(path.join(destination, 'recovery-drafts.json'), 'utf8'), 'synthetic damaged draft');
    assert.equal(fs.existsSync(path.join(destination, 'manifest.json')), true);
    assert.deepEqual(originalFiles(treeState(source)), originalFiles(original));
    assert.notEqual(treeState(source)[0][4], original[0][4], '协调锁准备/释放确实改变根目录mtime');
    assertReleased(source);
    checkTemporary();
    assert.equal(legacyAttempt(source).acquired, true, '结束后正常启动仍可取锁');
  } finally {
    await pending.catch(() => {});
  }
});

test('专用救援锁持续持有gate并可重复释放，普通锁仍保持旧协议', t => {
  const { source } = fixture(t);
  const release = locks.lockDataDirectoryForRecovery(source);
  const inspection = treeState(source);
  assert.equal(legacyAttempt(source).acquired, false);
  assert.deepEqual(treeState(source), inspection);
  release();
  release();
  assertReleased(source);
  const ordinary = locks.lockDataDirectory(source);
  assert.equal(fs.existsSync(path.join(source, 'startup.lock')), false);
  ordinary();
});

test('拒绝源内、源根、源别名目标和源目录别名，验证失败前不创建协调锁', async t => {
  const { root, source } = fixture(t);
  const alias = path.join(root, 'source-alias');
  fs.symlinkSync(source, alias, 'dir');
  const before = treeState(source);
  for (const destination of [
    source,
    path.join(source, 'nested'),
    path.join(source, 'uploads', 'nested'),
    path.join(alias, 'nested')
  ])
    await assert.rejects(exportLocalRecovery(source, destination), /源资料目录之外|符号链接|变化/);
  await assert.rejects(exportLocalRecovery(alias, path.join(root, 'external')), /符号链接|变化/);
  assert.deepEqual(treeState(source), before);
});

test('拒绝不存在的目标父目录，不在源或外部静默创建父目录', async t => {
  const { root, source } = fixture(t);
  const before = treeState(source);
  await assert.rejects(exportLocalRecovery(source, path.join(root, 'missing-parent', 'export')), /ENOENT/);
  assert.equal(fs.existsSync(path.join(root, 'missing-parent')), false);
  assert.deepEqual(treeState(source), before);
});

test('已存在目标及悬空链接不覆盖，不触源锁', async t => {
  const { root, source, destination } = fixture(t);
  fs.mkdirSync(destination);
  fs.writeFileSync(path.join(destination, 'sentinel'), 'preserve');
  const before = treeState(source);
  await assert.rejects(exportLocalRecovery(source, destination), /已存在/);
  fs.symlinkSync(path.join(root, 'missing'), path.join(root, 'dangling'));
  await assert.rejects(exportLocalRecovery(source, path.join(root, 'dangling')), /已存在/);
  assert.equal(fs.readFileSync(path.join(destination, 'sentinel'), 'utf8'), 'preserve');
  assert.deepEqual(treeState(source), before);
});

test('临时目录指向源内部时在准备前拒绝，避免副本写回源', async t => {
  const { source, destination } = fixture(t);
  t.mock.method(os, 'tmpdir', () => source);
  const before = treeState(source);
  await assert.rejects(exportLocalRecovery(source, destination), /临时目录.*之外/);
  assert.deepEqual(treeState(source), before);
});

test('冷回滚journal同样保守拒绝，保留原文件并清理私有副本和两锁', async t => {
  const { source, destination } = fixture(t);
  fs.writeFileSync(path.join(source, 'local.sqlite-journal'), '');
  const before = treeState(source);
  const checkTemporary = watchTemporaryDirectories(t);
  await assert.rejects(exportLocalRecovery(source, destination), /回滚日志/);
  assert.deepEqual(originalFiles(treeState(source)), originalFiles(before));
  assert.equal(fs.existsSync(destination), false);
  assertReleased(source);
  checkTemporary();
});

test('无效SQLite打开失败时不写原件、不留临时副本或协调锁', async t => {
  const { source, destination } = fixture(t);
  fs.writeFileSync(path.join(source, 'local.sqlite'), 'not a sqlite database');
  const before = treeState(source);
  const checkTemporary = watchTemporaryDirectories(t);
  await assert.rejects(exportLocalRecovery(source, destination));
  assert.deepEqual(originalFiles(treeState(source)), originalFiles(before));
  assert.equal(fs.existsSync(destination), false);
  assertReleased(source);
  checkTemporary();
});

test('源目录缺少数据库时失败清理两锁，不创建目标', async t => {
  const { source, destination } = fixture(t);
  fs.unlinkSync(path.join(source, 'local.sqlite'));
  const before = treeState(source);
  await assert.rejects(exportLocalRecovery(source, destination), /数据库不存在/);
  assert.deepEqual(originalFiles(treeState(source)), originalFiles(before));
  assert.equal(fs.existsSync(destination), false);
  assertReleased(source);
});

test('目标写入中途失败只清理本次产物、私有副本和协调锁', async t => {
  const { source, destination } = fixture(t);
  const before = treeState(source);
  const checkTemporary = watchTemporaryDirectories(t);
  const write = fs.writeFileSync;
  t.mock.method(fs, 'writeFileSync', function (file, bytes, ...args) {
    if (typeof file === 'number' && Buffer.isBuffer(bytes) && bytes.toString() === 'synthetic attachment')
      throw new Error('synthetic output failure');
    return write.call(this, file, bytes, ...args);
  });
  await assert.rejects(exportLocalRecovery(source, destination), /synthetic output failure/);
  assert.equal(fs.existsSync(destination), false);
  assert.deepEqual(originalFiles(treeState(source)), originalFiles(before));
  assertReleased(source);
  checkTemporary();
});

test('异步检查期间被抢占的目标目录保持原状，禁止覆盖或递归删除', async t => {
  const { source, destination } = fixture(t);
  const before = treeState(source);
  const pending = exportLocalRecovery(source, destination);
  try {
    fs.mkdirSync(destination);
    fs.writeFileSync(path.join(destination, 'sentinel'), 'other owner');
    await assert.rejects(pending, /EEXIST/);
    assert.equal(fs.readFileSync(path.join(destination, 'sentinel'), 'utf8'), 'other owner');
    assert.deepEqual(originalFiles(treeState(source)), originalFiles(before));
    assertReleased(source);
  } finally {
    await pending.catch(() => {});
  }
});

test('目标父目录被换成源别名时停止发布且不写源', async t => {
  const { root, source } = fixture(t);
  const parent = path.join(root, 'parent');
  fs.mkdirSync(parent);
  const pending = exportLocalRecovery(source, path.join(parent, 'export'));
  const before = treeState(source);
  fs.renameSync(parent, `${parent}-original`);
  fs.symlinkSync(source, parent, 'dir');
  await assert.rejects(pending, /变化/);
  assert.deepEqual(originalFiles(treeState(source)), originalFiles(before));
  assert.equal(fs.existsSync(path.join(source, 'export')), false);
  assertReleased(source);
});

test('输出目录被换成源别名时不删替换物或原资料，不发布完整清单', async t => {
  const { source, destination } = fixture(t);
  const before = treeState(source);
  const write = fs.writeFileSync;
  let replaced = false;
  t.mock.method(fs, 'writeFileSync', function (file, bytes, ...args) {
    const result = write.call(this, file, bytes, ...args);
    if (
      !replaced &&
      typeof file === 'number' &&
      Buffer.isBuffer(bytes) &&
      bytes.subarray(0, 16).toString() === 'SQLite format 3\0'
    ) {
      replaced = true;
      fs.renameSync(destination, `${destination}-original`);
      fs.symlinkSync(source, destination, 'dir');
    }
    return result;
  });
  await assert.rejects(exportLocalRecovery(source, destination), /变化/);
  assert.equal(replaced, true);
  assert.equal(fs.lstatSync(destination).isSymbolicLink(), true);
  assert.equal(fs.existsSync(path.join(`${destination}-original`, 'manifest.json')), false);
  assert.deepEqual(originalFiles(treeState(source)), originalFiles(before));
  assertReleased(source);
});

test('外部写入源文件或只改变目录mtime都拒绝成功结论，并保留变化现场', async t => {
  for (const mutation of ['file', 'directory']) {
    const { source, destination } = fixture(t);
    const pending = exportLocalRecovery(source, destination);
    if (mutation === 'file') fs.writeFileSync(path.join(source, 'uploads', 'synthetic.txt'), 'external modification');
    else {
      const transient = path.join(source, 'uploads', 'transient');
      fs.mkdirSync(transient);
      fs.rmdirSync(transient);
    }
    await assert.rejects(pending, /变化/);
    if (mutation === 'file')
      assert.equal(fs.readFileSync(path.join(source, 'uploads', 'synthetic.txt'), 'utf8'), 'external modification');
    assert.equal(fs.existsSync(destination), false);
    assertReleased(source);
  }
});

test('现有live或损坏runtime锁均保留；遗留startup gate不自动删除', async t => {
  const { source, destination } = fixture(t);
  const runtime = path.join(source, 'runtime.lock');
  for (const contents of [JSON.stringify({ pid: process.pid, token: 'another-owner' }), 'unverifiable']) {
    fs.writeFileSync(runtime, contents);
    await assert.rejects(exportLocalRecovery(source, destination), /已被使用|无法验证/);
    assert.equal(fs.readFileSync(runtime, 'utf8'), contents);
    assert.equal(fs.existsSync(path.join(source, 'startup.lock')), false);
  }
  fs.unlinkSync(runtime);
  fs.mkdirSync(path.join(source, 'startup.lock'));
  const before = treeState(source);
  await assert.rejects(exportLocalRecovery(source, destination), /正在启动/);
  assert.deepEqual(treeState(source), before);
});

test('可验证的死进程runtime锁只在准备阶段恢复，导出结束释放自己的两锁', async t => {
  const { source, destination } = fixture(t);
  const child = spawnSync(process.execPath, ['-e', ''], { timeout: 5000 });
  assert.equal(child.status, 0);
  fs.writeFileSync(path.join(source, 'runtime.lock'), JSON.stringify({ pid: child.pid, token: 'stale-owner' }));
  const before = treeState(source);
  await exportLocalRecovery(source, destination);
  assert.deepEqual(originalFiles(treeState(source)), originalFiles(before));
  assertReleased(source);
});

test('释放救援lease不删除替换gate或另一owner的runtime锁', t => {
  const { source } = fixture(t);
  const release = locks.lockDataDirectoryForRecovery(source);
  const runtime = path.join(source, 'runtime.lock');
  const other = JSON.stringify({ pid: process.pid, token: 'replacement-owner' });
  fs.writeFileSync(runtime, other);
  fs.renameSync(path.join(source, 'startup.lock'), path.join(source, 'owned-gate'));
  fs.mkdirSync(path.join(source, 'startup.lock'));
  fs.writeFileSync(path.join(source, 'startup.lock', 'sentinel'), 'other gate');
  assert.throws(release, /协调锁已被替换/);
  assert.equal(fs.readFileSync(runtime, 'utf8'), other);
  assert.equal(fs.readFileSync(path.join(source, 'startup.lock', 'sentinel'), 'utf8'), 'other gate');
});

test('准备后进程被杀时保留锁并拒绝旧版重入，不猜测清理遗留gate', async t => {
  const { source, destination } = fixture(t);
  const child = spawn(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `
    import fs from 'node:fs';
    import { exportLocalRecovery } from ${JSON.stringify(recoveryModule)};
    const original = fs.mkdtempSync;
    const created = [];
    fs.mkdtempSync = function(prefix, ...args) {
      if (String(prefix).endsWith('knowra-recovery-export-')) {
        console.log(JSON.stringify({ ready: 'inspection-ready', created }));
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
      }
      const directory = original.call(this, prefix, ...args);
      created.push(directory);
      return directory;
    };
    await exportLocalRecovery(process.argv[1], process.argv[2]);
  `,
      source,
      destination
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] }
  );
  t.after(() => {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  });
  const ready = await Promise.race([
    once(child.stdout, 'data').then(([bytes]) => bytes.toString()),
    once(child, 'exit').then(([code]) => {
      throw new Error(`child exited before inspection: ${code}`);
    }),
    new Promise((_, reject) => {
      const timer = setTimeout(() => reject(new Error('child readiness timeout')), 5000);
      timer.unref();
    })
  ]);
  assert.match(ready, /inspection-ready/);
  const created = JSON.parse(ready).created;
  t.after(() => created.forEach(directory => fs.rmSync(directory, { recursive: true, force: true })));
  const before = treeState(source);
  child.kill('SIGKILL');
  await once(child, 'exit');
  assert.equal(legacyAttempt(source).acquired, false);
  assert.deepEqual(treeState(source), before);
  assert.equal(fs.existsSync(destination), false);
  // 合成fixture的事后清理会删除遗留锁；生产路径不自动处理遗留startup gate。
});

test('大小写目录别名不能把导出或临时文件写回源（目录身份校验）', async t => {
  const { root, source, destination } = fixture(t);
  const alias = path.join(root, 'SOURCE');
  if (!fs.existsSync(alias)) {
    t.skip('当前文件系统大小写敏感，不存在该别名');
    return;
  }
  const before = treeState(source);
  await assert.rejects(exportLocalRecovery(source, path.join(alias, 'export')), /源资料目录之外/);
  t.mock.method(os, 'tmpdir', () => alias);
  await assert.rejects(exportLocalRecovery(source, destination), /临时目录.*之外/);
  assert.deepEqual(treeState(source), before);
});

test('runtime锁被替换为同token的文件或符号链接时释放不删除替换物', t => {
  for (const kind of ['file', 'symlink']) {
    const { source } = fixture(t);
    const release = locks.lockDataDirectoryForRecovery(source);
    const runtime = path.join(source, 'runtime.lock');
    const contents = fs.readFileSync(runtime);
    fs.renameSync(runtime, `${runtime}-original`);
    if (kind === 'file') fs.writeFileSync(runtime, contents);
    else fs.symlinkSync(`${runtime}-original`, runtime);
    assert.throws(release, /运行协调锁已被替换/);
    assert.equal(fs.lstatSync(runtime).isSymbolicLink(), kind === 'symlink');
    assert.equal(fs.readFileSync(runtime).equals(contents), true);
    assert.equal(fs.existsSync(path.join(source, 'startup.lock')), false);
  }
});

test('救援临时目录被替换时失败保留替换目录和未知文件', async t => {
  const { source, destination } = fixture(t);
  const original = fs.mkdtempSync;
  let temporary;
  t.mock.method(fs, 'mkdtempSync', function (prefix, ...args) {
    const directory = original.call(this, prefix, ...args);
    if (String(prefix).endsWith('knowra-recovery-export-')) temporary = directory;
    return directory;
  });
  const pending = exportLocalRecovery(source, destination);
  try {
    assert(temporary);
    fs.renameSync(temporary, `${temporary}-original`);
    fs.mkdirSync(temporary);
    fs.writeFileSync(path.join(temporary, 'not-owned.txt'), 'preserve foreign file');
    t.after(() => {
      fs.rmSync(temporary, { recursive: true, force: true });
      fs.rmSync(`${temporary}-original`, { recursive: true, force: true });
    });
    await assert.rejects(pending, /临时目录或文件已变化|disk I\/O error/);
    assert.equal(fs.readFileSync(path.join(temporary, 'not-owned.txt'), 'utf8'), 'preserve foreign file');
    assert.equal(fs.existsSync(destination), false);
    assertReleased(source);
  } finally {
    await pending.catch(() => {});
  }
});

test('输出出现未知文件时拒绝完整清单并保留未知条目，不递归清理他人产物', async t => {
  const { source, destination } = fixture(t);
  const before = treeState(source);
  const write = fs.writeFileSync;
  let injected = false;
  t.mock.method(fs, 'writeFileSync', function (file, bytes, ...args) {
    const result = write.call(this, file, bytes, ...args);
    if (
      !injected &&
      typeof file === 'number' &&
      Buffer.isBuffer(bytes) &&
      bytes.subarray(0, 16).toString() === 'SQLite format 3\0'
    ) {
      injected = true;
      write(path.join(destination, 'foreign.txt'), 'preserve other owner');
    }
    return result;
  });
  await assert.rejects(exportLocalRecovery(source, destination), /变化/);
  assert.equal(injected, true);
  assert.equal(fs.readFileSync(path.join(destination, 'foreign.txt'), 'utf8'), 'preserve other owner');
  assert.equal(fs.existsSync(path.join(destination, 'manifest.json')), false);
  assert.deepEqual(originalFiles(treeState(source)), originalFiles(before));
  assertReleased(source);
});

test('清单写完才发现外部源变化时撤销自有清单，仍保留未知输出条目', async t => {
  const { source, destination } = fixture(t);
  const write = fs.writeFileSync;
  let injected = false;
  t.mock.method(fs, 'writeFileSync', function (file, bytes, ...args) {
    const result = write.call(this, file, bytes, ...args);
    if (
      !injected &&
      typeof file === 'number' &&
      Buffer.isBuffer(bytes) &&
      bytes.toString().includes('"createdAt"') &&
      bytes.toString().includes('"files"')
    ) {
      injected = true;
      write(path.join(destination, 'foreign.txt'), 'preserve other owner');
      write(path.join(source, 'external-change.txt'), 'preserve source change');
    }
    return result;
  });
  await assert.rejects(exportLocalRecovery(source, destination), /变化/);
  assert.equal(injected, true);
  assert.equal(fs.readFileSync(path.join(destination, 'foreign.txt'), 'utf8'), 'preserve other owner');
  assert.equal(fs.existsSync(path.join(destination, 'manifest.json')), false);
  assert.equal(fs.readFileSync(path.join(source, 'external-change.txt'), 'utf8'), 'preserve source change');
  assertReleased(source);
});

test('准备阶段写入runtime锁失败只清理本次未完成的锁，保留源资料', async t => {
  const { source, destination } = fixture(t);
  const before = treeState(source);
  const write = fs.writeFileSync;
  t.mock.method(fs, 'writeFileSync', function (file, bytes, ...args) {
    if (typeof file === 'number' && typeof bytes === 'string' && bytes.includes('"pid"') && bytes.includes('"token"'))
      throw new Error('synthetic lock write failure');
    return write.call(this, file, bytes, ...args);
  });
  await assert.rejects(exportLocalRecovery(source, destination), /synthetic lock write failure/);
  assertReleased(source);
  assert.deepEqual(originalFiles(treeState(source)), originalFiles(before));
  assert.equal(fs.existsSync(destination), false);
});

test('损坏uploads是普通文件时仍保留原始字节，不把目录结构损坏变成静默丢失', async t => {
  const { source, destination } = fixture(t);
  fs.unlinkSync(path.join(source, 'uploads', 'synthetic.txt'));
  fs.rmdirSync(path.join(source, 'uploads'));
  fs.writeFileSync(path.join(source, 'uploads'), 'synthetic damaged uploads bytes');
  const before = treeState(source);
  await exportLocalRecovery(source, destination);
  assert.equal(fs.readFileSync(path.join(destination, 'uploads'), 'utf8'), 'synthetic damaged uploads bytes');
  assert.deepEqual(originalFiles(treeState(source)), originalFiles(before));
  assertReleased(source);
});
