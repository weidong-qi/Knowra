import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { createSqliteDataStore } from '../src/sqlite-data-store.mjs';
import { createRuntimeBackup, restoreRuntimeBackup } from '../src/backup.mjs';
import { createNote, openWorkspace, removeAiTablesForLegacyFixture, temporaryDirectory } from './helpers.mjs';

test('schema 1 升级前备份，保留设备、正文和未确认队列', t => {
  const root = temporaryDirectory(t);
  let workspace = openWorkspace(root);
  const note = createNote(workspace, '升级前未同步正文');
  const deviceId = workspace.store.getStatus().deviceId;
  const outbox = workspace.store.readOutbox();
  workspace.store.close();
  const old = new DatabaseSync(path.join(root, 'local.sqlite'));
  removeAiTablesForLegacyFixture(old);
  old.exec('DROP TABLE sync_uploads; DROP TABLE sync_conflicts; DROP TABLE sync_recovery; PRAGMA user_version = 1;');
  old.close();
  workspace = openWorkspace(root);
  assert.equal(workspace.store.getStatus().deviceId, deviceId);
  assert.deepEqual(workspace.store.readOutbox(), outbox);
  assert.equal(workspace.knowledge.noteService.getNote(note.id).rawMarkdown, '升级前未同步正文');
  assert(fs.readdirSync(root).some(name => name.startsWith('local.sqlite.before-v2-')));
  workspace.store.close();
});

test('正文、不可变版本和 outbox 原子提交，重启恢复稳定 ID、修订和操作 ID', t => {
  const root = temporaryDirectory(t);
  let workspace = openWorkspace(root);
  const note = createNote(workspace);
  const beforeCount = workspace.store.readOutbox().length;
  workspace.knowledge.noteService.updateNote(note.id, {
    rawMarkdown: '离线修改\n中文内容',
    expectedUpdatedAt: note.updatedAt
  });
  const operations = workspace.store.readOutbox();
  assert.equal(operations.length, beforeCount + 1);
  const last = operations.at(-1);
  assert(last.changes.some(change => change.collection === 'notes' && change.value.rawMarkdown.includes('中文内容')));
  assert(last.changes.some(change => change.collection === 'noteVersions'));
  const deviceId = workspace.store.getStatus().deviceId;
  workspace.store.close();
  workspace = openWorkspace(root);
  assert.equal(workspace.knowledge.noteService.getNote(note.id).rawMarkdown, '离线修改\n中文内容');
  assert.deepEqual(workspace.store.readOutbox(), operations);
  assert.equal(workspace.store.getStatus().deviceId, deviceId);
  workspace.store.close();
});

test('提交故障同时回滚正文、版本及队列，原 repository 引用仍可继续保存', t => {
  const root = temporaryDirectory(t);
  let fail = false;
  const workspace = openWorkspace(root, {
    beforeCommit: () => {
      if (fail) throw new Error('模拟磁盘写入失败');
    }
  });
  const note = createNote(workspace);
  const snapshot = workspace.store.exportSnapshot().data;
  const queue = workspace.store.readOutbox();
  fail = true;
  assert.throws(() => workspace.knowledge.noteService.updateNote(note.id, { rawMarkdown: '不能提交' }), /模拟磁盘/);
  assert.deepEqual(workspace.store.exportSnapshot().data, snapshot);
  assert.deepEqual(workspace.store.readOutbox(), queue);
  fail = false;
  workspace.knowledge.noteService.updateNote(note.id, { rawMarkdown: '恢复保存' });
  workspace.store.close();
  const restored = openWorkspace(root);
  assert.equal(restored.knowledge.noteService.getNote(note.id).rawMarkdown, '恢复保存');
  restored.store.close();
});

test('连续编辑形成有依赖的不可变操作，无变化保存不产生队列', t => {
  const workspace = openWorkspace(temporaryDirectory(t));
  const note = createNote(workspace);
  const initial = workspace.store.readOutbox();
  workspace.store.runTransaction(() => {});
  assert.deepEqual(workspace.store.readOutbox(), initial);
  workspace.knowledge.noteService.updateNote(note.id, { rawMarkdown: '第二版' });
  const second = workspace.store.readOutbox().at(-1);
  workspace.knowledge.noteService.updateNote(note.id, { rawMarkdown: '第三版' });
  const third = workspace.store.readOutbox().at(-1);
  assert(third.dependencies.includes(second.operationId));
  assert.equal(second.changes.find(item => item.collection === 'notes').localRevision, 2);
  assert.equal(third.changes.find(item => item.collection === 'notes').localRevision, 3);
  assert.equal(second.changes.find(item => item.collection === 'notes').value.rawMarkdown, '第二版');
  workspace.store.close();
});

test('备份恢复包含队列与附件文件，损坏清单和已有目标均拒绝恢复', t => {
  const root = temporaryDirectory(t);
  const workspace = openWorkspace(path.join(root, 'source'));
  createNote(workspace);
  fs.mkdirSync(path.join(root, 'source', 'uploads'), { recursive: true });
  fs.writeFileSync(path.join(root, 'source', 'uploads', 'sample.txt'), '附件恢复样本');
  const queue = workspace.store.readOutbox();
  const backup = createRuntimeBackup(workspace.store, path.join(root, 'source'));
  workspace.store.close();
  const destination = path.join(root, 'restored');
  restoreRuntimeBackup(backup, destination);
  const restored = openWorkspace(destination);
  assert.deepEqual(restored.store.readOutbox(), queue);
  assert.equal(fs.readFileSync(path.join(destination, 'uploads', 'sample.txt'), 'utf8'), '附件恢复样本');
  restored.store.close();
  assert.throws(() => restoreRuntimeBackup(backup, destination), /新目录/);
  fs.appendFileSync(path.join(backup, 'local.sqlite'), 'corrupt');
  assert.throws(() => restoreRuntimeBackup(backup, path.join(root, 'bad')), /完整性/);
  assert.equal(fs.existsSync(path.join(root, 'bad')), false);
});

test('未来版本、无版本的已有表及损坏数据库不回退空库', t => {
  const root = temporaryDirectory(t);
  for (const [name, sql, pattern] of [
    ['future', 'PRAGMA user_version = 99', /不支持/],
    ['legacy', 'CREATE TABLE legacy_data (value TEXT)', /未标记版本/]
  ]) {
    const file = path.join(root, `${name}.sqlite`);
    const db = new DatabaseSync(file);
    db.exec(sql);
    db.close();
    const before = fs.readFileSync(file);
    assert.throws(() => createSqliteDataStore(file), pattern);
    assert.deepEqual(fs.readFileSync(file), before);
  }
  const corrupt = path.join(root, 'corrupt.sqlite');
  fs.writeFileSync(corrupt, 'not sqlite');
  assert.throws(() => createSqliteDataStore(corrupt));
  assert.equal(fs.readFileSync(corrupt, 'utf8'), 'not sqlite');
  const truncated = path.join(root, 'truncated.sqlite');
  fs.writeFileSync(truncated, '');
  assert.throws(() => createSqliteDataStore(truncated), /截断/);
  assert.equal(fs.statSync(truncated).size, 0);
});

test('异步事务与断裂引用均拒绝提交', t => {
  const workspace = openWorkspace(temporaryDirectory(t));
  const original = workspace.store.exportSnapshot().data;
  assert.throws(() => workspace.store.runTransaction(() => Promise.resolve()), /同步业务/);
  assert.throws(() =>
    workspace.store.runTransaction(() => {
      workspace.store.state.notes.push({ id: 'bad', title: '损坏', rawMarkdown: '', spaceId: 'missing', tagIds: [] });
    })
  );
  assert.deepEqual(workspace.store.exportSnapshot().data, original);
  workspace.store.close();
});

test('离线目录与笔记的跨实体依赖持久保存', t => {
  const workspace = openWorkspace(temporaryDirectory(t));
  const folder = workspace.knowledge.folderService.createFolder({ spaceId: workspace.space.id, name: '离线目录' });
  const folderOperation = workspace.store.readOutbox().at(-1);
  workspace.knowledge.noteService.createNote({
    title: '目录中的笔记',
    rawMarkdown: '正文',
    spaceId: workspace.space.id,
    folderId: folder.id
  });
  assert(workspace.store.readOutbox().at(-1).dependencies.includes(folderOperation.operationId));
  workspace.store.close();
});

test('历史深层对象在提交、失败回滚和导出之间保持隔离', t => {
  const root = temporaryDirectory(t);
  const workspace = openWorkspace(root);
  const { store } = workspace;
  t.after(() => store.close());
  createNote(workspace);
  store.runTransaction(() => {
    store.state.noteVersions[0].extra = { paths: [[1, 2]] };
  });
  const exported = store.exportSnapshot();
  exported.data.noteVersions[0].extra.paths[0][0] = 99;
  assert.equal(store.state.noteVersions[0].extra.paths[0][0], 1);
  for (const run of [
    operation => store.runTransaction(operation),
    operation => store.syncTransaction((_db, state) => operation(state))
  ]) {
    assert.throws(
      () =>
        run(() => {
          store.state.noteVersions[0].extra.paths[0][0] = 42;
          throw new Error('回滚历史修改');
        }),
      /回滚历史修改/
    );
    assert.deepEqual(store.state.noteVersions[0].extra.paths, [[1, 2]]);
  }
  const persisted = store.readSync(db =>
    JSON.parse(db.prepare("SELECT payload FROM entities WHERE collection = 'noteVersions' LIMIT 1").get().payload)
  );
  assert.deepEqual(persisted.extra.paths, [[1, 2]]);
});

test('afterCommit：嵌套事务推迟到最外层提交，回滚丢弃，事务外立即执行', t => {
  const root = temporaryDirectory(t);
  const store = createSqliteDataStore(path.join(root, 'local.sqlite'));
  const calls = [];
  store.runTransaction(() => {
    store.runTransaction(() => store.afterCommit(() => calls.push('inner')));
    store.afterCommit(() => calls.push('outer'));
    assert.deepEqual(calls, []);
  });
  assert.deepEqual(calls, ['inner', 'outer']);
  assert.throws(
    () =>
      store.runTransaction(() => {
        store.afterCommit(() => calls.push('rolled-back'));
        throw new Error('回滚');
      }),
    /回滚/
  );
  // 回滚后的独立提交（flush）不能执行已丢弃的回调。
  store.flush();
  store.afterCommit(() => calls.push('immediate'));
  assert.deepEqual(calls, ['inner', 'outer', 'immediate']);
  store.close();
});
