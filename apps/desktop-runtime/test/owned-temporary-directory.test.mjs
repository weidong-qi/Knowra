import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { createOwnedTemporaryDirectory } from '../src/owned-temporary-directory.mjs';
import { openReadonlySqliteSnapshot } from '../src/sqlite-readonly-snapshot.mjs';
import { DatabaseSync } from 'node:sqlite';

function fixture(t) {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'knowra-owned-temporary-test-'));
  t.after(() => fs.rmSync(parent, { recursive: true, force: true }));
  const temporary = createOwnedTemporaryDirectory('owned-', parent);
  const file = path.join(temporary.directory, 'owned.txt');
  const fd = fs.openSync(file, 'wx', 0o600);
  try {
    temporary.record('owned.txt', fs.fstatSync(fd));
    fs.writeFileSync(fd, 'owned');
  } finally {
    fs.closeSync(fd);
  }
  return { parent, temporary, file };
}

test('私有目录仅清理已登记的自有文件，内容改变不影响SQLite合法写入后的清理', t => {
  const { temporary, file } = fixture(t);
  fs.appendFileSync(file, ' updated by SQLite');
  assert.equal(temporary.cleanup(), true);
  assert.equal(fs.existsSync(temporary.directory), false);
});

test('私有目录根被替换后不删除替换目录及文件', t => {
  const { temporary } = fixture(t);
  fs.renameSync(temporary.directory, `${temporary.directory}-original`);
  fs.mkdirSync(temporary.directory);
  const foreign = path.join(temporary.directory, 'foreign');
  fs.writeFileSync(foreign, 'keep');
  assert.equal(temporary.cleanup(), false);
  assert.equal(fs.readFileSync(foreign, 'utf8'), 'keep');
});

test('私有文件被替换或目录出现未知条目时保留全部现场', t => {
  for (const kind of ['replacement', 'unknown']) {
    const { temporary, file } = fixture(t);
    if (kind === 'replacement') {
      fs.renameSync(file, `${file}-original`);
      fs.writeFileSync(file, 'foreign replacement');
      fs.unlinkSync(`${file}-original`);
    } else fs.writeFileSync(path.join(temporary.directory, 'unknown.txt'), 'foreign addition');
    assert.equal(temporary.cleanup(), false);
    assert.equal(fs.existsSync(file), true);
  }
});

test('私有目录父路径被换成别名时不沿替换路径清理', t => {
  const { parent, temporary } = fixture(t);
  const moved = `${parent}-moved`;
  fs.renameSync(parent, moved);
  t.after(() => fs.rmSync(moved, { recursive: true, force: true }));
  fs.mkdirSync(parent);
  const replacement = path.join(parent, path.basename(temporary.directory));
  fs.mkdirSync(replacement);
  fs.writeFileSync(path.join(replacement, 'foreign'), 'keep');
  assert.equal(temporary.cleanup(), false);
  assert.equal(fs.readFileSync(path.join(replacement, 'foreign'), 'utf8'), 'keep');
});

test('SQLite快照关闭不递归删除被替换的临时目录', t => {
  const { parent, temporary } = fixture(t);
  temporary.cleanup();
  const source = path.join(parent, 'synthetic.sqlite');
  const database = new DatabaseSync(source);
  database.exec('CREATE TABLE synthetic (value TEXT)');
  database.close();
  const snapshot = openReadonlySqliteSnapshot(source);
  const directory = path.dirname(snapshot.databasePath);
  fs.renameSync(directory, `${directory}-original`);
  fs.mkdirSync(directory);
  fs.writeFileSync(path.join(directory, 'foreign'), 'keep');
  t.after(() => {
    fs.rmSync(directory, { recursive: true, force: true });
    fs.rmSync(`${directory}-original`, { recursive: true, force: true });
  });
  snapshot.close();
  assert.equal(fs.readFileSync(path.join(directory, 'foreign'), 'utf8'), 'keep');
});

test('私有文件身份改变后check/read拒绝跟随替换文件或符号链接', t => {
  for (const kind of ['file', 'symlink']) {
    const { parent, temporary, file } = fixture(t);
    const foreign = path.join(parent, 'foreign.txt');
    fs.writeFileSync(foreign, 'foreign content must not be exported');
    fs.renameSync(file, `${file}-owned`);
    if (kind === 'file') fs.writeFileSync(file, 'replacement');
    else fs.symlinkSync(foreign, file);
    assert.throws(() => temporary.check(), /临时目录或文件已变化/);
    assert.throws(() => temporary.read('owned.txt'), /临时目录或文件已变化/);
    assert.equal(temporary.cleanup(), false);
    assert.equal(fs.readFileSync(foreign, 'utf8'), 'foreign content must not be exported');
  }
});
