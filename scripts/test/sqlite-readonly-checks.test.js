import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { createPersistedLocalDocument } from '../../apps/api/src/infrastructure/local-data-schema.js';
import { createRuntimeBackup, inspectRuntimeBackup } from '../../apps/desktop-runtime/src/backup.mjs';
import { exportLocalRecovery } from '../../apps/desktop-runtime/src/recovery-export.mjs';
import { createNote, openWorkspace, temporaryDirectory } from '../../apps/desktop-runtime/test/helpers.mjs';
import { measureManagedFiles, measureSqliteStorage } from '../asset-storage-metrics.mjs';
import { readRetirementSource, readRetirementInspection } from '../inline-annotation-retirement-source.mjs';
import { prepareV1AnnotationMaintenance } from '../prepare-v1-annotation-maintenance.mjs';

function treeState(directory, relative = '') {
  const file = path.join(directory, relative);
  const stat = fs.statSync(file, { bigint: true });
  return stat.isDirectory()
    ? [
        [relative, stat.mtimeNs],
        ...fs
          .readdirSync(file)
          .sort()
          .flatMap(name => treeState(directory, path.join(relative, name)))
      ]
    : [[relative, stat.mtimeNs, fs.readFileSync(file)]];
}

function sourceFixture(t, directory) {
  const workspace = openWorkspace(directory);
  t.after(() => workspace.store.close());
  const note = createNote(workspace, '合成 WAL 中尚未 checkpoint 的正文');
  assert(fs.statSync(path.join(directory, 'local.sqlite-wal')).size > 0);
  return { workspace, note, sourcePath: path.join(directory, 'local.sqlite') };
}

test('统计、两种退役检查、维护预检只读取临时快照，原目录列表、字节和 mtime 完全不变', async t => {
  const root = temporaryDirectory(t);
  const directory = path.join(root, 'source');
  const f = sourceFixture(t, directory);
  const cloudSource = path.join(root, 'cloud.json');
  fs.writeFileSync(cloudSource, JSON.stringify(createPersistedLocalDocument(f.workspace.store.state)));
  const before = treeState(directory);
  const cloudBefore = treeState(root).filter(([name]) => name === 'cloud.json');
  const files = measureManagedFiles({
    uploadsDir: path.join(directory, 'uploads'),
    tempDir: path.join(root, 'temp'),
    exportsDir: path.join(root, 'exports'),
    backupsDir: path.join(root, 'backups')
  });
  assert.equal(measureSqliteStorage({ sourcePath: f.sourcePath, files }).content.versionCount, 1);
  assert.deepEqual(treeState(directory), before);
  assert.equal((await readRetirementSource('sqlite', f.sourcePath)).notes[0].rawMarkdown, f.note.rawMarkdown);
  assert.deepEqual(treeState(directory), before);
  assert.equal((await readRetirementInspection('sqlite', f.sourcePath)).state.notes[0].rawMarkdown, f.note.rawMarkdown);
  assert.deepEqual(treeState(directory), before);
  const outputDirectory = path.join(root, 'maintenance');
  await prepareV1AnnotationMaintenance({ cloudSource, localRoot: directory, outputDirectory });
  assert.equal(
    (await readRetirementSource('sqlite', path.join(outputDirectory, 'local.sqlite'))).notes[0].rawMarkdown,
    f.note.rawMarkdown
  );
  assert.deepEqual(treeState(directory), before);
  assert.deepEqual(
    treeState(root).filter(([name]) => name === 'cloud.json'),
    cloudBefore
  );
});

test('新备份发布前检查和已有备份检查不生成源 WAL/SHM，不修改源文件 mtime', t => {
  const root = temporaryDirectory(t);
  const f = sourceFixture(t, path.join(root, 'source'));
  let originalDatabase;
  const backup = createRuntimeBackup(
    {
      getStatus: () => f.workspace.store.getStatus(),
      backupTo(destination) {
        f.workspace.store.backupTo(destination);
        const db = new DatabaseSync(destination);
        db.exec('PRAGMA journal_mode = WAL');
        db.close();
        originalDatabase = treeState(path.dirname(destination)).filter(([name]) => name.startsWith('local.sqlite'));
      }
    },
    path.join(root, 'source'),
    { backupRoot: path.join(root, 'backups') }
  );
  assert.deepEqual(
    treeState(backup).filter(([name]) => name.startsWith('local.sqlite')),
    originalDatabase
  );
  const before = treeState(backup);
  assert.equal(inspectRuntimeBackup(backup).noteCount, 1);
  assert.deepEqual(treeState(backup), before);
});

test('救援导出保留根目录互斥锁语义，嵌套活动 SQLite 目录零写入并保留 WAL 数据', async t => {
  const root = temporaryDirectory(t);
  const dataDirectory = path.join(root, 'data');
  const relative = 'restored/00000000-0000-0000-0000-000000000000';
  const active = path.join(dataDirectory, relative);
  const f = sourceFixture(t, active);
  fs.writeFileSync(
    path.join(dataDirectory, 'active-dataset.json'),
    JSON.stringify({ version: 1, directory: relative })
  );
  const before = treeState(active);
  const destination = path.join(root, 'recovery');
  await exportLocalRecovery(dataDirectory, destination);
  assert.deepEqual(treeState(active), before);
  const payload = JSON.parse(fs.readFileSync(path.join(destination, 'recovery.json'), 'utf8'));
  const row = payload.tables.entities.find(row => row.collection === 'notes' && row.id === f.note.id);
  assert.equal(JSON.parse(row.payload).rawMarkdown, f.note.rawMarkdown);
  assert.equal(fs.existsSync(path.join(dataDirectory, 'runtime.lock')), false);
  assert.equal(fs.existsSync(path.join(dataDirectory, 'startup.lock')), false);
});

test('已知边界：SQLite 位于根目录时，救援导出仍需要原有 runtime.lock，不能宣称整目录零写入', async t => {
  const root = temporaryDirectory(t);
  const directory = path.join(root, 'source');
  sourceFixture(t, directory);
  const past = new Date('2000-01-01T00:00:00Z');
  fs.utimesSync(directory, past, past);
  const before = treeState(directory);
  const pending = exportLocalRecovery(directory, path.join(root, 'recovery'));
  assert.equal(fs.existsSync(path.join(directory, 'runtime.lock')), true);
  await pending;
  assert.equal(fs.existsSync(path.join(directory, 'runtime.lock')), false);
  const after = treeState(directory);
  assert.notEqual(after[0][1], before[0][1], '既有互斥锁会改变源根目录的 mtime');
  assert.deepEqual(after.slice(1), before.slice(1), 'SQLite 及所有既有文件的列表、mtime 和字节仍不变');
});

test('备份清单校验后注入的 WAL/SHM 不能参与检查，即使主库字节仍与清单一致', t => {
  const root = temporaryDirectory(t);
  const f = sourceFixture(t, path.join(root, 'source'));
  const backup = createRuntimeBackup(
    {
      getStatus: () => f.workspace.store.getStatus(),
      backupTo(destination) {
        f.workspace.store.backupTo(destination);
        const db = new DatabaseSync(destination);
        db.exec('PRAGMA journal_mode = WAL');
        db.close();
      }
    },
    path.join(root, 'source'),
    { backupRoot: path.join(root, 'backups') }
  );
  const databaseFile = path.join(backup, 'local.sqlite');
  const before = fs.readFileSync(databaseFile);
  const beforeMtime = fs.statSync(databaseFile, { bigint: true }).mtimeNs;
  const forged = path.join(root, 'forged.sqlite');
  fs.copyFileSync(databaseFile, forged);
  const writer = new DatabaseSync(forged);
  try {
    writer.exec(
      "PRAGMA wal_autocheckpoint = 0; UPDATE metadata SET value = 'untrusted-wal-dataset' WHERE key = 'datasetId';"
    );
    assert.deepEqual(fs.readFileSync(forged), before, '攻击副本只修改 WAL，主文件仍与清单认证字节一致');
    const lstat = fs.lstatSync;
    let injected = false;
    t.mock.method(fs, 'lstatSync', (file, options) => {
      // inventory/manifest 校验已完成；下一次 bigint stat 是 helper 开始复制来源。
      if (!injected && file === databaseFile && options?.bigint === true) {
        injected = true;
        for (const suffix of ['-wal', '-shm']) fs.copyFileSync(`${forged}${suffix}`, `${databaseFile}${suffix}`);
      }
      return lstat(file, options);
    });
    const open = fs.openSync;
    const openedSidecars = [];
    t.mock.method(fs, 'openSync', (file, ...args) => {
      if ([`${databaseFile}-wal`, `${databaseFile}-shm`].includes(file)) openedSidecars.push(file);
      return open(file, ...args);
    });
    assert.throws(() => inspectRuntimeBackup(backup), /不接受.*副文件/);
    assert.equal(injected, true);
    assert.deepEqual(openedSidecars, [], '未经清单认证的副文件不得被读取');
    assert.deepEqual(fs.readFileSync(databaseFile), before);
    assert.equal(fs.statSync(databaseFile, { bigint: true }).mtimeNs, beforeMtime);
  } finally {
    writer.close();
  }
});
