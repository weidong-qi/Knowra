import assert from 'node:assert/strict';
import path from 'node:path';
import { once } from 'node:events';
import { test } from 'node:test';
import { createAppContext } from '../../api/src/app.factory.ts';
import { createFileDataStore } from '../../api/src/infrastructure/file-data-store.ts';
import { createServer } from '../../api/src/server.ts';
import { createAttachmentTransfer } from '../../api/src/modules/sync/attachment-transfer.ts';
import { syncContract } from '../../api/src/modules/sync/protocol-contract.ts';
import { requestHash } from '../../api/src/modules/sync/journal.ts';
import { createKnowledgeExtractionJobFixture } from '../../api/test/fixtures/knowledge-extraction-job.fixture.js';
import { assertMinimalProvenanceTransport } from '../../api/test/fixtures/knowledge-artifact-provenance.fixture.js';
import { createLegacyKnowledgeArtifactProvenance } from '../../api/src/modules/knowledge/domain/knowledge-artifact-provenance-contract.ts';
import { createSyncEngine } from '../src/sync-engine.mjs';
import { applyEntityRemote, nextEntityUpload } from '../src/entity-sync-state.mjs';
import { readMeta, writeMeta } from '../src/sync-state.mjs';
import { temporaryDirectory, openWorkspace } from './helpers.mjs';
import { reorderJsonObjectKeys } from './fixtures/sync-json-order.mjs';

async function fixture(t, { reorderResponseKeys = false } = {}) {
  const root = temporaryDirectory(t),
    store = createFileDataStore(path.join(root, 'cloud.json'));
  const app = createAppContext({ dataStore: store, uploadsDir: path.join(root, 'uploads'), storageRootDir: root });
  app.http.knowledge.createDefaultKnowledgeSpace();
  const server = createServer({ appContext: app, logger: { error() {} } });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`;
  function device(name, fetcher) {
    const directory = path.join(root, name),
      workspace = openWorkspace(directory);
    const context = createAppContext({
      dataStore: workspace.store,
      uploadsDir: path.join(directory, 'uploads'),
      storageRootDir: directory
    });
    const transport = reorderResponseKeys
      ? async (url, init) => {
          const response = await (fetcher ?? fetch)(url, init);
          return Response.json(reorderJsonObjectKeys(await response.json()), {
            status: response.status,
            headers: response.headers
          });
        }
      : fetcher;
    const engine = createSyncEngine(workspace.store, {
      autoSync: false,
      fetcher: transport,
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
  return { root, store, app, origin, device };
}
const clean = device => assert.equal(device.engine.status().error, null, JSON.stringify(device.engine.status()));
const meta = (device, key) => device.store.readSync(db => readMeta(db, key));

test('云端Mock摘要通过增量与逐页bootstrap到两SQLite端，原文编辑与来源回读保留原始事实', async t => {
  const cloud = await fixture(t),
    delta = cloud.device('delta');
  await delta.connect();
  const job = await createKnowledgeExtractionJobFixture(cloud.app);
  const receipt = cloud.app.knowledgeExtractionCommit.commit(job.input),
    artifactId = receipt.candidates[0].candidateInput.id;
  const record = cloud.store.state.knowledgeArtifactProvenance[0];
  let pages = 0;
  const fresh = cloud.device('fresh', (url, options) => {
    if (url.includes('/snapshot?')) {
      pages++;
      url += '&limit=1';
    }
    return fetch(url, options);
  });
  await fresh.connect();
  await delta.engine.sync();
  clean(fresh);
  clean(delta);
  assert(pages > 1);
  for (const device of [fresh, delta]) {
    assert.deepEqual(device.store.state.knowledgeArtifactProvenance, [record]);
    assertMinimalProvenanceTransport(device.store.exportSnapshot(), record);
    assert.equal(
      (await device.app.http.knowledge.getKnowledgeProvenance({ id: artifactId })).record.provenanceHash,
      record.provenanceHash
    );
    assert.equal(device.store.aiRepository.list('aiJob').length, 0);
  }
  delta.knowledge.knowledgeItemService.updateItem(artifactId, { title: '用户编辑保留' });
  delta.knowledge.noteService.updateNote(job.note.id, { rawMarkdown: '' });
  await delta.engine.sync();
  await fresh.engine.sync();
  clean(delta);
  clean(fresh);
  assert.deepEqual(fresh.store.state.knowledgeArtifactProvenance, [record]);
  assert.equal(fresh.knowledge.knowledgeItemService.getItem(artifactId).title, '用户编辑保留');
  assert.equal(
    (await fresh.app.http.knowledge.getKnowledgeProvenance({ id: artifactId })).sources[0].sourceState,
    'stale'
  );
});

for (const reorderResponseKeys of [false, true])
  test(`SQLite Mock上行同正文版本alias、scope与摘要不可变，丢确认后暂停保全且另一端仍可回读（${reorderResponseKeys ? 'JSONB式对象键序' : 'JSON原键序'}）`, async t => {
    const cloud = await fixture(t, { reorderResponseKeys });
    let lose = true;
    const operations = [],
      results = [];
    const a = cloud.device('author', async (url, options) => {
      const response = await fetch(url, options);
      if (url.endsWith('/batch')) {
        operations.push(JSON.parse(options.body));
        const result = await response.clone().json();
        results.push({ status: response.status, body: result });
        if (lose && response.ok && result.data?.status === 'accepted') {
          lose = false;
          throw new Error('合成确认丢失');
        }
      }
      return response;
    });
    await a.connect();
    const job = await createKnowledgeExtractionJobFixture(a.app);
    const receipt = a.app.knowledgeExtractionCommit.commit(job.input),
      record = structuredClone(a.store.state.knowledgeArtifactProvenance[0]);
    const scope = structuredClone(a.store.state.analysisScopeSnapshots[0]);
    await cloud.app.http.knowledge.createNote({
      id: job.note.id,
      title: job.note.title,
      rawMarkdown: job.note.rawMarkdown,
      spaceId: job.space.id
    });
    const canonical = cloud.store.state.noteVersions.find(version => version.noteId === job.note.id);
    assert.notEqual(canonical.id, record.sources[0].originNoteVersionId);
    assert(a.engine.status().pendingEntities > 0);
    await a.engine.sync();
    assert.equal(
      operations.length,
      1,
      JSON.stringify({ phase: a.engine.status().phase, reasons: a.engine.status().entityConflict?.reasons })
    );
    assert.equal(results[0].status, 200);
    assert.equal(results[0].body.data.status, 'accepted');
    assert.equal(lose, false);
    assert.equal(a.engine.status().error?.code, 'SYNC_RESULT_UNCERTAIN');
    assert.deepEqual(meta(a, 'entityUpload'), operations[0]);
    assert.deepEqual(cloud.store.state.knowledgeArtifactProvenance, [record]);
    assert.deepEqual(cloud.store.state.analysisScopeSnapshots, [scope]);
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
    await a.engine.sync();
    assert.equal(a.engine.status().error.code, 'SYNC_RESULT_UNCERTAIN');
    assert.equal(operations.length, 1);
    assert.equal(requestHash(operations[0]), receiptInput.requestHash);
    assert.deepEqual(meta(a, 'entityUpload'), operations[0]);
    assert(a.engine.status().pendingEntities > 0);
    assert.equal(a.engine.status().entityConflict, null);
    assert(a.store.getStatus().pendingOperations > 0);
    assertMinimalProvenanceTransport(operations[0].changes, record);
    assert.deepEqual(cloud.store.state.knowledgeArtifactProvenance, [record]);
    assert.deepEqual(cloud.store.state.analysisScopeSnapshots, [scope]);
    assert.equal(cloud.store.state.knowledgeEvidence[0].noteVersionId, canonical.id);
    assert.deepEqual(a.store.knowledgeExtractionCommitStore.get(job.records.job), receipt);
    const b = cloud.device('reader');
    await b.connect();
    clean(b);
    const read = await b.app.http.knowledge.getKnowledgeProvenance({ id: record.artifactId });
    assert.equal(read.sources[0].originalVersionId, record.sources[0].originNoteVersionId);
    assert.equal(read.sources[0].resolvedVersionId, canonical.id);
    assert.equal(read.sources[0].aliasUsed, true);
    assert.deepEqual(read.record, record);
    assert.deepEqual(b.store.state.analysisScopeSnapshots, [scope]);
  });

test('下行不能将已保存的recorded降为legacy，校验失败不推进游标或覆盖本地摘要', async t => {
  const cloud = await fixture(t),
    job = await createKnowledgeExtractionJobFixture(cloud.app);
  cloud.app.knowledgeExtractionCommit.commit(job.input);
  const device = cloud.device('device');
  await device.connect();
  clean(device);
  const record = structuredClone(device.store.state.knowledgeArtifactProvenance[0]),
    cursor = meta(device, 'cursor');
  const legacy = createLegacyKnowledgeArtifactProvenance(record.artifactId);
  assert.equal(
    applyEntityRemote(
      device.store,
      [{ collection: 'knowledgeArtifactProvenance', id: record.id, value: legacy, revision: 999 }],
      'bad-cursor',
      meta(device, 'epoch')
    ),
    false
  );
  assert.deepEqual(device.store.state.knowledgeArtifactProvenance, [record]);
  assert.equal(meta(device, 'cursor'), cursor);
});

test('旧notes-only引擎明确拒绝schema8，不清空本地修改或推进游标', async t => {
  const cloud = await fixture(t),
    workspace = openWorkspace(path.join(cloud.root, 'old'));
  const note = workspace.knowledge.noteService.createNote({
    title: '升级前编辑',
    rawMarkdown: '保留',
    spaceId: workspace.space.id
  });
  const before = workspace.store.exportSnapshot(),
    pending = workspace.store.readOutbox();
  const engine = createSyncEngine(workspace.store, { autoSync: false, noteService: workspace.knowledge.noteService });
  t.after(async () => {
    await engine.close();
    workspace.store.close();
  });
  await assert.rejects(engine.configure({ serverUrl: cloud.origin }), { code: 'SYNC_CLIENT_UPGRADE_REQUIRED' });
  assert.deepEqual(workspace.store.exportSnapshot().data, before.data);
  assert.deepEqual(workspace.store.readOutbox(), pending);
  assert.equal(meta(workspace, 'cursor'), null);
  assert.equal(workspace.knowledge.noteService.getNote(note.id).rawMarkdown, '保留');
});

test('schema6冻结批次已有回执也不自动核销，保留原hash及后继编辑', async t => {
  const cloud = await fixture(t),
    device = cloud.device('upgrade');
  await device.connect();
  const note = device.knowledge.noteService.createNote({
    title: '旧冻结操作',
    rawMarkdown: '已提交版',
    spaceId: device.space.id
  });
  const current = nextEntityUpload(device.store),
    old = structuredClone(current);
  delete old.entitySchemaVersion;
  delete old.capabilities;
  const accepted = await cloud.app.http.sync.pushBatch(current);
  cloud.store.runSyncTransaction(() => {
    cloud.store.getSyncJournal().receipts[JSON.stringify([old.deviceId, old.operationId])] = {
      hash: requestHash(old),
      result: accepted
    };
  });
  device.store.metadataTransaction(db => writeMeta(db, 'entityUpload', old));
  device.knowledge.noteService.updateNote(note.id, { rawMarkdown: '升级后的继续编辑' });
  await device.engine.sync();
  assert.equal(device.engine.status().error.code, 'SYNC_RESULT_UNCERTAIN');
  assert.equal(device.knowledge.noteService.getNote(note.id).rawMarkdown, '升级后的继续编辑');
  assert.equal(cloud.store.state.notes.find(value => value.id === note.id).rawMarkdown, '已提交版');
  assert.deepEqual(meta(device, 'entityUpload'), old);
  assert(device.engine.status().pendingEntities > 0);
  assert.equal(
    cloud.store.getSyncJournal().receipts[JSON.stringify([old.deviceId, old.operationId])].hash,
    requestHash(old)
  );
});

test('旧冻结批次回执已裁剪时暂停，保留原operation/hash/outbox与游标', async t => {
  const cloud = await fixture(t),
    device = cloud.device('unknown');
  await device.connect();
  device.knowledge.noteService.createNote({ title: '待核对旧操作', rawMarkdown: '不能吞掉', spaceId: device.space.id });
  const old = structuredClone(nextEntityUpload(device.store));
  delete old.entitySchemaVersion;
  delete old.capabilities;
  device.store.metadataTransaction(db => writeMeta(db, 'entityUpload', old));
  cloud.store.runSyncTransaction(() => {
    (cloud.store.getSyncJournal().deviceSequences ??= {})[old.deviceId] = old.sequence;
  });
  const before = device.store.exportSnapshot(),
    outbox = device.store.readOutbox(),
    cursor = meta(device, 'cursor');
  await device.engine.sync();
  assert.equal(device.engine.status().error.code, 'SYNC_RESULT_UNCERTAIN');
  assert.deepEqual(meta(device, 'entityUpload'), old);
  assert.deepEqual(device.store.readOutbox(), outbox);
  assert.deepEqual(device.store.exportSnapshot().data, before.data);
  assert.equal(meta(device, 'cursor'), cursor);
});

test('旧冻结批次回执缺席不能证明未接纳，不换operation且保留outbox', async t => {
  const cloud = await fixture(t),
    sent = [],
    device = cloud.device('not-accepted', (url, init) => {
      if (url.endsWith('/batch')) sent.push(JSON.parse(init.body));
      return fetch(url, init);
    });
  await device.connect();
  const note = device.knowledge.noteService.createNote({
    title: '未送达旧操作',
    rawMarkdown: '升级后完整发送',
    spaceId: device.space.id
  });
  const old = structuredClone(nextEntityUpload(device.store));
  delete old.entitySchemaVersion;
  delete old.capabilities;
  device.store.metadataTransaction(db => writeMeta(db, 'entityUpload', old));
  const outbox = device.store.readOutbox();
  await device.engine.sync();
  assert.equal(device.engine.status().error.code, 'SYNC_RESULT_UNCERTAIN');
  assert.equal(sent.length, 0);
  assert.deepEqual(meta(device, 'entityUpload'), old);
  assert.deepEqual(device.store.readOutbox(), outbox);
  assert.equal(device.knowledge.noteService.getNote(note.id).rawMarkdown, note.rawMarkdown);
  assert(!cloud.store.state.notes.some(value => value.id === note.id));
  assert(device.engine.status().pendingEntities > 0);
});

test('升级前未确认批次遇资料库换代必须先暂停，不能bootstrap清除原请求或重编号', async t => {
  const cloud = await fixture(t),
    device = cloud.device('changed-epoch');
  await device.connect();
  device.knowledge.noteService.createNote({
    title: '旧世代待确认',
    rawMarkdown: '完整保留原操作',
    spaceId: device.space.id
  });
  const old = structuredClone(nextEntityUpload(device.store));
  delete old.entitySchemaVersion;
  delete old.capabilities;
  device.store.metadataTransaction(db => writeMeta(db, 'entityUpload', old));
  const before = device.store.exportSnapshot(),
    outbox = device.store.readOutbox(),
    cursor = meta(device, 'cursor');
  cloud.store.commitImport(cloud.store.exportSnapshot());
  await device.engine.sync();
  assert.equal(device.engine.status().error.code, 'SYNC_RESULT_UNCERTAIN');
  assert.deepEqual(meta(device, 'entityUpload'), old);
  assert.equal(meta(device, 'cursor'), cursor);
  assert.deepEqual(device.store.exportSnapshot().data, before.data);
  assert.deepEqual(device.store.readOutbox(), outbox);
});

test('快照分页绑定被替换或未来schema响应时，不应用半页、不推进cursor、升级后可重建', async t => {
  for (const field of ['ownerId', 'datasetEpoch', 'snapshotId', 'entitySchemaVersion', 'count', 'nextOffset']) {
    const cloud = await fixture(t);
    const job = await createKnowledgeExtractionJobFixture(cloud.app);
    cloud.app.knowledgeExtractionCommit.commit(job.input);
    let tamper = true;
    const device = cloud.device(`tamper-${field}`, async (url, init) => {
      const response = await fetch(url, init);
      if (tamper && url.includes('/snapshot?')) {
        const body = await response.json();
        body.data[field] =
          field === 'entitySchemaVersion'
            ? 10
            : field === 'count'
              ? body.data.count + 1
              : field === 'nextOffset'
                ? -1
                : 'foreign';
        return Response.json(body);
      }
      return response;
    });
    const before = device.store.exportSnapshot(),
      pending = device.store.readOutbox();
    await device.connect();
    assert.equal(device.engine.status().error.code, 'SYNC_SNAPSHOT_CONTRACT_MISMATCH');
    assert.equal(meta(device, 'cursor'), null);
    assert.deepEqual(device.store.exportSnapshot().data, before.data);
    assert.deepEqual(device.store.readOutbox(), pending);
    tamper = false;
    await device.engine.sync();
    clean(device);
    assert.equal(device.store.state.knowledgeArtifactProvenance.length, 1);
  }
});
