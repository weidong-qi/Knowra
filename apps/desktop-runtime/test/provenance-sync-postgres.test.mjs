import assert from 'node:assert/strict';
import path from 'node:path';
import { once } from 'node:events';
import { test } from 'node:test';
import { createPostgresTestDatabase } from '../../../scripts/test-support/postgres-test-database.mjs';
import { createAppContext } from '../../api/src/app.factory.js';
import { createPostgresAppContext } from '../../api/src/postgres-app.factory.js';
import { createPostgresAiRepository } from '../../api/src/modules/ai/postgres-record-repository.js';
import { createServer } from '../../api/src/server.js';
import { createAttachmentTransfer } from '../../api/src/modules/sync/attachment-transfer.js';
import { syncContract } from '../../api/src/modules/sync/protocol-contract.ts';
import { requestHash } from '../../api/src/modules/sync/journal.ts';
import { createKnowledgeExtractionJobFixture } from '../../api/test/fixtures/knowledge-extraction-job.fixture.js';
import { assertMinimalProvenanceTransport } from '../../api/test/fixtures/knowledge-artifact-provenance.fixture.js';
import { createSyncEngine } from '../src/sync-engine.mjs';
import { readMeta } from '../src/sync-state.mjs';
import { temporaryDirectory, openWorkspace } from './helpers.mjs';

async function fixture(t) {
  const root = temporaryDirectory(t),
    database = await createPostgresTestDatabase();
  let app, server;
  t.after(async () => {
    try {
      if (server) await new Promise(resolve => server.close(resolve));
      await app?.close();
    } finally {
      await database.close();
    }
  });
  app = await createPostgresAppContext({
    databaseUrl: database.databaseUrl,
    ownerId: 'demo',
    storageRootDir: root,
    uploadsDir: path.join(root, 'uploads')
  });
  await app.http.knowledge.createDefaultKnowledgeSpace();
  server = createServer({ appContext: app, logger: { error() {} } });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`;
  function device(name, fetcher) {
    const directory = path.join(root, name),
      workspace = openWorkspace(directory);
    const context = createAppContext({
      dataStore: workspace.store,
      uploadsDir: path.join(directory, 'uploads'),
      storageRootDir: directory
    });
    const engine = createSyncEngine(workspace.store, {
      autoSync: false,
      fetcher,
      noteService: workspace.knowledge.noteService,
      entityTransfer: createAttachmentTransfer({
        uploadsDir: path.join(directory, 'uploads'),
        storageRootDir: directory
      })
    });
    t.after(async () => {
      await engine.close();
      workspace.store.close();
    });
    return { ...workspace, app: context, engine, connect: () => engine.configure({ serverUrl: origin }) };
  }
  return { app, origin, device, ai: createPostgresAiRepository({ client: app.prisma, ownerId: 'demo' }) };
}
const options = { skip: !process.env.KNOWRA_SYNC_TEST_DATABASE_URL, timeout: 60000 };
const clean = device => assert.equal(device.engine.status().error, null, JSON.stringify(device.engine.status()));

test('真实PostgreSQL05B：Mock摘要通过优化分页与增量到SQLite，schema7拒旧且绑定owner/epoch', options, async t => {
  const cloud = await fixture(t),
    delta = cloud.device('delta');
  await delta.connect();
  const job = await createKnowledgeExtractionJobFixture(cloud.app, cloud.ai);
  const receipt = await cloud.app.knowledgeExtractionCommit.commit(job.input),
    artifactId = receipt.candidates[0].candidateInput.id;
  const record = await cloud.app.repositories.knowledgeArtifactProvenanceRepository.findByArtifactId(artifactId);
  let pages = 0;
  const fresh = cloud.device('fresh', (url, init) => {
    if (url.includes('/snapshot?')) {
      pages++;
      url += '&limit=1';
    }
    return fetch(url, init);
  });
  await fresh.connect();
  await delta.engine.sync();
  clean(fresh);
  clean(delta);
  assert(pages > 1);
  for (const device of [fresh, delta]) {
    assert.deepEqual(device.store.state.knowledgeArtifactProvenance, [record]);
    assertMinimalProvenanceTransport(device.store.exportSnapshot(), record);
    assert.deepEqual((await device.app.http.knowledge.getKnowledgeProvenance({ id: artifactId })).record, record);
  }
  assert.deepEqual((await cloud.app.http.knowledge.getKnowledgeProvenance({ id: artifactId })).record, record);
  const old = await fetch(`${cloud.origin}/api/sync/bootstrap`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}'
  });
  assert.equal(old.status, 422);
  assert.equal((await old.json()).error.code, 'SYNC_CLIENT_UPGRADE_REQUIRED');
  const start = await cloud.app.http.sync.bootstrap(syncContract());
  await cloud.app.prisma.$executeRawUnsafe(
    `UPDATE "SyncJournal" SET payload = jsonb_set(payload, ARRAY['snapshots', $1, 'ownerId'], '"other-owner"'::jsonb) WHERE "ownerId" = 'demo'`,
    start.snapshotId
  );
  await assert.rejects(() => cloud.app.http.sync.snapshot({ ...syncContract(), snapshotId: start.snapshotId }), {
    code: 'SYNC_SNAPSHOT_CONTRACT_MISMATCH'
  });
  const exported = await cloud.app.http.storage.exportKnowledgeBase();
  assertMinimalProvenanceTransport(exported, record);
});

test('真实PostgreSQL05B：SQLite摘要原子上行alias与丢确认重试，另一SQLite保留不可变scope/hash', options, async t => {
  const cloud = await fixture(t);
  let lose = true;
  const operations = [],
    results = [];
  const author = cloud.device('author', async (url, init) => {
    const response = await fetch(url, init);
    if (url.endsWith('/batch')) {
      operations.push(JSON.parse(init.body));
      const result = await response.clone().json();
      results.push({ status: response.status, body: result });
      if (lose && response.ok && result.data?.status === 'accepted') {
        lose = false;
        throw new Error('合成丢确认');
      }
    }
    return response;
  });
  await author.connect();
  clean(author);
  const job = await createKnowledgeExtractionJobFixture(author.app),
    receipt = author.app.knowledgeExtractionCommit.commit(job.input);
  const record = structuredClone(author.store.state.knowledgeArtifactProvenance[0]),
    scope = structuredClone(author.store.state.analysisScopeSnapshots[0]);
  const cloudNote = await cloud.app.http.knowledge.createNote({
    id: job.note.id,
    title: job.note.title,
    rawMarkdown: job.note.rawMarkdown,
    spaceId: job.space.id
  });
  assert.deepEqual(cloudNote.annotationStructure, job.note.annotationStructure);
  const canonical = (await cloud.app.modules.knowledge.noteVersionService.listVersions({ noteId: job.note.id }))[0];
  assert.notEqual(canonical.id, record.sources[0].originNoteVersionId);
  assert(author.engine.status().pendingEntities > 0);
  await author.engine.sync();
  assert.equal(
    operations.length,
    1,
    JSON.stringify({ phase: author.engine.status().phase, reasons: author.engine.status().entityConflict?.reasons })
  );
  assert.equal(results[0].status, 200);
  assert.equal(results[0].body.data.status, 'accepted');
  assert.equal(lose, false);
  assert.equal(author.engine.status().error?.code, 'SYNC_NETWORK_UNAVAILABLE');
  assert.deepEqual(
    author.store.readSync(db => readMeta(db, 'entityUpload')),
    operations[0]
  );
  assert.deepEqual(
    await cloud.app.repositories.knowledgeArtifactProvenanceRepository.findByArtifactId(record.artifactId),
    record
  );
  assert.deepEqual(await cloud.app.http.knowledge.getAnalysisScope({ id: scope.id }, { spaceId: job.space.id }), scope);
  const receiptInput = {
    ...syncContract(),
    datasetEpoch: operations[0].datasetEpoch,
    deviceId: operations[0].deviceId,
    operationId: operations[0].operationId,
    requestHash: requestHash(operations[0])
  };
  const accepted = await cloud.app.http.sync.operationReceipt(receiptInput);
  assert.equal(accepted.status, 'found');
  assert.deepEqual(accepted.result, results[0].body.data);
  await author.engine.sync();
  clean(author);
  assert.equal(operations.length, 2);
  assert.deepEqual(operations[1], operations[0]);
  assert.equal(operations[0].operationId, operations[1].operationId);
  assert.equal(requestHash(operations[1]), receiptInput.requestHash);
  assert.deepEqual(results[1], results[0]);
  assert.equal(
    author.store.readSync(db => readMeta(db, 'entityUpload')),
    null
  );
  assert.equal(author.engine.status().pendingEntities, 0);
  assert.equal(author.engine.status().entityConflict, null);
  assert.equal(author.store.getStatus().pendingOperations, 0);
  assertMinimalProvenanceTransport(operations[0].changes, record);
  assert.equal(await cloud.app.prisma.knowledgeArtifactProvenance.count(), 1);
  const reader = cloud.device('reader');
  await reader.connect();
  clean(reader);
  const read = await reader.app.http.knowledge.getKnowledgeProvenance({ id: record.artifactId });
  assert.deepEqual(read.record, record);
  assert.equal(read.sources[0].resolvedVersionId, canonical.id);
  assert.equal(read.sources[0].aliasUsed, true);
  assert.deepEqual(reader.store.state.analysisScopeSnapshots, [scope]);
  assert.deepEqual(author.store.knowledgeExtractionCommitStore.get(job.records.job), receipt);
});
