import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { createSqliteDataStore } from '../src/sqlite-data-store.mjs';
import { createRuntimeBackup, inspectRuntimeBackup } from '../src/backup.mjs';
import { prepareRestoredDirectory, finalizeRestoredDirectory } from '../src/restore-directory.mjs';
import { readRestoreContext, mergeRestoreFacts } from '../src/restore-readiness.mjs';
import { observeRemoteDeletionFacts } from '../src/sqlite-deletion-facts.mjs';
import { temporaryDirectory, removeAiTablesForLegacyFixture } from './helpers.mjs';
import { copyBackup, treeHashes } from './fixtures/extraction-backup.fixture.mjs';
import { syntheticProvenanceFixture } from '../../api/test/fixtures/knowledge-artifact-provenance.fixture.js';

function fixture(t, name = 'current', options) {
  const root = temporaryDirectory(t),
    dataRoot = path.join(root, name);
  const store = createSqliteDataStore(path.join(dataRoot, 'local.sqlite'), options);
  store.runTransaction(() => {
    store.state.spaces.push({ id: 'space', userId: 'demo', name: '合成空间' });
  });
  t.after(() => store.close());
  return { root, dataRoot, store };
}
const tag = id => ({ id, spaceId: 'space', name: '合成标签' });
function purge(store, id) {
  store.runTransaction(() => store.state.tags.push(tag(id)));
  store.runTransaction(() => {
    store.state.tags.splice(
      store.state.tags.findIndex(row => row.id === id),
      1
    );
  });
}
function bind(store, { origin = 'https://synthetic.invalid', owner = 'remote-synthetic' } = {}) {
  store.syncTransaction(db => {
    for (const [key, value] of [
      ['serverUrl', origin],
      ['ownerId', owner],
      ['serverEpoch', 'synthetic-epoch']
    ]) {
      if (value === null) db.prepare('DELETE FROM metadata WHERE key=?').run(`sync:${key}`);
      else db.prepare('INSERT OR REPLACE INTO metadata VALUES (?,?)').run(`sync:${key}`, JSON.stringify(value));
    }
  });
}
function remoteDelete(store, id) {
  store.syncTransaction(db =>
    observeRemoteDeletionFacts(db, [{ collection: 'tags', id, value: null, revision: 2 }], { epoch: 'synthetic-epoch' })
  );
}
const rawFacts = store =>
  store.readSync(db => db.prepare('SELECT * FROM deletion_facts ORDER BY collection,entity_id').all());
const rawMetadata = store => store.readSync(db => db.prepare('SELECT * FROM metadata ORDER BY key').all());

test('C2 双向 union 保留 target scope/coverage 与同 key 原始 JSON/hash 字节，候选只改 scope 派生身份', t => {
  const a = fixture(t),
    b = fixture(t, 'candidate');
  for (const id of ['shared', 'current-only']) purge(a.store, id);
  for (const id of ['shared', ' candidate-only ']) purge(b.store, id);
  a.store.syncTransaction(db => {
    const row = db.prepare("SELECT * FROM deletion_facts WHERE entity_id='shared'").get();
    const reversed = Object.fromEntries(Object.entries(JSON.parse(row.record_json)).reverse());
    db.prepare('UPDATE deletion_facts SET record_json=? WHERE entity_id=?').run(
      JSON.stringify(reversed, null, 2),
      'shared'
    );
  });
  b.store.syncTransaction(db => {
    const coverage = b.store.deletionFacts.getCoverage();
    coverage.legacyHistory = 'incomplete';
    db.prepare("UPDATE metadata SET value=? WHERE key='deletionFactsCoverage'").run(JSON.stringify(coverage));
  });
  const current = readRestoreContext(a.store),
    candidate = readRestoreContext(b.store),
    oldCurrent = rawFacts(a.store);
  mergeRestoreFacts(b.store, current);
  const merged = readRestoreContext(b.store);
  assert.deepEqual(merged.ledger.scope, current.ledger.scope);
  assert.equal(merged.ledger.coverage.recordedSince, current.ledger.coverage.recordedSince);
  assert.equal(merged.ledger.coverage.legacyHistory, 'incomplete');
  for (const row of oldCurrent)
    assert.deepEqual(
      merged.rows.find(next => next.entity_id === row.entity_id),
      row
    );
  const before = JSON.parse(candidate.rows.find(row => row.entity_id === ' candidate-only ').record_json);
  const after = b.store.deletionFacts.list().find(row => row.entityId === before.entityId);
  assert.deepEqual(after.source, before.source);
  assert.equal(after.observedAt, before.observedAt);
  assert.equal(after.deletedAt, before.deletedAt);
  assert.equal(after.scopeId, current.ledger.scope.scopeId);
  assert.notEqual(after.observationId, before.observationId);
  assert.deepEqual(rawFacts(a.store), oldCurrent);
});

test('C2 候选合并事务提交失败回滚 facts、scope、binding；不改当前库', t => {
  let fail = false;
  const a = fixture(t),
    b = fixture(t, 'candidate', {
      beforeCommit() {
        if (fail) throw new Error('synthetic merge rollback');
      }
    });
  bind(a.store);
  remoteDelete(a.store, 'remote-gone');
  purge(b.store, 'candidate-gone');
  const before = { facts: rawFacts(b.store), metadata: rawMetadata(b.store), data: b.store.exportSnapshot().data };
  const current = readRestoreContext(a.store);
  fail = true;
  assert.throws(() => mergeRestoreFacts(b.store, current), /synthetic merge rollback/);
  assert.deepEqual(rawFacts(b.store), before.facts);
  assert.deepEqual(rawMetadata(b.store), before.metadata);
  assert.deepEqual(b.store.exportSnapshot().data, before.data);
  assert.deepEqual(rawFacts(a.store), current.rows);
});

test('C2 当前资料仍保留的已知删除对象（本机副本）不算冲突：对当前资料做的备份可以通过恢复检查', t => {
  // 真实场景：云端已回收某些历史版本并下发删除事实，但本机私有记录仍引用它们，副本按设计保留在本机。
  const a = fixture(t);
  bind(a.store);
  a.store.runTransaction(() => a.store.state.tags.push(tag('kept-local-copy')));
  remoteDelete(a.store, 'kept-local-copy');
  assert.equal(a.store.deletionFacts.has('tags', 'kept-local-copy'), true);
  const backup = createRuntimeBackup(a.store, a.dataRoot);
  assert.equal(inspectRuntimeBackup(backup, { restoreContext: readRestoreContext(a.store) }).valid, true);

  // 当前资料里已经没有的已知删除对象，仍然拒绝恢复（不会被备份复活）。
  a.store.runTransaction(() => {
    a.store.state.tags.splice(
      a.store.state.tags.findIndex(row => row.id === 'kept-local-copy'),
      1
    );
  });
  assert.throws(() => inspectRuntimeBackup(backup, { restoreContext: readRestoreContext(a.store) }), {
    code: 'LOCAL_RESTORE_DELETION_CONFLICT',
    statusCode: 409
  });
});

test('C2 候选自身 live + remote fact 保持 intrinsic valid，但上下文拒绝恢复所有 live ID', t => {
  const a = fixture(t),
    b = fixture(t, 'candidate');
  bind(b.store);
  b.store.runTransaction(() => b.store.state.tags.push(tag('conflicting-tag')));
  remoteDelete(b.store, 'conflicting-tag');
  const backup = createRuntimeBackup(b.store, b.dataRoot),
    before = treeHashes(backup);
  assert.equal(inspectRuntimeBackup(backup).valid, true);
  assert.throws(() => inspectRuntimeBackup(backup, { restoreContext: readRestoreContext(a.store) }), {
    code: 'LOCAL_RESTORE_DELETION_CONFLICT',
    statusCode: 409
  });
  assert.deepEqual(treeHashes(backup), before);
});

test('C2 legacy 未绑定正修订不能借 target binding 认证；当前远端事实与 incomplete coverage 保留到重启', t => {
  const a = fixture(t),
    b = fixture(t, 'candidate');
  bind(a.store);
  remoteDelete(a.store, 'trusted-gone');
  b.backup = createRuntimeBackup(b.store, b.dataRoot);
  const legacy = copyBackup(b, 'legacy', db => {
    db.exec("DROP TABLE deletion_facts; DELETE FROM metadata WHERE key LIKE 'deletionFacts%'");
    db.prepare('INSERT INTO sync_base VALUES (?,?,?,?)').run('tags', 'unknown-history', 8, 'null');
  });
  const before = treeHashes(legacy),
    current = readRestoreContext(a.store);
  assert.equal(inspectRuntimeBackup(legacy, { restoreContext: current }).valid, true);
  const directory = prepareRestoredDirectory(a.root, legacy, { restoreContext: current });
  finalizeRestoredDirectory(directory, current);
  for (let i = 0; i < 2; i++) {
    const restored = createSqliteDataStore(path.join(directory, 'local.sqlite'));
    try {
      assert.equal(restored.deletionFacts.has('tags', 'trusted-gone'), true);
      assert.equal(restored.deletionFacts.has('tags', 'unknown-history'), false);
      assert.equal(restored.deletionFacts.getCoverage().legacyHistory, 'incomplete');
      assert.deepEqual(readRestoreContext(restored).binding, current.binding);
    } finally {
      restored.close();
    }
  }
  assert.deepEqual(treeHashes(legacy), before);
});

test('C2 legacy 自身可信绑定补录先于早检，缺席 null revision 不造事实', t => {
  const a = fixture(t),
    b = fixture(t, 'candidate');
  bind(b.store);
  b.store.runTransaction(() => b.store.state.tags.push(tag('old-live')));
  b.backup = createRuntimeBackup(b.store, b.dataRoot);
  for (const revision of [2, null]) {
    const directory = copyBackup(b, `legacy-${revision}`, db => {
      db.exec("DROP TABLE deletion_facts; DELETE FROM metadata WHERE key LIKE 'deletionFacts%'");
      db.prepare('INSERT INTO sync_base VALUES (?,?,?,?)').run('tags', 'old-live', revision, 'null');
    });
    assert.equal(inspectRuntimeBackup(directory).valid, true);
    const inspect = () => inspectRuntimeBackup(directory, { restoreContext: readRestoreContext(a.store) });
    if (revision) assert.throws(inspect, { code: 'LOCAL_RESTORE_DELETION_CONFLICT' });
    else assert.equal(inspect().valid, true);
  }
});

function legacyProvenanceBackup(t, { receipt = true } = {}) {
  const a = fixture(t),
    b = fixture(t, 'candidate'),
    f = syntheticProvenanceFixture({ alias: true, recorded: true });
  for (const store of [a.store, b.store]) store.importSnapshot({ schemaVersion: 7, data: f.state });
  b.backup = createRuntimeBackup(b.store, b.dataRoot);
  const backup = copyBackup(b, 'legacy-receipt', db => {
    db.exec(
      "DELETE FROM entities WHERE collection='knowledgeArtifactProvenance'; UPDATE metadata SET value='6' WHERE key='localDataSchemaVersion'"
    );
    if (receipt)
      db.prepare('INSERT INTO knowledge_extraction_commits VALUES (?,?,?,?)').run(
        f.receipt.ownerId,
        f.receipt.datasetId,
        f.receipt.jobId,
        JSON.stringify(f.receipt)
      );
  });
  return { a, b, f, backup };
}

test('C2 合法 legacy receipt 只读投影与真实 startup 回填一致，不误判 recorded 降级', t => {
  const { a, f, backup } = legacyProvenanceBackup(t),
    before = treeHashes(backup),
    current = readRestoreContext(a.store);
  assert.equal(inspectRuntimeBackup(backup, { restoreContext: current }).valid, true);
  const directory = prepareRestoredDirectory(a.root, backup, { restoreContext: current });
  finalizeRestoredDirectory(directory, current);
  const restored = createSqliteDataStore(path.join(directory, 'local.sqlite'));
  try {
    assert.deepEqual(restored.state.knowledgeArtifactProvenance, [f.provenance]);
  } finally {
    restored.close();
  }
  assert.deepEqual(treeHashes(backup), before);
});

test('C2 同 artifact 缺合法 receipt 不得降级当前 recorded；真正 absent artifact 允许恢复', t => {
  const { a, b, backup } = legacyProvenanceBackup(t, { receipt: false });
  assert.equal(inspectRuntimeBackup(backup).valid, true);
  assert.throws(() => inspectRuntimeBackup(backup, { restoreContext: readRestoreContext(a.store) }), {
    code: 'LOCAL_RESTORE_PROVENANCE_CONFLICT'
  });
  const empty = fixture(t, 'empty');
  empty.store.runTransaction(() => {
    for (const rows of Object.values(empty.store.state)) rows.length = 0;
  });
  const cleanBackup = createRuntimeBackup(empty.store, empty.dataRoot);
  assert.equal(inspectRuntimeBackup(cleanBackup, { restoreContext: readRestoreContext(a.store) }).valid, true);
  assert.equal(b.store.state.knowledgeArtifactProvenance[0].state, 'recorded');
});

test('C2 manifest datasetId 与原 DB 同时存在必须一致；任一 legacy 缺失仍可只读检查', t => {
  const a = fixture(t);
  a.backup = createRuntimeBackup(a.store, a.dataRoot);
  for (const mode of ['mismatch', 'missing-manifest', 'missing-db']) {
    const directory = copyBackup(a, mode, db => {
      if (mode === 'missing-db') db.exec("DELETE FROM metadata WHERE key='datasetId'");
    });
    const file = path.join(directory, 'manifest.json'),
      manifest = JSON.parse(fs.readFileSync(file));
    if (mode === 'mismatch') manifest.datasetId = 'wrong-synthetic-dataset';
    if (mode === 'missing-manifest') delete manifest.datasetId;
    fs.writeFileSync(file, JSON.stringify(manifest));
    const before = treeHashes(directory);
    if (mode === 'mismatch') assert.throws(() => inspectRuntimeBackup(directory), /资料集标识不一致/);
    else assert.equal(inspectRuntimeBackup(directory).valid, true);
    assert.deepEqual(treeHashes(directory), before);
  }
});

test('C2 v1 无 sync_conflicts 表的可信旧备份可只读投影并正常迁移恢复', t => {
  const a = fixture(t),
    b = fixture(t, 'candidate');
  bind(b.store);
  b.backup = createRuntimeBackup(b.store, b.dataRoot);
  const legacy = copyBackup(b, 'legacy-v1', db => {
    removeAiTablesForLegacyFixture(db);
    db.exec(
      "DROP TABLE deletion_facts; DELETE FROM metadata WHERE key LIKE 'deletionFacts%'; DROP TABLE sync_uploads; DROP TABLE sync_conflicts; DROP TABLE sync_recovery; PRAGMA user_version=1"
    );
    db.prepare('INSERT INTO sync_base VALUES (?,?,?,?)').run('tags', 'legacy-deleted', 2, 'null');
  });
  const current = readRestoreContext(a.store),
    before = treeHashes(legacy);
  assert.equal(inspectRuntimeBackup(legacy, { restoreContext: current }).valid, true);
  const directory = prepareRestoredDirectory(a.root, legacy, { restoreContext: current });
  finalizeRestoredDirectory(directory, current);
  const restored = createSqliteDataStore(path.join(directory, 'local.sqlite'));
  try {
    assert.equal(restored.deletionFacts.has('tags', 'legacy-deleted'), true);
  } finally {
    restored.close();
  }
  assert.deepEqual(treeHashes(legacy), before);
});
