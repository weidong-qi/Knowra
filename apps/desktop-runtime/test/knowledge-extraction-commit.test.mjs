import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { temporaryDirectory, openWorkspace } from './helpers.mjs';
import { createAppContext } from '../../api/src/app.factory.ts';
import { createSqliteDataStore } from '../src/sqlite-data-store.mjs';
import { createKnowledgeExtractionJobFixture } from '../../api/test/fixtures/knowledge-extraction-job.fixture.js';
import { validateSqliteKnowledgeExtractionCommits } from '../src/knowledge-extraction-commit-store.mjs';
import { assertMinimalProvenanceTransport } from '../../api/test/fixtures/knowledge-artifact-provenance.fixture.js';

function appFor(workspace, root) {
  return createAppContext({ dataStore: workspace.store, ownerId: 'demo', storageRootDir: root, uploadsDir: path.join(root, 'uploads') });
}

test('P3 SQLite 模拟提炼与候选、证据、提交记录、任务和同步 outbox 同事务；重启复用', async t => {
  const root = temporaryDirectory(t); const workspace = openWorkspace(root); const app = appFor(workspace, root);
  const fixture = await createKnowledgeExtractionJobFixture(app);
  const receipt = app.knowledgeExtractionCommit.commit(fixture.input);
  workspace.store.close();
  const restarted = createSqliteDataStore(path.join(root, 'local.sqlite')); t.after(() => restarted.close());
  assert.deepEqual(appFor({ store: restarted }, root).knowledgeExtractionCommit.commit(fixture.input), receipt);
  assert.equal(restarted.state.knowledgeItems.length, 1); assert.equal(restarted.state.knowledgeEvidence.length, 1);
  const db = new DatabaseSync(path.join(root, 'local.sqlite'), { readOnly: true });
  try {
    assert.equal(db.prepare('SELECT count(*) AS count FROM knowledge_extraction_commits').get().count, 1);
    const changes = db.prepare('SELECT changes FROM sync_outbox').all().map(row => JSON.parse(row.changes));
    assert(changes.some(batch => ['knowledgeItems', 'knowledgeEvidence', 'knowledgeArtifactProvenance'].every(collection => batch.some(change => change.collection === collection))));
    assertMinimalProvenanceTransport(changes, restarted.state.knowledgeArtifactProvenance[0]);
    validateSqliteKnowledgeExtractionCommits(db);
  } finally { db.close(); }
});

test('P3 SQLite 最终 commit 故障与提交表 insert 故障共同回滚，重试没有重复候选', async t => {
  for (const failure of ['commit', 'receipt']) {
    const root = temporaryDirectory(t); let fail = false;
    const workspace = openWorkspace(root, { beforeCommit() { if (fail) throw new Error('injected sqlite commit'); } });
    const app = appFor(workspace, root), fixture = await createKnowledgeExtractionJobFixture(app);
    const db = new DatabaseSync(path.join(root, 'local.sqlite'));
    if (failure === 'receipt') db.exec(`CREATE TRIGGER fail_extraction_receipt BEFORE INSERT ON knowledge_extraction_commits
      BEGIN SELECT RAISE(ABORT, 'injected sqlite receipt'); END;`);
    const before = db.prepare('SELECT count(*) AS count FROM sync_outbox').get().count;
    if (failure === 'commit') fail = true;
    assert.throws(() => app.knowledgeExtractionCommit.commit(fixture.input), /injected sqlite/);
    assert.equal(workspace.store.state.knowledgeItems.length, 0); assert.equal(workspace.store.state.knowledgeEvidence.length, 0);
    assert.deepEqual(workspace.store.state.knowledgeArtifactProvenance, []);
    assert.equal(workspace.store.aiRepository.get('aiJob', fixture.input.jobId).status, 'running');
    assert.equal(db.prepare('SELECT count(*) AS count FROM knowledge_extraction_commits').get().count, 0);
    assert.equal(db.prepare('SELECT count(*) AS count FROM sync_outbox').get().count, before);
    fail = false;
    if (failure === 'receipt') db.exec('DROP TRIGGER fail_extraction_receipt');
    app.knowledgeExtractionCommit.commit(fixture.input); assert.equal(workspace.store.state.knowledgeItems.length, 1);
    db.close(); workspace.store.close();
  }
});

test('P3 SQLite 核心提交扩展升级前保护备份；旧备份不改变 AI user_version，未知版本不覆盖', async t => {
  const root = temporaryDirectory(t), file = path.join(root, 'local.sqlite');
  const initial = createSqliteDataStore(file); initial.close();
  const db = new DatabaseSync(file);
  db.exec("DROP TABLE knowledge_extraction_commits; DELETE FROM metadata WHERE key = 'knowledgeExtractionCommitsVersion';");
  const version = db.prepare('PRAGMA user_version').get().user_version; db.close();
  const upgraded = createSqliteDataStore(file); assert(upgraded.knowledgeExtractionCommitStore); upgraded.close();
  const backup = fs.readdirSync(root).filter(name => name.includes('.before-knowledge-extraction-commits-v1-')).sort().at(-1);
  assert(backup); const previous = new DatabaseSync(path.join(root, backup), { readOnly: true });
  try { assert.equal(previous.prepare("SELECT name FROM sqlite_master WHERE name = 'knowledge_extraction_commits'").get(), undefined); }
  finally { previous.close(); }
  const raw = new DatabaseSync(file); assert.equal(raw.prepare('PRAGMA user_version').get().user_version, version);
  raw.exec("UPDATE metadata SET value = '99' WHERE key = 'knowledgeExtractionCommitsVersion'"); raw.close();
  const future = createSqliteDataStore(file); t.after(() => future.close());
  assert.equal(future.knowledgeExtractionCommitStore, null); assert(future.knowledgeExtractionCommitStoreError);
  const check = new DatabaseSync(file, { readOnly: true });
  try { assert.equal(check.prepare("SELECT value FROM metadata WHERE key = 'knowledgeExtractionCommitsVersion'").get().value, '99'); }
  finally { check.close(); }
});

test('P3 SQLite 损坏的提炼提交不覆盖，普通资料仍可打开和编辑', async t => {
  const root = temporaryDirectory(t), workspace = openWorkspace(root), app = appFor(workspace, root);
  const fixture = await createKnowledgeExtractionJobFixture(app); app.knowledgeExtractionCommit.commit(fixture.input); workspace.store.close();
  const raw = new DatabaseSync(path.join(root, 'local.sqlite')); raw.exec("UPDATE knowledge_extraction_commits SET receipt_json = 'null'"); raw.close();
  const store = createSqliteDataStore(path.join(root, 'local.sqlite')); t.after(() => store.close());
  const broken = appFor({ store }, root); assert.equal(broken.knowledgeExtractionCommit, null);
  broken.modules.knowledge.noteService.updateNote(fixture.note.id, { rawMarkdown: '仍可编辑的合成正文' });
  const db = new DatabaseSync(path.join(root, 'local.sqlite'), { readOnly: true });
  try {
    assert.equal(db.prepare('SELECT receipt_json FROM knowledge_extraction_commits').get().receipt_json, 'null');
    assert.throws(() => validateSqliteKnowledgeExtractionCommits(db));
  } finally { db.close(); }
});
