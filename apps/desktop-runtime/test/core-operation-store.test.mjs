import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { createSqliteDataStore } from '../src/sqlite-data-store.mjs';
import { createAppContext } from '../../api/src/app.factory.ts';
import {
  coreOperationScenarios,
  request,
  lookup,
  resultFor
} from '../../api/test/fixtures/core-operation-scenarios.js';
import { createRuntimeBackup, inspectRuntimeBackup, restoreRuntimeBackup } from '../src/backup.mjs';

function withFixture(run) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'knowra-core-sqlite-'));
  const file = path.join(root, 'local.sqlite');
  let store,
    api,
    fail = false;
  const close = () => {
    store?.close();
    store = null;
  };
  const restart = () => {
    close();
    store = createSqliteDataStore(file, {
      beforeCommit() {
        if (fail) {
          fail = false;
          throw new Error('injected disk failure');
        }
      }
    });
    api = createAppContext({
      dataStore: store,
      ownerId: 'test',
      uploadsDir: path.join(root, 'uploads'),
      storageRootDir: root
    }).http.knowledge;
  };
  try {
    restart();
    const space = api.createDefaultKnowledgeSpace();
    return run({
      get store() {
        return store;
      },
      get api() {
        return api;
      },
      root,
      file,
      space,
      restart,
      failNext: () => {
        fail = true;
      },
      journal: () => JSON.stringify(store.readOutbox()),
      snapshot: () =>
        store.readSync(db => ({
          state: JSON.stringify(store.state),
          outbox: JSON.stringify(store.readOutbox()),
          receipts: JSON.stringify(db.prepare('SELECT * FROM core_operation_receipts').all()),
          entities: JSON.stringify(db.prepare('SELECT * FROM entities').all())
        })),
      corruptAi: () => {
        close();
        const db = new DatabaseSync(file);
        try {
          db.exec('DROP TABLE ai_conversation_records');
        } finally {
          db.close();
        }
      }
    });
  } finally {
    close();
    fs.rmSync(root, { recursive: true, force: true });
  }
}

for (const scenario of coreOperationScenarios(withFixture)) test(`SQLite ${scenario.name}`, scenario.run);

test('SQLite 运行期间回执变成 JSON null 时不能重新执行领域操作', () =>
  withFixture(f => {
    const input = request(f.space.id);
    f.store.coreOperationStore.commit(input, () =>
      resultFor(
        f.store,
        f.api.createNote({ id: 'note-fixed', title: '已提交', rawMarkdown: '合成', spaceId: f.space.id })
      )
    );
    f.store.readSync(db => db.prepare('UPDATE core_operation_receipts SET receipt_json = ?').run('null'));
    let ran = false;
    assert.throws(() => f.store.coreOperationStore.get(lookup(input)), { code: 'CORE_OPERATION_INVALID' });
    assert.throws(
      () =>
        f.store.coreOperationStore.commit(input, () => {
          ran = true;
        }),
      { code: 'CORE_OPERATION_INVALID' }
    );
    assert.equal(ran, false);
    assert.equal(f.store.state.notes.length, 1);
    assert.equal(
      f.store.readSync(db => db.prepare('SELECT receipt_json FROM core_operation_receipts').get().receipt_json),
      'null'
    );
  }));

test('SQLite 核心回执增量迁移备份、完整备份恢复与损坏隔离', () =>
  withFixture(f => {
    assert(fs.readdirSync(f.root).some(name => name.includes('.before-core-operations-v1-')));
    const input = request(f.space.id);
    const receipt = f.store.coreOperationStore.commit(input, () =>
      resultFor(
        f.store,
        f.api.createNote({ id: 'backup-note', title: '回执备份', rawMarkdown: '合成', spaceId: f.space.id })
      )
    );
    const backup = createRuntimeBackup(f.store, f.root);
    assert.equal(inspectRuntimeBackup(backup).valid, true);
    const restoredPath = path.join(f.root, 'restored');
    restoreRuntimeBackup(backup, restoredPath);
    const restored = createSqliteDataStore(path.join(restoredPath, 'local.sqlite'));
    try {
      assert.deepEqual(restored.coreOperationStore.get(lookup(input)), receipt);
    } finally {
      restored.close();
    }
    f.store.readSync(db => db.prepare('UPDATE core_operation_receipts SET receipt_json = ?').run('{"broken":true}'));
    f.restart();
    assert(f.store.coreOperationStoreError);
    assert.equal(f.store.coreOperationStore, null);
    f.api.createNote({ id: 'manual-safe', title: '手工保存仍有效', rawMarkdown: '', spaceId: f.space.id });
    const broken = createRuntimeBackup(f.store, f.root);
    assert.throws(() => inspectRuntimeBackup(broken), { code: 'CORE_OPERATION_INVALID' });
    assert.equal(
      f.store.readSync(db => db.prepare('SELECT receipt_json FROM core_operation_receipts').get().receipt_json),
      '{"broken":true}'
    );
  }));
