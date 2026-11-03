import assert from 'node:assert/strict';
import path from 'node:path';
import { once } from 'node:events';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { createFileDataStore } from '../../api/src/infrastructure/file-data-store.js';
import { createAppContext } from '../../api/src/app.factory.js';
import { createServer } from '../../api/src/server.js';
import { createAttachmentTransfer } from '../../api/src/modules/sync/attachment-transfer.ts';
import { syncContract, syncContractQuery } from '../../api/src/modules/sync/protocol-contract.ts';
import { requestHash } from '../../api/src/modules/sync/journal.ts';
import { syntheticProvenanceFixture } from '../../api/test/fixtures/knowledge-artifact-provenance.fixture.js';
import { createSyncEngine } from '../src/sync-engine.mjs';
import { applyEntityRemote, nextEntityUpload } from '../src/entity-sync-state.mjs';
import { applyRemote, acknowledge, nextUpload, readMeta, writeMeta } from '../src/sync-state.mjs';
import { temporaryDirectory, openWorkspace } from './helpers.mjs';

async function fixture(t) {
  const root = temporaryDirectory(t),
    store = createFileDataStore(path.join(root, 'cloud.json'));
  const app = createAppContext({ dataStore: store, uploadsDir: path.join(root, 'uploads'), storageRootDir: root });
  const knowledge = app.modules.knowledge;
  const space = knowledge.knowledgeSpaceService.createDefaultKnowledgeSpace({ userId: 'demo' });
  const note = knowledge.noteService.createNote({
    title: '合成同步样本',
    rawMarkdown: '合成共同基线',
    spaceId: space.id
  });
  const server = createServer({ appContext: app, logger: { error() {} } });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`;
  function device(name, { fetcher, beforeCommit } = {}) {
    const directory = path.join(root, name),
      file = path.join(directory, 'local.sqlite');
    const result = { file };
    function open() {
      Object.assign(result, openWorkspace(directory, { beforeCommit }));
      result.engine = createSyncEngine(result.store, {
        autoSync: false,
        fetcher,
        noteService: result.knowledge.noteService,
        entityTransfer: createAttachmentTransfer({
          uploadsDir: path.join(directory, 'uploads'),
          storageRootDir: directory
        })
      });
    }
    open();
    result.connect = () => result.engine.configure({ serverUrl: origin });
    result.restart = async prepare => {
      await result.engine.close();
      result.store.close();
      if (prepare) {
        const db = new DatabaseSync(file);
        try {
          prepare(db);
        } finally {
          db.close();
        }
      }
      open();
    };
    t.after(async () => {
      await result.engine.close();
      result.store.close();
    });
    return result;
  }
  async function request(route, body) {
    const response = await fetch(`${origin}/api/sync/${route}`, {
      method: body ? 'POST' : 'GET',
      headers: body ? { 'Content-Type': 'application/json' } : {},
      ...(body ? { body: JSON.stringify(body) } : {})
    });
    const payload = await response.json();
    assert.equal(response.status, 200, JSON.stringify(payload));
    return payload.data;
  }
  function purgeNote() {
    knowledge.noteService.deleteNote(note.id);
    app.http.knowledge.permanentlyDeleteNote({ id: note.id });
  }
  return { root, store, app, knowledge, space, note, origin, device, request, purgeNote };
}
const meta = (device, key) => device.store.readSync(db => readMeta(db, key));
const clean = device => assert.equal(device.engine.status().error, null, JSON.stringify(device.engine.status().error));
const fact = (device, collection, id) =>
  device.store.deletionFacts.list().find(record => record.collection === collection && record.entityId === id);
function assertRemoteFact(device, cloud, collection, id, epoch = meta(device, 'serverEpoch')) {
  const record = fact(device, collection, id);
  assert(record, `${collection}/${id} 应持久保存远端删除事实`);
  assert.deepEqual(record.source, {
    kind: 'remote-delete',
    serverOrigin: cloud.origin,
    ownerId: 'demo',
    epoch,
    revision: cloud.store.getSyncJournal().revisions[JSON.stringify([collection, id])]
  });
  assert.equal(record.deletedAt, null);
  return record;
}
const baseEntries = device =>
  device.store.readSync(db =>
    db
      .prepare('SELECT * FROM sync_base')
      .all()
      .map(row => ({
        collection: row.collection,
        id: row.id,
        revision: row.server_revision,
        value: JSON.parse(row.payload)
      }))
  );
function seedProvenance(cloud) {
  const synthetic = syntheticProvenanceFixture({ recorded: true, alias: true });
  cloud.store.runTransaction(() => {
    for (const [collection, values] of Object.entries(synthetic.state))
      cloud.store.state[collection].push(...structuredClone(values));
  });
  return synthetic;
}
function purgeKnowledge(cloud, id) {
  cloud.knowledge.knowledgeItemService.trash(id);
  const preflight = cloud.knowledge.inspectKnowledgePurge(id);
  assert.equal(preflight.decision, 'can-purge-no-history');
  cloud.knowledge.permanentlyDeleteKnowledgeItem(id, { expectedUpdatedAt: preflight.expectedUpdatedAt });
}
function failAfterReceipt() {
  const probe = { armed: false, blocked: false, received: [], pulls: 0, stop: true };
  probe.fetcher = async (url, init) => {
    if (probe.blocked && probe.stop && url.includes('/changes?')) {
      probe.pulls++;
      throw new Error('合成：回执落库后拉取断网');
    }
    const response = await fetch(url, init);
    if (probe.armed && (url.includes('/operation-receipt?') || url.endsWith('/batch'))) {
      probe.received.push((await response.clone().json()).data);
      probe.blocked = true;
    }
    return response;
  };
  return probe;
}

test('C1 HTTP 墓碑与实体/基线同事务回滚；重开、断连、换代和 reset 缺席保留首次事实', async t => {
  const cloud = await fixture(t);
  let fail = false;
  const device = cloud.device('apply', {
    beforeCommit() {
      if (fail && device.store.deletionFacts.has('notes', cloud.note.id)) throw new Error('合成远端提交失败');
    }
  });
  await device.connect();
  clean(device);
  const saved = device.store.exportSnapshot(),
    cursor = meta(device, 'cursor');
  cloud.purgeNote();
  fail = true;
  await device.engine.sync();
  assert.match(device.engine.status().error.message, /合成远端提交失败/);
  assert.deepEqual(device.store.exportSnapshot().data, saved.data);
  assert.deepEqual(device.store.deletionFacts.list(), []);
  assert.equal(meta(device, 'cursor'), cursor);
  fail = false;
  await device.engine.sync();
  clean(device);
  assertRemoteFact(device, cloud, 'notes', cloud.note.id);
  const first = device.store.deletionFacts.list();
  assert(first.every(record => record.source.kind === 'remote-delete'));
  await device.restart();
  assert.deepEqual(device.store.deletionFacts.list(), first);
  await device.engine.disconnect();
  assert.deepEqual(device.store.deletionFacts.list(), first);
  const oldEpoch = meta(device, 'epoch');
  cloud.store.commitImport(cloud.store.exportSnapshot());
  await device.connect();
  clean(device);
  assert.notEqual(meta(device, 'epoch'), oldEpoch);
  assert.deepEqual(device.store.deletionFacts.list(), first, '重复观察与新 epoch 不覆写首次来源');
  // reset 的真实处理入口：新快照只含 live 行，不再携带先前墓碑。
  applyEntityRemote(
    device.store,
    baseEntries(device).filter(entry => entry.value !== null),
    meta(device, 'cursor'),
    meta(device, 'epoch'),
    { reset: true }
  );
  assert(!baseEntries(device).some(entry => entry.id === cloud.note.id));
  assert.deepEqual(device.store.deletionFacts.list(), first);
  assert.throws(() => device.store.commitImport(saved), { code: 'LOCAL_DELETION_FACT_CONFLICT' });
});

for (const choice of ['remote', 'copy'])
  test(`C1 HTTP 删除冲突允许存活原文继续编辑；${choice} 清理本地版本不冒充 purge`, async t => {
    const cloud = await fixture(t),
      device = cloud.device(choice);
    await device.connect();
    clean(device);
    device.knowledge.noteService.updateNote(cloud.note.id, { rawMarkdown: '仅此设备的合成离线正文' });
    const privateVersion = device.store.state.noteVersions.find(
      version => version.content === '仅此设备的合成离线正文'
    );
    cloud.purgeNote();
    await device.engine.sync();
    if (device.engine.status().error) assert.equal(device.engine.status().error.code, 'ENTITY_DELETED');
    assert(device.engine.status().entityConflict);
    assertRemoteFact(device, cloud, 'notes', cloud.note.id);
    device.knowledge.noteService.updateNote(cloud.note.id, { title: '冲突发生后仍可编辑' });
    assert.equal(device.knowledge.noteService.getNote(cloud.note.id).title, '冲突发生后仍可编辑');
    const known = device.store.deletionFacts.list();
    await device.engine.resolve({ conflictId: device.engine.status().entityConflict.id, choice });
    clean(device);
    assert(!device.store.state.notes.some(note => note.id === cloud.note.id));
    assert(!device.store.state.noteVersions.some(version => version.id === privateVersion.id));
    assert.equal(device.store.deletionFacts.has('noteVersions', privateVersion.id), false);
    assert.deepEqual(device.store.deletionFacts.list(), known);
    if (choice === 'copy') assert(device.store.state.notes.some(note => note.rawMarkdown === '仅此设备的合成离线正文'));
    assert.throws(
      () =>
        device.store.runTransaction(() =>
          device.knowledge.noteService.createNote({
            id: cloud.note.id,
            title: '禁止同 ID 复活',
            rawMarkdown: '合成内容',
            spaceId: cloud.space.id
          })
        ),
      { code: 'LOCAL_DELETION_FACT_CONFLICT' }
    );
    assert.deepEqual(device.store.deletionFacts.list(), known);
  });

test('C1 HTTP batch 的正修订空依赖冲突在后续 pull 失败前已持久化', async t => {
  const cloud = await fixture(t),
    probe = failAfterReceipt();
  const tag = cloud.knowledge.tagService.createTag({ spaceId: cloud.space.id, name: '合成依赖标签' });
  cloud.knowledge.noteService.updateNote(cloud.note.id, { tagIds: [tag.id] });
  const device = cloud.device('ack-conflicts', { fetcher: probe.fetcher });
  await device.connect();
  clean(device);
  probe.armed = true;
  device.knowledge.noteService.updateNote(cloud.note.id, { title: '冻结待传标题' });
  const operation = nextEntityUpload(device.store);
  assert(operation.dependencies.some(entry => entry.collection === 'tags' && entry.id === tag.id));
  cloud.knowledge.deleteTagAndCleanup(tag.id);
  await device.engine.sync();
  assert(
    probe.received.some(
      result =>
        result.status === 'conflict' && result.conflicts.some(entry => entry.id === tag.id && entry.value === null)
    )
  );
  assert.equal(probe.pulls, 1);
  assert(device.engine.status().error);
  const first = assertRemoteFact(device, cloud, 'tags', tag.id);
  assert(
    device.store.state.tags.some(value => value.id === tag.id),
    'ack 冲突不提前套用远端主体'
  );
  await device.restart();
  assert.deepEqual(fact(device, 'tags', tag.id), first);
});

test('C1 旧批次 accepted entries 经真实回执查询记账，不依赖后续 pull 或旧 outbox 猜测', async t => {
  const cloud = await fixture(t),
    probe = failAfterReceipt();
  const tag = cloud.knowledge.tagService.createTag({ spaceId: cloud.space.id, name: '升级前删除的合成标签' });
  const device = cloud.device('old-entries', { fetcher: probe.fetcher });
  await device.connect();
  clean(device);
  probe.armed = true;
  device.knowledge.deleteTagAndCleanup(tag.id);
  const current = nextEntityUpload(device.store),
    old = structuredClone(current);
  delete old.entitySchemaVersion;
  delete old.capabilities;
  const accepted = await cloud.request('batch', current);
  assert.equal(accepted.status, 'accepted');
  assert(accepted.entries.some(entry => entry.id === tag.id && entry.value === null));
  // 还原升级前已经保存、schema6 原 hash 的服务器回执；结果由真实 batch 服务产生。
  cloud.store.runSyncTransaction(() => {
    cloud.store.getSyncJournal().receipts[JSON.stringify([old.deviceId, old.operationId])] = {
      hash: requestHash(old),
      result: accepted,
      sequence: old.sequence
    };
  });
  device.store.metadataTransaction(db => writeMeta(db, 'entityUpload', old));
  // 升级前数据库没有 C1 扩展；已发送删除仍只在 outbox，基线还是 live。
  await device.restart(db =>
    db.exec("DROP TABLE deletion_facts; DELETE FROM metadata WHERE key LIKE 'deletionFacts%';")
  );
  assert.deepEqual(device.store.deletionFacts.list(), []);
  await device.engine.sync();
  assert.equal(probe.pulls, 1);
  assert(device.engine.status().error);
  assert.equal(probe.received[0].status, 'found');
  assert.equal(meta(device, 'entityUpload'), null);
  assertRemoteFact(device, cloud, 'tags', tag.id);
});

test('C1 旧 notes current 回执与 legacy acknowledge 均保存远端事实，首次观察不可覆盖', async t => {
  const cloud = await fixture(t),
    probe = failAfterReceipt();
  const device = cloud.device('old-current', { fetcher: probe.fetcher });
  await device.connect();
  clean(device);
  const legacy = cloud.device('legacy-ack');
  await legacy.connect();
  clean(legacy);
  legacy.knowledge.noteService.updateNote(cloud.note.id, { title: '旧确认入口' });
  const legacyOperation = nextUpload(legacy.store);
  probe.armed = true;
  device.knowledge.noteService.updateNote(cloud.note.id, { title: '旧笔记请求' });
  const old = nextUpload(device.store);
  cloud.purgeNote();
  const result = await cloud.request('push', { ...old, ...syncContract() });
  assert.equal(result.status, 'conflict');
  assert.equal(result.current.value, null);
  acknowledge(legacy.store, legacyOperation, result);
  assertRemoteFact(legacy, cloud, 'notes', cloud.note.id);
  cloud.store.runSyncTransaction(() => {
    cloud.store.getSyncJournal().receipts[JSON.stringify([old.deviceId, old.operationId])] = {
      hash: requestHash(old),
      result
    };
  });
  await device.engine.sync();
  assert.equal(probe.pulls, 1);
  assert.equal(probe.received[0].status, 'found');
  const first = assertRemoteFact(device, cloud, 'notes', cloud.note.id);
  assert.equal(
    device.store.readSync(db => db.prepare('SELECT COUNT(*) AS n FROM sync_uploads').get().n),
    0
  );
  acknowledge(device.store, old, result);
  assert.deepEqual(fact(device, 'notes', cloud.note.id), first);
  assert.equal(device.engine.status().conflicts[0].remote, null);
});

test('C1 legacy reset 人工 null 与无修订缺席不造事实，真正 positive/null 才阻止重建', async t => {
  const cloud = await fixture(t),
    device = cloud.device('legacy-apply');
  await device.connect();
  clean(device);
  const epoch = meta(device, 'serverEpoch'),
    original = device.store.exportSnapshot();
  applyRemote(device.store, [], meta(device, 'cursor'), epoch, { reset: true });
  assert.equal(device.store.state.notes.length, 0);
  assert.deepEqual(device.store.deletionFacts.list(), []);
  applyRemote(
    device.store,
    [{ collection: 'notes', id: 'absent-without-revision', revision: null, value: null }],
    meta(device, 'cursor'),
    epoch
  );
  assert.deepEqual(device.store.deletionFacts.list(), []);
  device.store.commitImport(original);
  cloud.purgeNote();
  const start = await cloud.request('bootstrap', syncContract());
  const query = new URLSearchParams({
    snapshotId: start.snapshotId,
    entitySchemaVersion: String(syncContract().entitySchemaVersion),
    capabilities: syncContract().capabilities.join(',')
  });
  const snapshot = await cloud.request(`snapshot?${query}`);
  applyRemote(device.store, snapshot.entries, snapshot.cursor, snapshot.datasetEpoch, { reset: true });
  assertRemoteFact(device, cloud, 'notes', cloud.note.id);
});

test('C1 未核绑定的墓碑不造事实；核实绑定后相同回包的缓存快路仍补记', async t => {
  const cloud = await fixture(t),
    device = cloud.device('cache');
  await device.connect();
  clean(device);
  cloud.purgeNote();
  const page = await cloud.request(
    `changes?cursor=${encodeURIComponent(meta(device, 'cursor'))}&${syncContractQuery()}`
  );
  const entries = page.groups.flatMap(group => group.items).filter(entry => entry.value === null);
  // 窄状态入口模拟尚未核实 owner 的观察：这些真实回包不得预先取得删除权威。
  device.store.metadataTransaction(db => writeMeta(db, 'ownerId', null));
  applyEntityRemote(device.store, entries, page.cursor, page.datasetEpoch);
  assert.deepEqual(device.store.deletionFacts.list(), []);
  const info = await cloud.request('status');
  device.store.metadataTransaction(db => {
    writeMeta(db, 'ownerId', info.ownerId);
    writeMeta(db, 'serverEpoch', info.datasetEpoch);
  });
  const key = device.store.getEntityCacheKey();
  applyEntityRemote(device.store, entries, page.cursor, page.datasetEpoch);
  assert.equal(device.store.getEntityCacheKey(), key, '相同基线通过元数据快路补记，不重做实体合并');
  const first = assertRemoteFact(device, cloud, 'notes', cloud.note.id);
  applyEntityRemote(device.store, entries, page.cursor, page.datasetEpoch);
  assert.deepEqual(fact(device, 'notes', cloud.note.id), first);
});

test('C1 旧冻结请求遇新 epoch 先暂停，保留已知事实且不把未收到的删除当事实', async t => {
  const cloud = await fixture(t),
    routes = [];
  let watch = false;
  const tag = cloud.knowledge.tagService.createTag({ spaceId: cloud.space.id, name: '换代前已知删除' });
  const device = cloud.device('old-epoch', {
    fetcher(url, init) {
      if (watch) routes.push(url);
      return fetch(url, init);
    }
  });
  await device.connect();
  clean(device);
  cloud.knowledge.deleteTagAndCleanup(tag.id);
  await device.engine.sync();
  clean(device);
  assertRemoteFact(device, cloud, 'tags', tag.id);
  device.knowledge.noteService.updateNote(cloud.note.id, { title: '换代前尚未确认' });
  const old = structuredClone(nextEntityUpload(device.store));
  delete old.entitySchemaVersion;
  delete old.capabilities;
  device.store.metadataTransaction(db => writeMeta(db, 'entityUpload', old));
  const known = device.store.deletionFacts.list(),
    state = device.store.exportSnapshot().data;
  const outbox = device.store.readOutbox(),
    cursor = meta(device, 'cursor'),
    epoch = meta(device, 'epoch');
  cloud.purgeNote();
  cloud.store.commitImport(cloud.store.exportSnapshot());
  watch = true;
  await device.engine.sync();
  assert.equal(device.engine.status().error.code, 'SYNC_LEGACY_OPERATION_UNRESOLVED');
  assert(!routes.some(url => /\/(operation-receipt|bootstrap|changes)[?]?/.test(url)));
  assert.deepEqual(meta(device, 'entityUpload'), old);
  assert.equal(meta(device, 'cursor'), cursor);
  assert.equal(meta(device, 'epoch'), epoch);
  assert.notEqual(meta(device, 'serverEpoch'), epoch);
  assert.deepEqual(device.store.exportSnapshot().data, state);
  assert.deepEqual(device.store.readOutbox(), outbox);
  assert.deepEqual(device.store.deletionFacts.list(), known);
  assert.equal(device.store.deletionFacts.has('notes', cloud.note.id), false);
});

test('C1 HTTP 知识 purge 的主体/证据/来源事实与存活冲突共存，继续编辑后可采用云端', async t => {
  const cloud = await fixture(t),
    synthetic = seedProvenance(cloud),
    device = cloud.device('knowledge-delete');
  await device.connect();
  clean(device);
  await device.engine.sync();
  clean(device);
  const before = device.store.exportSnapshot(),
    id = synthetic.artifactId;
  device.knowledge.knowledgeItemService.updateItem(id, { title: '删除前的本地后继编辑' });
  purgeKnowledge(cloud, id);
  await device.engine.sync();
  clean(device);
  assert(device.engine.status().entityConflict);
  for (const collection of ['knowledgeItems', 'knowledgeEvidence', 'knowledgeArtifactProvenance']) {
    const recordId = synthetic.state[collection][0].id;
    assertRemoteFact(device, cloud, collection, recordId);
    assert(
      device.store.state[collection].some(value => value.id === recordId),
      `${collection} 应保留冲突关联数据`
    );
  }
  device.knowledge.knowledgeItemService.updateItem(id, { title: '已知删除冲突仍可保存本地编辑' });
  assert.equal(device.knowledge.knowledgeItemService.getItem(id).title, '已知删除冲突仍可保存本地编辑');
  const known = device.store.deletionFacts.list();
  await device.restart();
  assert.deepEqual(device.store.deletionFacts.list(), known);
  await device.engine.resolve({ conflictId: device.engine.status().entityConflict.id, choice: 'remote' });
  clean(device);
  for (const collection of ['knowledgeItems', 'knowledgeEvidence', 'knowledgeArtifactProvenance'])
    assert.equal(device.store.state[collection].length, 0);
  assert.deepEqual(device.store.deletionFacts.list(), known);
  assert.throws(() => device.store.commitImport(before), { code: 'LOCAL_DELETION_FACT_CONFLICT' });
});

test('C1 真实来源墓碑引发无效合并时仍同事务记账，保留完整 live 来源和原游标', async t => {
  const cloud = await fixture(t),
    synthetic = seedProvenance(cloud),
    device = cloud.device('invalid-provenance-merge');
  await device.connect();
  clean(device);
  // 云端直接写入的日志头惰性追加；游标一致时跳过拉取，需再轮询一次才与云端收敛。
  await device.engine.sync();
  clean(device);
  const before = device.store.exportSnapshot().data,
    cursor = meta(device, 'cursor');
  purgeKnowledge(cloud, synthetic.artifactId);
  const page = await cloud.request(`changes?cursor=${encodeURIComponent(cursor)}&${syncContractQuery()}`);
  const entry = page.groups
    .flatMap(group => group.items)
    .find(value => value.collection === 'knowledgeArtifactProvenance');
  assert.equal(entry.value, null);
  // 投递已实际收到的明确事实，但只合并来源这一行：关系校验必须拒绝缺来源的 live 知识。
  assert.equal(applyEntityRemote(device.store, [entry], page.cursor, page.datasetEpoch), false);
  assert.deepEqual(device.store.exportSnapshot().data, before);
  assert.equal(meta(device, 'cursor'), cursor);
  assert(device.engine.status().entityConflict.reasons.some(reason => reason.collection === 'dependencies'));
  assertRemoteFact(device, cloud, entry.collection, entry.id);
  assert.equal(device.store.deletionFacts.list().length, 1);
  await device.restart();
  assert.deepEqual(device.store.exportSnapshot().data, before);
  assertRemoteFact(device, cloud, entry.collection, entry.id);
});

test('C1 相同版本 alias 及远端规范化不产生任何本地永久删除事实', async t => {
  const cloud = await fixture(t),
    device = cloud.device('alias');
  await device.connect();
  clean(device);
  device.knowledge.noteService.updateNote(cloud.note.id, { rawMarkdown: '双方相同的合成新版本' });
  const localVersion = device.store.state.noteVersions.find(version => version.content === '双方相同的合成新版本');
  const { item } = device.knowledge.knowledgeItemService.createCandidate({
    title: '合成版本证据',
    canonicalStatement: '相同内容',
    sourceMode: 'selection',
    evidence: [{ sourceType: 'noteVersion', noteVersionId: localVersion.id, quoteText: '双方相同的合成新版本' }]
  });
  cloud.knowledge.noteService.updateNote(cloud.note.id, { rawMarkdown: '双方相同的合成新版本' });
  const canonical = cloud.store.state.noteVersions.find(version => version.content === '双方相同的合成新版本');
  assert.notEqual(localVersion.id, canonical.id);
  await device.engine.sync();
  clean(device);
  assert.equal(device.knowledge.knowledgeItemService.listEvidence(item.id)[0].noteVersionId, canonical.id);
  assert.deepEqual(device.store.deletionFacts.list(), []);
  await device.restart();
  assert.deepEqual(device.store.deletionFacts.list(), []);
});
