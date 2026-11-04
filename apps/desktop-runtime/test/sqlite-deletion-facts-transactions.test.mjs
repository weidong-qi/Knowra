import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { createSqliteDataStore } from '../src/sqlite-data-store.mjs';
import { observeRemoteDeletionFacts } from '../src/sqlite-deletion-facts.mjs';
import { createAppContext } from '../../api/src/app.factory.js';
import { createLocalAttachmentStore } from '../../api/src/infrastructure/local-attachment-store.js';
import { createLegacyKnowledgeArtifactProvenance } from '../../api/src/modules/knowledge/domain/knowledge-artifact-provenance-contract.ts';
import { syntheticProvenanceFixture } from '../../api/test/fixtures/knowledge-artifact-provenance.fixture.js';
import { createNote, openWorkspace, temporaryDirectory } from './helpers.mjs';
import { extractionBackupFixture, treeHashes } from './fixtures/extraction-backup.fixture.mjs';

function snapshotRows(store) {
  return store.readSync(db =>
    Object.fromEntries(
      [
        'entities',
        'local_revisions',
        'sync_outbox',
        'deletion_facts',
        'knowledge_extraction_commits',
        'ai_jobs',
        'ai_job_attempts',
        'ai_knowledge_extraction_tasks',
        'metadata'
      ].map(table => [table, db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()])
    )
  );
}

function observe(store, collection, id) {
  store.metadataTransaction(db => {
    for (const [key, value] of Object.entries({
      serverUrl: 'https://synthetic.example',
      ownerId: 'synthetic-owner',
      serverEpoch: 'synthetic-epoch'
    })) {
      db.prepare('INSERT OR REPLACE INTO metadata VALUES (?,?)').run(`sync:${key}`, JSON.stringify(value));
    }
    observeRemoteDeletionFacts(db, [{ collection, id, revision: 4, value: null }], { epoch: 'synthetic-epoch' });
  });
}

test('C1 真实 Mock 接纳后领域 purge 同事务保存三类事实，失败保留 receipt/任务/实体/队列', async t => {
  const f = await extractionBackupFixture(t),
    knowledge = f.app.modules.knowledge;
  const itemId = f.store.state.knowledgeItems[0].id;
  knowledge.knowledgeItemService.archive(itemId, { expectedUpdatedAt: f.store.state.knowledgeItems[0].updatedAt });
  knowledge.knowledgeItemService.trash(itemId, { expectedUpdatedAt: f.store.state.knowledgeItems[0].updatedAt });
  assert.deepEqual(f.store.deletionFacts.list(), []);
  const before = snapshotRows(f.store),
    privateReceipt = structuredClone(f.store.state.knowledgeArtifactProvenance[0]);
  const purge = () =>
    knowledge.permanentlyDeleteKnowledgeItem(itemId, { expectedUpdatedAt: f.store.state.knowledgeItems[0].updatedAt });
  f.store.readSync(db =>
    db.exec(
      "CREATE TRIGGER c1_fail_fact BEFORE INSERT ON deletion_facts BEGIN SELECT RAISE(ABORT,'C1-domain-fact-failure'); END"
    )
  );
  assert.throws(purge, /C1-domain-fact-failure/);
  assert.deepEqual(snapshotRows(f.store), before);
  f.store.readSync(db => db.exec('DROP TRIGGER c1_fail_fact'));
  assert.equal(purge().status, 'subject-purged');
  assert.deepEqual(
    f.store.deletionFacts
      .list()
      .map(fact => fact.collection)
      .sort(),
    ['knowledgeArtifactProvenance', 'knowledgeEvidence', 'knowledgeItems']
  );
  const after = snapshotRows(f.store);
  for (const key of ['knowledge_extraction_commits', 'ai_jobs', 'ai_job_attempts', 'ai_knowledge_extraction_tasks'])
    assert.deepEqual(after[key], before[key]);
  assert(
    after.knowledge_extraction_commits[0].receipt_json.includes(privateReceipt.artifactId),
    '历史回执正文不当成待重建实体'
  );
  assert.equal(f.mock.calls.length, 1);
});

test('C1 来源仓库 create/upgradeLegacy 都不能重建删除摘要，已有 legacy 升级仍允许', t => {
  const file = path.join(temporaryDirectory(t), 'local.sqlite'),
    store = createSqliteDataStore(file);
  t.after(() => store.close());
  const f = syntheticProvenanceFixture();
  f.state.knowledgeItems[0].sourceMode = 'manual';
  const legacy = createLegacyKnowledgeArtifactProvenance(f.artifactId);
  store.importSnapshot({ schemaVersion: 7, data: { ...f.state, knowledgeArtifactProvenance: [legacy] } });
  const app = createAppContext({
    dataStore: store,
    ownerId: 'demo',
    storageRootDir: path.dirname(file),
    uploadsDir: path.join(path.dirname(file), 'uploads')
  });
  const repository = app.modules.knowledge.repositories.knowledgeArtifactProvenanceRepository;
  store.runTransaction(() => repository.deleteByKnowledgeItemId(f.artifactId));
  const before = snapshotRows(store);
  for (const method of ['create', 'upgradeLegacy']) {
    assert.throws(() => repository[method](f.provenance), { code: 'LOCAL_DELETION_FACT_CONFLICT' });
    assert.deepEqual(snapshotRows(store), before);
    assert.equal(store.state.knowledgeArtifactProvenance.length, 0);
  }
  const control = createSqliteDataStore(path.join(temporaryDirectory(t), 'control.sqlite'));
  t.after(() => control.close());
  control.importSnapshot({ schemaVersion: 7, data: { ...f.state, knowledgeArtifactProvenance: [legacy] } });
  const controlApp = createAppContext({
    dataStore: control,
    ownerId: 'demo',
    storageRootDir: path.dirname(file),
    uploadsDir: path.join(path.dirname(file), 'control-uploads')
  });
  controlApp.modules.knowledge.repositories.knowledgeArtifactProvenanceRepository.upgradeLegacy(f.provenance);
  assert.deepEqual(control.state.knowledgeArtifactProvenance, [f.provenance]);
  assert.deepEqual(control.deletionFacts.list(), []);
});

test('C1 import 提交事务内重查：早检之后出现的事实阻断写入，实体/队列/AI epoch 不变', t => {
  const root = temporaryDirectory(t),
    workspace = openWorkspace(root);
  t.after(() => workspace.store.close());
  const note = createNote(workspace),
    store = workspace.store,
    snapshot = store.exportSnapshot();
  let observed = false,
    before;
  store.readSync(db => {
    const exec = db.exec.bind(db);
    db.exec = sql => {
      if (!observed && sql === 'BEGIN IMMEDIATE') {
        observed = true;
        // 模拟早检后另一已核观察的提交，最终事务尚未拿写锁。
        observe(store, 'notes', note.id);
        before = snapshotRows(store);
      }
      return exec(sql);
    };
  });
  assert.throws(() => store.commitImport(snapshot), { code: 'LOCAL_DELETION_FACT_CONFLICT' });
  assert(observed);
  assert.deepEqual(snapshotRows(store), before);
  assert.deepEqual(store.exportSnapshot().data, snapshot.data);
});

test('C1 业务导入早检不暂存附件，晚拒绝回滚真实目录替换且保留并发事实', t => {
  const root = temporaryDirectory(t),
    workspace = openWorkspace(root);
  t.after(() => workspace.store.close());
  const note = createNote(workspace),
    store = workspace.store,
    uploadsDir = path.join(root, 'uploads');
  const attachmentStore = createLocalAttachmentStore({ dataStore: store, storageRootDir: root, uploadsDir });
  let staged = 0,
    committed = 0;
  const prepare = attachmentStore.prepareAttachmentsSnapshot;
  attachmentStore.prepareAttachmentsSnapshot = (...args) => {
    staged++;
    const transaction = prepare(...args),
      commit = transaction.commit;
    transaction.commit = () => {
      commit();
      committed++;
      observe(store, 'notes', note.id);
    };
    return transaction;
  };
  const app = createAppContext({ dataStore: store, ownerId: 'demo', attachmentStore });
  const attachment = app.http.storage.uploadAttachment({
    noteId: note.id,
    fileName: 'original.txt',
    contentBase64: Buffer.from('synthetic-original-file').toString('base64')
  });
  const snapshot = app.http.storage.exportKnowledgeBase(),
    before = snapshotRows(store),
    files = treeHashes(uploadsDir);
  const replacement = structuredClone(snapshot);
  replacement.data.attachments = [];
  replacement.attachmentFiles = [];
  assert.throws(() => app.http.storage.importKnowledgeBase(replacement), { code: 'LOCAL_DELETION_FACT_CONFLICT' });
  assert.equal(staged, 1);
  assert.equal(committed, 1);
  assert.deepEqual(treeHashes(uploadsDir), files);
  assert.equal(
    app.http.storage.getAttachmentContent({ id: attachment.id }).content.toString(),
    'synthetic-original-file'
  );
  const after = snapshotRows(store);
  for (const table of ['entities', 'local_revisions', 'sync_outbox']) assert.deepEqual(after[table], before[table]);
  assert.equal(
    after.metadata.find(row => row.key === 'aiRuntimeEpoch').value,
    before.metadata.find(row => row.key === 'aiRuntimeEpoch').value
  );
  assert.equal(store.deletionFacts.has('notes', note.id), true);
  assert.throws(() => app.http.storage.importKnowledgeBase(snapshot), { code: 'LOCAL_DELETION_FACT_CONFLICT' });
  assert.equal(staged, 1, '早检拒绝不会创建第二个附件暂存目录');
  assert(
    !fs
      .readdirSync(root)
      .some(
        name =>
          name.startsWith('.uploads.import-') ||
          name.startsWith('uploads.backup-') ||
          name.startsWith('uploads.failed-')
      )
  );
});

for (const [name, id, viaImport] of [
  ['超长业务 ID', 'x'.repeat(2049), false],
  ['带首尾空白的导入 ID', ' tag-padded ', true]
])
  test(`C1 合法实体身份：${name}可删除，事实保留原字符且禁止同 ID 重建`, t => {
    const root = temporaryDirectory(t),
      file = path.join(root, 'local.sqlite');
    let store = createSqliteDataStore(file);
    t.after(() => store.close());
    const app = createAppContext({
      dataStore: store,
      ownerId: 'demo',
      storageRootDir: root,
      uploadsDir: path.join(root, 'uploads')
    });
    const knowledge = app.modules.knowledge,
      space = knowledge.knowledgeSpaceService.createDefaultKnowledgeSpace({ userId: 'demo' });
    if (viaImport) {
      const input = app.http.storage.exportKnowledgeBase();
      input.data.tags.push({ id, name, spaceId: space.id, isSystem: false });
      app.http.storage.importKnowledgeBase(input);
    } else knowledge.tagService.createTag({ id, name, spaceId: space.id });
    const saved = store.exportSnapshot();
    assert(saved.data.tags.some(record => record.id === id));
    app.http.knowledge.deleteTag({ id });
    assert(!store.state.tags.some(record => record.id === id));
    const facts = store.deletionFacts.list();
    assert.equal(facts.length, 1);
    assert.equal(facts[0].entityId, id);
    assert.equal(
      store.readSync(db => db.prepare('SELECT entity_id FROM deletion_facts').get().entity_id),
      id
    );
    if (viaImport)
      assert.equal(store.deletionFacts.has('tags', id.trim()), false, '不得把原 ID 改写为 trim 后的另一身份');
    assert.throws(() => store.importSnapshot(saved), { code: 'LOCAL_DELETION_FACT_CONFLICT' });
    assert.throws(
      () =>
        store.runTransaction(() =>
          store.state.tags.push(structuredClone(saved.data.tags.find(record => record.id === id)))
        ),
      { code: 'LOCAL_DELETION_FACT_CONFLICT' }
    );
    store.close();
    store = createSqliteDataStore(file);
    assert.deepEqual(store.deletionFacts.list(), facts);
    assert.equal(store.deletionFacts.has('tags', id), true);
    assert.throws(() => store.prepareImport(saved), { code: 'LOCAL_DELETION_FACT_CONFLICT' });
  });

test('版本别名删除事实仅从同 epoch 已确认基线推导，并校验规范版本身份', async t => {
  const { factHash, validateFact } = await import('../src/sqlite-deletion-facts-contract.mjs');
  for (const baseline of ['confirmed', 'different-epoch', 'unconfirmed', 'missing']) {
    const w = openWorkspace(temporaryDirectory(t));
    t.after(() => w.store.close());
    const note = createNote(w),
      version = w.store.state.noteVersions.find(item => item.noteId === note.id);
    const alias = { ...version, id: `alias-${baseline}` };
    w.store.runTransaction(() => w.store.state.noteVersions.push(alias));
    w.store.metadataTransaction(db => {
      for (const [key, value] of Object.entries({
        serverUrl: 'https://synthetic.example',
        ownerId: 'demo',
        serverEpoch: 'epoch',
        epoch: baseline === 'different-epoch' ? 'old-epoch' : 'epoch'
      })) {
        db.prepare('INSERT OR REPLACE INTO metadata VALUES (?,?)').run(`sync:${key}`, JSON.stringify(value));
      }
      if (baseline !== 'missing')
        db.prepare('INSERT INTO sync_base VALUES (?,?,?,?)').run(
          'noteVersions',
          version.id,
          baseline === 'unconfirmed' ? null : 1,
          JSON.stringify(version)
        );
      observeRemoteDeletionFacts(db, [{ collection: 'noteVersions', id: version.id, revision: 2, value: null }], {
        epoch: 'epoch',
        versions: w.store.state.noteVersions
      });
    });
    const record = w.store.deletionFacts.list().find(item => item.entityId === alias.id);
    assert.equal(Boolean(record), baseline === 'confirmed', `${baseline} 不得猜测别名删除事实`);
    if (!record) continue;
    assert.equal(record.source.canonicalVersionId, version.id);
    const scope = w.store.readSync(db =>
      JSON.parse(db.prepare("SELECT value FROM metadata WHERE key='deletionFactsScope'").get().value)
    );
    for (const invalid of [
      { canonicalVersionId: alias.id },
      { noteId: '' },
      { epoch: null },
      { contentHash: [version.contentHash] }
    ]) {
      const changed = { ...record, source: { ...record.source, ...invalid } };
      changed.observationId = factHash([changed.scopeId, changed.collection, changed.entityId, changed.source]);
      assert.throws(() => validateFact(changed, scope), { code: 'LOCAL_DELETION_FACT_INVALID' });
    }
  }
});
