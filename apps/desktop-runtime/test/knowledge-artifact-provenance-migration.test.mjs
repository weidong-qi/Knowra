import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { createSqliteDataStore } from '../src/sqlite-data-store.mjs';
import { temporaryDirectory } from './helpers.mjs';
import {
  syntheticProvenanceFixture,
  assertMinimalProvenanceTransport
} from '../../api/test/fixtures/knowledge-artifact-provenance.fixture.js';

function seedLegacy(root, mutate = () => {}) {
  const file = path.join(root, 'local.sqlite');
  createSqliteDataStore(file).close();
  const fixture = syntheticProvenanceFixture({ alias: true });
  mutate(fixture);
  const db = new DatabaseSync(file);
  try {
    db.exec("BEGIN IMMEDIATE; DELETE FROM metadata WHERE key = 'localDataSchemaVersion'; DELETE FROM entities;");
    const insert = db.prepare('INSERT INTO entities VALUES (?, ?, ?, ?)');
    for (const [collection, rows] of Object.entries(fixture.state))
      for (const row of rows) insert.run(collection, row.id, JSON.stringify(row), 0);
    db.prepare('INSERT INTO knowledge_extraction_commits VALUES (?, ?, ?, ?)').run(
      fixture.receipt.ownerId,
      fixture.receipt.datasetId,
      fixture.receipt.jobId,
      JSON.stringify(fixture.receipt)
    );
    db.exec('COMMIT');
  } finally {
    db.close();
  }
  return { file, ...fixture };
}

test('05B SQLite旧receipt回填仅摘要，保留用户编辑和alias，升级保护副本及outbox同写', t => {
  const root = temporaryDirectory(t),
    f = seedLegacy(root, fixture => {
      fixture.state.knowledgeItems[0].title = '用户当前标题';
      fixture.state.knowledgeItems[0].sourceMode = 'manual';
    });
  const store = createSqliteDataStore(f.file);
  t.after(() => store.close());
  assert.deepEqual(store.state.knowledgeArtifactProvenance, [f.provenance]);
  assert.equal(store.state.knowledgeItems[0].title, '用户当前标题');
  assertMinimalProvenanceTransport(store.readOutbox(), f.provenance);
  assertMinimalProvenanceTransport(store.exportSnapshot(), f.provenance);
  const db = new DatabaseSync(f.file, { readOnly: true });
  try {
    assert.equal(db.prepare("SELECT value FROM metadata WHERE key = 'localDataSchemaVersion'").get().value, '9');
    assert.equal(db.prepare('PRAGMA user_version').get().user_version, 8);
    assert.deepEqual(
      JSON.parse(db.prepare('SELECT receipt_json FROM knowledge_extraction_commits').get().receipt_json),
      f.receipt
    );
  } finally {
    db.close();
  }
  assert(fs.readdirSync(root).some(name => name.includes('.before-provenance-v1-')));
  const before = store.readOutbox();
  assert.throws(() => store.importSnapshot({ schemaVersion: 6, data: f.state }), {
    code: 'KNOWLEDGE_ARTIFACT_PROVENANCE_CONFLICT'
  });
  assert.deepEqual(store.readOutbox(), before);
});

test('05B SQLite旧可选坏receipt隔离、purged候选不重建，坏来源拒绝打开', t => {
  for (const scenario of ['receipt', 'purged']) {
    const root = temporaryDirectory(t),
      f = seedLegacy(root, fixture => {
        if (scenario === 'receipt') fixture.receipt.receiptHash = 'broken';
        else {
          fixture.state.knowledgeItems = [];
          fixture.state.knowledgeEvidence = [];
        }
      });
    const store = createSqliteDataStore(f.file);
    assert.equal(store.state.knowledgeArtifactProvenance.length, scenario === 'purged' ? 0 : 1);
    if (scenario === 'receipt') {
      assert(store.knowledgeExtractionCommitStoreError);
      assert.equal(store.state.knowledgeArtifactProvenance[0].state, 'legacy-unavailable');
      store.runTransaction(() => {
        store.state.knowledgeItems[0].title = '核心可编辑';
        store.flush();
      });
    }
    store.close();
    if (scenario === 'receipt') {
      const db = new DatabaseSync(f.file);
      const row = db.prepare("SELECT id, payload FROM entities WHERE collection='knowledgeArtifactProvenance'").get();
      const record = JSON.parse(row.payload);
      record.schemaVersion = 9;
      db.prepare("UPDATE entities SET payload=? WHERE collection='knowledgeArtifactProvenance' AND id=?").run(
        JSON.stringify(record),
        row.id
      );
      db.close();
      assert.throws(() => createSqliteDataStore(f.file), { code: 'KNOWLEDGE_ARTIFACT_PROVENANCE_INVALID' });
    }
  }
});

test('05B SQLite迁移最终提交故障回滚摘要、schema标记和outbox，可从原库再升级', t => {
  const root = temporaryDirectory(t),
    f = seedLegacy(root);
  const read = () => {
    const db = new DatabaseSync(f.file, { readOnly: true });
    try {
      return {
        entities: db.prepare('SELECT * FROM entities ORDER BY collection,id').all(),
        outbox: db.prepare('SELECT * FROM sync_outbox ORDER BY sequence').all(),
        schema: db.prepare("SELECT value FROM metadata WHERE key = 'localDataSchemaVersion'").get()
      };
    } finally {
      db.close();
    }
  };
  const before = read();
  assert.throws(
    () =>
      createSqliteDataStore(f.file, {
        beforeCommit() {
          throw new Error('injected-provenance-commit');
        }
      }),
    /injected-provenance-commit/
  );
  assert.deepEqual(read(), before);
  const reopened = createSqliteDataStore(f.file);
  t.after(() => reopened.close());
  assert.deepEqual(reopened.state.knowledgeArtifactProvenance, [f.provenance]);
});

for (const scenario of [
  { name: '无同步基线', revision: undefined, state: 'recorded' },
  { name: '旧reset的null修订缺席', revision: null, state: 'recorded' },
  { name: '正修订永久删除事实', revision: 2, state: 'legacy-unavailable' }
])
  test(`05B SQLite回填区分${scenario.name}，保留原receipt及Evidence版本alias`, t => {
    const root = temporaryDirectory(t),
      f = seedLegacy(root);
    const originId = f.provenance.sources[0].originNoteVersionId;
    const db = new DatabaseSync(f.file);
    let receiptBytes;
    try {
      if (scenario.revision !== undefined)
        db.prepare('INSERT INTO sync_base VALUES (?, ?, ?, ?)').run(
          'noteVersions',
          originId,
          scenario.revision,
          'null'
        );
      receiptBytes = db.prepare('SELECT receipt_json FROM knowledge_extraction_commits').get().receipt_json;
    } finally {
      db.close();
    }
    let store = createSqliteDataStore(f.file);
    t.after(() => store.close());
    assert.equal(store.state.knowledgeArtifactProvenance[0].state, scenario.state);
    assert.equal(store.provenanceMigration.deleted, scenario.revision === 2 ? 1 : 0);
    assert.equal(store.provenanceMigration.recorded, scenario.revision === 2 ? 0 : 1);
    if (scenario.state === 'recorded') assert.deepEqual(store.state.knowledgeArtifactProvenance, [f.provenance]);
    assert.deepEqual(store.state.noteVersions, f.state.noteVersions);
    assert.deepEqual(store.state.knowledgeEvidence, f.state.knowledgeEvidence);
    assert.equal(
      store.state.noteVersions.some(version => version.id === originId),
      false
    );
    const firstRecord = structuredClone(store.state.knowledgeArtifactProvenance);
    store.close();
    store = createSqliteDataStore(f.file);
    assert.deepEqual(store.state.knowledgeArtifactProvenance, firstRecord);
    const read = new DatabaseSync(f.file, { readOnly: true });
    try {
      assert.equal(
        read.prepare('SELECT receipt_json FROM knowledge_extraction_commits').get().receipt_json,
        receiptBytes
      );
    } finally {
      read.close();
    }
  });

test('05B SQLite非空非法删除修订拒绝加载，不能伪装缺席或有效墓碑', t => {
  for (const revision of [0, -1, 1.5, 'invalid']) {
    const root = temporaryDirectory(t),
      f = seedLegacy(root);
    const db = new DatabaseSync(f.file);
    try {
      db.prepare('INSERT INTO sync_base VALUES (?, ?, ?, ?)').run(
        'noteVersions',
        f.provenance.sources[0].originNoteVersionId,
        revision,
        'null'
      );
    } finally {
      db.close();
    }
    assert.throws(() => createSqliteDataStore(f.file), /同步基线删除修订无效/);
  }
});
