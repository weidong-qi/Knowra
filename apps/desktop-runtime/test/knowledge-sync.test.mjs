import assert from 'node:assert/strict';
import path from 'node:path';
import { once } from 'node:events';
import { test } from 'node:test';
import { createAttachmentTransfer } from '../../api/src/modules/sync/attachment-transfer.ts';
import { createFileDataStore } from '../../api/src/infrastructure/file-data-store.ts';
import { createAppContext } from '../../api/src/app.factory.ts';
import { createServer } from '../../api/src/server.js';
import { createSyncEngine } from '../src/sync-engine.mjs';
import { nextEntityUpload } from '../src/entity-sync-state.mjs';
import { readKnowledgeLifecycleBoundaries } from '../src/knowledge-lifecycle-boundaries.mjs';
import { readMeta, writeMeta } from '../src/sync-state.mjs';
import { requestHash } from '../../api/src/modules/sync/journal.ts';
import { temporaryDirectory, openWorkspace, markText, inlineId } from './helpers.mjs';

async function fixture(t) {
  const root = temporaryDirectory(t);
  const store = createFileDataStore(path.join(root, 'cloud.json'));
  const context = createAppContext({ dataStore: store, uploadsDir: path.join(root, 'uploads'), storageRootDir: root });
  const knowledge = context.modules.knowledge;
  const space = knowledge.knowledgeSpaceService.createDefaultKnowledgeSpace({ userId: 'demo' });
  const note = knowledge.noteService.createNote({
    title: '知识来源',
    rawMarkdown: '这是需要学习的知识。',
    spaceId: space.id
  });
  const server = createServer({ appContext: context, logger: { error() {} } });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`;
  function device(name, fetcher = fetch) {
    const directory = path.join(root, name);
    const target = {};
    const open = () => {
      Object.assign(target, openWorkspace(directory));
      target.engine = createSyncEngine(target.store, {
        autoSync: false,
        fetcher,
        noteService: target.knowledge.noteService,
        entityTransfer: createAttachmentTransfer({
          uploadsDir: path.join(directory, 'uploads'),
          storageRootDir: directory
        })
      });
    };
    open();
    target.connect = () => target.engine.configure({ serverUrl: origin });
    target.restart = async () => {
      await target.engine.close();
      target.store.close();
      open();
    };
    t.after(async () => {
      await target.engine.close();
      target.store.close();
    });
    return target;
  }
  return { store, context, knowledge, note, space, device };
}
// 重点写在正文标记里：给正文前 7 个字加标记并保存，返回服务端派生的重点行。
function annotation(knowledge, note) {
  const current = knowledge.noteService.getNote(note.id);
  const markId = `source-${note.id.slice(-6)}`;
  knowledge.noteService.updateNote(note.id, {
    rawMarkdown: `${markText(current.rawMarkdown.slice(0, 7), markId)}${current.rawMarkdown.slice(7)}`
  });
  return knowledge.contentAnnotationService.getAnnotation(inlineId(note.id, markId));
}
function candidate(knowledge, source) {
  return knowledge.knowledgeItemService.createCandidate({
    title: '离线知识',
    canonicalStatement: '经过人工确认的知识陈述',
    sourceMode: 'annotation',
    evidence: [{ sourceType: 'annotation', annotationId: source.id, expectedAnnotationRevision: source.revision }]
  });
}
const clean = device => {
  const status = device.engine.status();
  assert.equal(status.error, null, JSON.stringify(status));
  assert.equal(status.entityConflict, null, JSON.stringify(status));
  assert.equal(status.pendingEntities, 0, JSON.stringify(status));
  assert.equal(
    device.store.readSync(db => readKnowledgeLifecycleBoundaries(db).length),
    0
  );
};
const meta = (device, key) => device.store.readSync(db => readMeta(db, key));

test('缺少知识生命周期能力的旧云端在拉取前停止，冻结边界及后继修改完整保留', async t => {
  const cloud = await fixture(t);
  let oldServer = false,
    dataRequests = 0;
  const { item } = cloud.knowledge.knowledgeItemService.createCandidate({
    title: '协商边界',
    canonicalStatement: '合成正文',
    sourceMode: 'manual'
  });
  const a = cloud.device('old-lifecycle-server', async (url, init) => {
    if (oldServer && !url.endsWith('/status')) dataRequests++;
    const response = await fetch(url, init);
    if (oldServer && url.endsWith('/status')) {
      const body = await response.json();
      body.data.capabilities = body.data.capabilities.filter(value => value !== 'knowledge-lifecycle-v1');
      return Response.json(body, { status: response.status });
    }
    return response;
  });
  await a.connect();
  a.knowledge.knowledgeItemService.trash(item.id);
  const frozen = nextEntityUpload(a.store);
  a.knowledge.knowledgeItemService.restoreDeleted(item.id);
  const state = a.store.exportSnapshot().data,
    outbox = a.store.readOutbox(),
    queue = meta(a, 'knowledgeLifecycleQueue'),
    binding = meta(a, 'knowledgeLifecycleUpload'),
    cursor = meta(a, 'cursor');
  oldServer = true;
  await a.engine.sync();
  assert.equal(a.engine.status().error.code, 'SYNC_CLIENT_UPGRADE_REQUIRED');
  assert.equal(dataRequests, 0);
  assert.deepEqual(meta(a, 'entityUpload'), frozen);
  assert.deepEqual(meta(a, 'knowledgeLifecycleUpload'), binding);
  assert.deepEqual(meta(a, 'knowledgeLifecycleQueue'), queue);
  assert.deepEqual(a.store.readOutbox(), outbox);
  assert.deepEqual(a.store.exportSnapshot().data, state);
  assert.equal(meta(a, 'cursor'), cursor);
  await a.restart();
  assert.deepEqual(meta(a, 'entityUpload'), frozen);
  oldServer = false;
  await a.engine.sync();
  clean(a);
  assert.equal(cloud.knowledge.knowledgeItemService.getItem(item.id).deletedAt, null);
});

for (const receiptState of ['accepted', 'missing', 'unknown'])
  test(`新增强制能力后旧冻结知识边界回执${receiptState}均不自动解释，原hash、私有绑定与队列保留`, async t => {
    const cloud = await fixture(t),
      sent = [];
    const { item } = cloud.knowledge.knowledgeItemService.createCandidate({
      title: '旧合同回执',
      canonicalStatement: '合成正文',
      sourceMode: 'manual'
    });
    const a = cloud.device(`legacy-boundary-${receiptState}`, (url, init) => {
      if (url.endsWith('/batch')) sent.push(JSON.parse(init.body));
      return fetch(url, init);
    });
    await a.connect();
    a.knowledge.knowledgeItemService.trash(item.id);
    const current = nextEntityUpload(a.store),
      old = structuredClone(current);
    old.capabilities = old.capabilities.filter(value => value !== 'knowledge-lifecycle-v1');
    a.store.metadataTransaction(db => writeMeta(db, 'entityUpload', old));
    a.knowledge.knowledgeItemService.restoreDeleted(item.id);
    if (receiptState === 'accepted') {
      const accepted = await cloud.context.http.sync.pushBatch(current);
      cloud.store.runSyncTransaction(() => {
        cloud.store.getSyncJournal().receipts[JSON.stringify([old.deviceId, old.operationId])] = {
          hash: requestHash(old),
          result: accepted
        };
      });
    } else if (receiptState === 'unknown') {
      cloud.store.runSyncTransaction(() => {
        (cloud.store.getSyncJournal().deviceSequences ??= {})[old.deviceId] = old.sequence;
      });
    }
    const state = a.store.exportSnapshot().data,
      outbox = a.store.readOutbox(),
      queue = meta(a, 'knowledgeLifecycleQueue'),
      binding = meta(a, 'knowledgeLifecycleUpload'),
      cursor = meta(a, 'cursor');
    await a.restart();
    await a.engine.sync();
    assert.equal(a.engine.status().error.code, 'SYNC_RESULT_UNCERTAIN');
    assert.equal(sent.length, 0);
    assert.deepEqual(meta(a, 'entityUpload'), old);
    assert.deepEqual(meta(a, 'knowledgeLifecycleUpload'), binding);
    assert.deepEqual(meta(a, 'knowledgeLifecycleQueue'), queue);
    assert.deepEqual(a.store.readOutbox(), outbox);
    assert.deepEqual(a.store.exportSnapshot().data, state);
    assert.equal(meta(a, 'cursor'), cursor);
    if (receiptState === 'accepted')
      assert.equal(
        cloud.store.getSyncJournal().receipts[JSON.stringify([old.deviceId, old.operationId])].hash,
        requestHash(old)
      );
    await a.restart();
    await a.engine.sync();
    assert.equal(a.engine.status().error.code, 'SYNC_RESULT_UNCERTAIN');
    assert.deepEqual(meta(a, 'entityUpload'), old);
  });

// 全部通过真实 HTTP 云端及 SQLite 设备；不会触及用户资料。
test('离线新笔记、标注、知识和来源跨重启持久化，并在两设备原子收敛', async t => {
  const cloud = await fixture(t);
  let offline = false;
  const a = cloud.device('a', (...args) => (offline ? Promise.reject(new Error('模拟离线')) : fetch(...args)));
  const b = cloud.device('b');
  await a.connect();
  await b.connect();
  offline = true;
  const note = a.knowledge.noteService.createNote({
    title: '完全离线来源',
    rawMarkdown: '完全离线的新笔记与知识。',
    spaceId: cloud.space.id
  });
  const source = annotation(a.knowledge, note);
  const { item, evidence } = candidate(a.knowledge, source);
  a.knowledge.knowledgeItemService.confirmItem(item.id);
  await a.engine.sync();
  assert(a.engine.status().error);
  await a.restart();
  assert.equal(a.knowledge.knowledgeItemService.getItem(item.id).reviewStatus, 'confirmed');
  assert.equal(a.knowledge.knowledgeItemService.listEvidence(item.id)[0].id, evidence[0].id);
  offline = false;
  await a.engine.sync();
  clean(a);
  await b.engine.sync();
  clean(b);
  assert.equal(b.knowledge.knowledgeItemService.getItem(item.id).reviewStatus, 'confirmed');
  assert.equal(b.knowledge.knowledgeItemService.listEvidence(item.id)[0].noteId, note.id);
  const transaction = cloud.store
    .getSyncJournal()
    .changes.find(group => group.items.some(entry => entry.id === item.id));
  for (const id of [note.id, source.id, evidence[0].id]) assert(transaction.items.some(entry => entry.id === id));
  assert.equal(a.store.getStatus().pendingOperations, 0);
});

test('两设备编辑、重新确认、归档和恢复知识保留身份与来源', async t => {
  const cloud = await fixture(t);
  const a = cloud.device('a');
  const b = cloud.device('b');
  await a.connect();
  await b.connect();
  const { item } = a.knowledge.knowledgeItemService.createCandidate({
    title: '手动知识',
    canonicalStatement: '初稿',
    sourceMode: 'manual'
  });
  a.knowledge.knowledgeItemService.confirmItem(item.id);
  await a.engine.sync();
  clean(a);
  await b.engine.sync();
  clean(b);
  b.knowledge.knowledgeItemService.updateItem(item.id, { canonicalStatement: '修订陈述' });
  assert.equal(b.knowledge.knowledgeItemService.getItem(item.id).reviewStatus, 'needsRevision');
  await b.engine.sync();
  clean(b);
  await a.engine.sync();
  clean(a);
  assert.equal(a.knowledge.knowledgeItemService.getItem(item.id).canonicalStatement, '修订陈述');
  a.knowledge.knowledgeItemService.confirmItem(item.id);
  a.knowledge.knowledgeItemService.archive(item.id);
  await a.engine.sync();
  clean(a);
  await b.engine.sync();
  clean(b);
  assert.equal(b.knowledge.knowledgeItemService.getItem(item.id).reviewStatus, 'archived');
  b.knowledge.knowledgeItemService.restore(item.id);
  await b.engine.sync();
  clean(b);
  await a.engine.sync();
  clean(a);
  assert.equal(a.knowledge.knowledgeItemService.getItem(item.id).reviewStatus, 'candidate');
  assert.equal(cloud.store.state.knowledgeItems.length, 1);
});

test('阶段1 知识回收站与来源撤回在两个 SQLite 设备及云端收敛', async t => {
  const cloud = await fixture(t);
  const a = cloud.device('stage1-a');
  const b = cloud.device('stage1-b');
  await a.connect();
  await b.connect();
  const { item, evidence } = a.knowledge.knowledgeItemService.createCandidate({
    title: '待撤回来源',
    canonicalStatement: '人工核对陈述',
    sourceMode: 'annotation',
    evidence: [{ sourceType: 'manual', quoteText: '历史摘录' }]
  });
  a.knowledge.knowledgeItemService.confirmItem(item.id);
  await a.engine.sync();
  clean(a);
  await b.engine.sync();
  clean(b);
  const withdrawn = a.knowledge.knowledgeItemService.retireEvidence(item.id, evidence[0].id);
  assert.equal(withdrawn.evidence.status, 'valid');
  assert.equal(withdrawn.evidence.applicabilityStatus, 'withdrawn');
  a.knowledge.knowledgeItemService.trash(item.id);
  await a.engine.sync();
  clean(a);
  await b.engine.sync();
  clean(b);
  assert.equal(
    b.knowledge.knowledgeItemService.listItems().some(row => row.id === item.id),
    false
  );
  assert.equal(
    b.knowledge.knowledgeItemService.listItems({ includeDeleted: true }).find(row => row.id === item.id).deletedAt !==
      null,
    true
  );
  assert.equal(b.store.state.knowledgeEvidence.find(row => row.id === evidence[0].id).applicabilityStatus, 'withdrawn');
  b.knowledge.knowledgeItemService.restoreDeleted(item.id);
  await b.engine.sync();
  clean(b);
  await a.engine.sync();
  clean(a);
  assert.equal(a.knowledge.knowledgeItemService.getItem(item.id).reviewStatus, 'needsRevision');
  assert.equal(cloud.store.state.knowledgeItems.find(row => row.id === item.id).deletedAt, null);
});

test('知识创建丢响应后重启仍暂停，后继编辑保留且证据不重复', async t => {
  const cloud = await fixture(t);
  let lose = true;
  const operationIds = [];
  const a = cloud.device('a', async (url, options) => {
    const response = await fetch(url, options);
    if (url.endsWith('/batch')) {
      operationIds.push(JSON.parse(options.body).operationId);
      if (lose) {
        lose = false;
        throw new Error('模拟提交成功但响应丢失');
      }
    }
    return response;
  });
  const source = annotation(cloud.knowledge, cloud.note);
  await a.connect();
  const { item } = candidate(a.knowledge, source);
  await a.engine.sync();
  assert(a.engine.status().error);
  await a.restart();
  a.knowledge.knowledgeItemService.updateItem(item.id, { canonicalStatement: '响应丢失后的编辑' });
  await a.engine.sync();
  assert.equal(a.engine.status().error.code, 'SYNC_RESULT_UNCERTAIN');
  assert.equal(operationIds.length, 1);
  assert.equal(cloud.store.state.knowledgeItems.length, 1);
  assert.equal(cloud.store.state.knowledgeEvidence.length, 1);
  assert.equal(a.knowledge.knowledgeItemService.getItem(item.id).canonicalStatement, '响应丢失后的编辑');
  assert.notEqual(cloud.knowledge.knowledgeItemService.getItem(item.id).canonicalStatement, '响应丢失后的编辑');
});

test('并发知识修改进入冲突，采用本地保留远端恢复记录并同步另一端', async t => {
  const cloud = await fixture(t);
  const { item } = cloud.knowledge.knowledgeItemService.createCandidate({
    title: '并发',
    canonicalStatement: '基线',
    sourceMode: 'manual'
  });
  const a = cloud.device('a');
  const b = cloud.device('b');
  await a.connect();
  await b.connect();
  a.knowledge.knowledgeItemService.updateItem(item.id, { canonicalStatement: 'A 编辑' });
  b.knowledge.knowledgeItemService.updateItem(item.id, { canonicalStatement: 'B 编辑' });
  await b.engine.sync();
  clean(b);
  await a.engine.sync();
  const conflict = a.engine.status().entityConflict;
  assert(conflict);
  assert.equal(a.knowledge.knowledgeItemService.getItem(item.id).canonicalStatement, 'A 编辑');
  await a.engine.resolve({ conflictId: conflict.id, choice: 'local' });
  clean(a);
  assert(
    a.engine
      .recovery()
      .some(record => record.remote?.some(entry => entry.id === item.id && entry.value.canonicalStatement === 'B 编辑'))
  );
  await b.engine.sync();
  clean(b);
  assert.equal(b.knowledge.knowledgeItemService.getItem(item.id).canonicalStatement, 'A 编辑');
});

test('云端知识已移入回收站时采用本地旧编辑不得隐式恢复', async t => {
  const cloud = await fixture(t);
  const { item } = cloud.knowledge.knowledgeItemService.createCandidate({
    title: '删除冲突',
    canonicalStatement: '共同基线',
    sourceMode: 'manual'
  });
  const a = cloud.device('delete-conflict');
  await a.connect();
  clean(a);
  a.knowledge.knowledgeItemService.updateItem(item.id, { canonicalStatement: '需要保全的离线编辑' });
  const deleted = cloud.knowledge.knowledgeItemService.trash(item.id);
  await a.engine.sync();
  const conflict = a.engine.status().entityConflict;
  assert(conflict);
  const before = a.store.exportSnapshot().data;
  await assert.rejects(
    a.engine.resolve({ conflictId: conflict.id, choice: 'local' }),
    error => error.code === 'SYNC_RESTORE_REQUIRED'
  );
  assert.deepEqual(a.store.exportSnapshot().data, before);
  assert.equal(a.engine.status().entityConflict.id, conflict.id);
  assert.equal(cloud.store.state.knowledgeItems.find(row => row.id === item.id).deletedAt, deleted.deletedAt);
  await a.restart();
  assert.equal(a.engine.status().entityConflict.id, conflict.id);
  await a.engine.resolve({ conflictId: conflict.id, choice: 'remote' });
  clean(a);
  assert.equal(a.store.state.knowledgeItems.find(row => row.id === item.id).deletedAt, deleted.deletedAt);
  assert(
    a.engine
      .recovery()
      .some(record =>
        record.local?.knowledgeItems.some(row => row.id === item.id && row.canonicalStatement === '需要保全的离线编辑')
      )
  );
  const restored = a.knowledge.knowledgeItemService.restoreDeleted(item.id);
  assert.equal(restored.deletedAt, null);
  await a.engine.sync();
  clean(a);
  assert.equal(cloud.store.state.knowledgeItems.find(row => row.id === item.id).deletedAt, null);
});

test('离线知识删除再恢复即使父项净零也保留目标和题目的审核失效', async t => {
  const cloud = await fixture(t);
  const { item } = cloud.knowledge.knowledgeItemService.createCandidate({
    title: '净零生命周期',
    canonicalStatement: '知识内容',
    sourceMode: 'manual'
  });
  cloud.knowledge.knowledgeItemService.confirmItem(item.id);
  const objective = cloud.knowledge.learningObjectiveService.createCandidate({
    knowledgeItemId: item.id,
    objective: '能够解释知识内容',
    actionVerb: 'explain',
    cognitiveLevel: 'understand'
  });
  cloud.knowledge.learningObjectiveService.confirmObjective(objective.id);
  const question = cloud.knowledge.questionService.createQuestion({
    questionType: 'shortAnswer',
    stem: '请解释知识内容',
    referenceAnswer: '知识内容',
    learningObjectiveIds: [objective.id],
    sources: [{ sourceType: 'knowledgeItem', sourceId: item.id, quote: '知识内容' }]
  });
  cloud.knowledge.questionService.validateQuestion(question.id);
  cloud.knowledge.questionService.confirmQuestion(question.id);
  const a = cloud.device('net-zero-a');
  const b = cloud.device('net-zero-b');
  await a.connect();
  await b.connect();
  const deleted = a.knowledge.knowledgeItemService.trash(item.id);
  a.knowledge.knowledgeItemService.restoreDeleted(item.id, { expectedUpdatedAt: deleted.updatedAt });
  assert.equal(a.store.state.learningObjectives.find(row => row.id === objective.id).reviewStatus, 'candidate');
  assert.equal(a.store.state.questions.find(row => row.id === question.id).reviewStatus, 'candidate');
  await a.restart();
  await a.engine.sync();
  clean(a);
  await b.engine.sync();
  clean(b);
  for (const store of [a.store, b.store, cloud.store]) {
    assert.equal(store.state.knowledgeItems.find(row => row.id === item.id).deletedAt, null);
    assert.equal(store.state.learningObjectives.find(row => row.id === objective.id).reviewStatus, 'candidate');
    assert.equal(store.state.questions.find(row => row.id === question.id).reviewStatus, 'candidate');
  }
});

test('离线恢复知识后解除归档并确认可合并上传，不能形成永久校验错误', async t => {
  const cloud = await fixture(t);
  const { item } = cloud.knowledge.knowledgeItemService.createCandidate({
    title: '恢复后连续审核',
    canonicalStatement: '有效手动声明',
    sourceMode: 'manual'
  });
  cloud.knowledge.knowledgeItemService.archive(item.id);
  cloud.knowledge.knowledgeItemService.trash(item.id);
  const a = cloud.device('restore-confirm-a');
  const b = cloud.device('restore-confirm-b');
  await a.connect();
  await b.connect();
  const restored = a.knowledge.knowledgeItemService.restoreDeleted(item.id);
  assert.equal(restored.reviewStatus, 'archived');
  const candidateItem = a.knowledge.knowledgeItemService.restore(item.id, { expectedUpdatedAt: restored.updatedAt });
  a.knowledge.knowledgeItemService.confirmItem(item.id, { expectedUpdatedAt: candidateItem.updatedAt });
  await a.restart();
  await a.engine.sync();
  clean(a);
  await b.engine.sync();
  clean(b);
  for (const store of [a.store, b.store, cloud.store]) {
    assert.equal(store.state.knowledgeItems.find(row => row.id === item.id).reviewStatus, 'confirmed');
    assert.equal(store.state.knowledgeItems.find(row => row.id === item.id).deletedAt, null);
  }
});

test('无下游的离线知识多次删除恢复按边界同步，净零动作也不被吞掉', async t => {
  const cloud = await fixture(t);
  const sent = [];
  const { item } = cloud.knowledge.knowledgeItemService.createCandidate({
    title: '多次生命周期',
    canonicalStatement: '保持正文',
    sourceMode: 'manual'
  });
  const a = cloud.device('multi-boundary', async (url, options) => {
    if (url.endsWith('/batch')) sent.push(JSON.parse(options.body));
    return fetch(url, options);
  });
  const b = cloud.device('multi-boundary-reader');
  await a.connect();
  await b.connect();
  let service = a.knowledge.knowledgeItemService;
  service.trash(item.id);
  service.restoreDeleted(item.id);
  await a.restart();
  await a.engine.sync();
  clean(a);
  await b.engine.sync();
  clean(b);
  assert.deepEqual(
    sent.flatMap(op => op.changes.filter(row => row.id === item.id).map(row => row.lifecycleAction)),
    ['trash', 'restore']
  );
  assert(sent.every(op => !Object.keys(op).some(key => key.includes('Lifecycle'))));
  sent.length = 0;
  service = a.knowledge.knowledgeItemService;
  service.trash(item.id);
  service.restoreDeleted(item.id);
  service.trash(item.id);
  service.restoreDeleted(item.id);
  const deleted = service.trash(item.id);
  await a.restart();
  await a.engine.sync();
  clean(a);
  await b.engine.sync();
  clean(b);
  assert.deepEqual(
    sent.flatMap(op => op.changes.filter(row => row.id === item.id).map(row => row.lifecycleAction)),
    ['trash', 'restore', 'trash', 'restore', 'trash']
  );
  for (const store of [a.store, b.store, cloud.store])
    assert.equal(store.state.knowledgeItems.find(row => row.id === item.id).deletedAt, deleted.deletedAt);
  await a.restart();
  clean(a);
});

test('知识删除边界丢响应后重启仍暂停，保留原操作、后继恢复与编辑', async t => {
  const cloud = await fixture(t);
  let lose = false;
  const sent = [];
  const { item } = cloud.knowledge.knowledgeItemService.createCandidate({
    title: '边界幂等',
    canonicalStatement: '原正文',
    sourceMode: 'manual'
  });
  const a = cloud.device('lost-boundary', async (url, options) => {
    const response = await fetch(url, options);
    if (url.endsWith('/batch')) {
      sent.push(JSON.parse(options.body));
      if (lose) {
        lose = false;
        throw new Error('删除已接受但响应丢失');
      }
    }
    return response;
  });
  await a.connect();
  lose = true;
  a.knowledge.knowledgeItemService.trash(item.id);
  await a.engine.sync();
  assert(a.engine.status().error);
  assert(cloud.store.state.knowledgeItems.find(row => row.id === item.id).deletedAt);
  a.knowledge.knowledgeItemService.restoreDeleted(item.id);
  a.knowledge.knowledgeItemService.updateItem(item.id, { canonicalStatement: '响应丢失之后的后继编辑' });
  await a.restart();
  await a.engine.sync();
  assert.equal(a.engine.status().error.code, 'SYNC_RESULT_UNCERTAIN');
  assert.equal(sent.length, 1);
  assert.equal(sent[0].changes.find(row => row.id === item.id).lifecycleAction, 'trash');
  assert.deepEqual(meta(a, 'entityUpload'), sent[0]);
  assert.equal(
    a.store.state.knowledgeItems.find(row => row.id === item.id).canonicalStatement,
    '响应丢失之后的后继编辑'
  );
  assert.equal(a.store.state.knowledgeItems.find(row => row.id === item.id).deletedAt, null);
  assert(cloud.store.state.knowledgeItems.find(row => row.id === item.id).deletedAt);
  const queue = meta(a, 'knowledgeLifecycleQueue');
  assert(queue.length > 0);
  await a.restart();
  assert.equal(a.engine.status().error.code, 'SYNC_RESULT_UNCERTAIN');
  assert.deepEqual(meta(a, 'knowledgeLifecycleQueue'), queue);
});

test('已收到与最早知识边界相同的权威基线可消费它并继续后继恢复', async t => {
  const cloud = await fixture(t);
  const sent = [];
  const { item } = cloud.knowledge.knowledgeItemService.createCandidate({
    title: '已观察边界',
    canonicalStatement: '共同正文',
    sourceMode: 'manual'
  });
  const a = cloud.device('observed-boundary', async (url, options) => {
    if (url.endsWith('/batch')) sent.push(JSON.parse(options.body));
    return fetch(url, options);
  });
  await a.connect();
  const deleted = a.knowledge.knowledgeItemService.trash(item.id);
  a.knowledge.knowledgeItemService.restoreDeleted(item.id);
  // 模拟另一权威入口已经提交同一删除状态，真实 HTTP pull 仍负责观察修订。
  cloud.store.runTransaction(() => cloud.knowledge.repositories.knowledgeItemRepository.save(deleted));
  await a.engine.sync();
  clean(a);
  assert.deepEqual(
    sent.flatMap(op => op.changes.filter(row => row.id === item.id).map(row => row.lifecycleAction)),
    ['restore']
  );
  assert.equal(cloud.store.state.knowledgeItems.find(row => row.id === item.id).deletedAt, null);
  await a.restart();
  clean(a);
});

test('知识撤回后删除恢复、重新采用并确认的净零终态同步后仍可重启', async t => {
  const cloud = await fixture(t);
  const { item, evidence } = cloud.knowledge.knowledgeItemService.createCandidate({
    title: '连续来源操作',
    canonicalStatement: '有效声明',
    sourceMode: 'annotation',
    evidence: [{ sourceType: 'manual', quoteText: '保留历史摘录' }]
  });
  cloud.knowledge.knowledgeItemService.confirmItem(item.id);
  const a = cloud.device('source-cycle');
  await a.connect();
  a.knowledge.knowledgeItemService.retireEvidence(item.id, evidence[0].id);
  a.knowledge.knowledgeItemService.trash(item.id);
  await a.restart();
  a.knowledge.knowledgeItemService.restoreDeleted(item.id);
  a.knowledge.knowledgeItemService.readoptEvidence(item.id, evidence[0].id);
  a.knowledge.knowledgeItemService.confirmItem(item.id);
  await a.engine.sync();
  clean(a);
  await a.restart();
  clean(a);
  assert.equal(a.store.state.knowledgeItems.find(row => row.id === item.id).reviewStatus, 'confirmed');
  assert.equal(a.store.state.knowledgeEvidence.find(row => row.id === evidence[0].id).applicabilityStatus, 'active');
});

test('共同基线已在回收站时显式恢复可处理新的云端编辑冲突', async t => {
  const cloud = await fixture(t);
  const { item } = cloud.knowledge.knowledgeItemService.createCandidate({
    title: '合法显式恢复',
    canonicalStatement: '共同正文',
    sourceMode: 'manual'
  });
  cloud.knowledge.knowledgeItemService.trash(item.id);
  const a = cloud.device('explicit-restore');
  await a.connect();
  a.knowledge.knowledgeItemService.restoreDeleted(item.id);
  cloud.knowledge.knowledgeItemService.restoreDeleted(item.id);
  cloud.knowledge.knowledgeItemService.updateItem(item.id, { canonicalStatement: '云端中间修改' });
  cloud.knowledge.knowledgeItemService.trash(item.id);
  await a.engine.sync();
  const conflict = a.engine.status().entityConflict;
  assert(conflict);
  await a.engine.resolve({ conflictId: conflict.id, choice: 'local' });
  clean(a);
  assert.equal(cloud.store.state.knowledgeItems.find(row => row.id === item.id).deletedAt, null);
  assert.equal(cloud.store.state.knowledgeItems.find(row => row.id === item.id).canonicalStatement, '共同正文');
});

test('来源笔记删除后历史摘录保留，跨端停止把来源当成有效依据', async t => {
  const cloud = await fixture(t);
  const source = annotation(cloud.knowledge, cloud.note);
  const { item } = candidate(cloud.knowledge, source);
  const a = cloud.device('a');
  const b = cloud.device('b');
  await a.connect();
  await b.connect();
  a.knowledge.knowledgeItemService.confirmItem(item.id);
  b.knowledge.noteService.deleteNote(cloud.note.id);
  await b.engine.sync();
  clean(b);
  await a.engine.sync();
  clean(a);
  await b.engine.sync();
  clean(b);
  for (const knowledge of [a.knowledge, b.knowledge, cloud.knowledge]) {
    assert.equal(knowledge.knowledgeItemService.getItem(item.id).reviewStatus, 'needsRevision');
    assert.equal(knowledge.knowledgeItemService.listEvidence(item.id)[0].status, 'invalid');
  }
});

test('离线候选遇到原文变更仍保留历史证据，来源失效后两端收敛', async t => {
  const cloud = await fixture(t);
  const source = annotation(cloud.knowledge, cloud.note);
  const a = cloud.device('a');
  const b = cloud.device('b');
  await a.connect();
  await b.connect();
  const { item, evidence } = candidate(a.knowledge, source);
  b.knowledge.noteService.updateNote(cloud.note.id, { rawMarkdown: '' });
  await b.engine.sync();
  clean(b);
  await a.engine.sync();
  clean(a);
  await b.engine.sync();
  clean(b);
  assert.equal(b.knowledge.knowledgeItemService.getItem(item.id).reviewStatus, 'candidate');
  assert.equal(b.knowledge.knowledgeItemService.listEvidence(item.id)[0].quoteText, evidence[0].quoteText);
  assert.equal(b.knowledge.knowledgeItemService.listEvidence(item.id)[0].status, 'insufficient');
});

test('schema7整段拒绝旧云端并保留知识、笔记与冻结队列；升级后全部补传', async t => {
  const cloud = await fixture(t);
  let old = false;
  const a = cloud.device('a', async (url, options) => {
    const response = await fetch(url, options);
    if (old && url.endsWith('/status')) {
      const body = await response.json();
      body.data.entitySchemaVersion = 6;
      body.data.capabilities = body.data.capabilities.filter(value => value !== 'knowledge-provenance-v1');
      return Response.json(body);
    }
    return response;
  });
  await a.connect();
  const { item } = a.knowledge.knowledgeItemService.createCandidate({
    title: '待同步知识',
    canonicalStatement: '保留本机',
    sourceMode: 'manual'
  });
  a.knowledge.noteService.updateNote(cloud.note.id, { rawMarkdown: '升级期间保留的离线正文' });
  const frozen = nextEntityUpload(a.store),
    before = a.store.exportSnapshot();
  old = true;
  await a.engine.sync();
  assert.equal(a.engine.status().error.code, 'SYNC_CLIENT_UPGRADE_REQUIRED');
  assert.deepEqual(nextEntityUpload(a.store), frozen);
  assert.deepEqual(a.store.exportSnapshot().data, before.data);
  assert.equal(cloud.knowledge.noteService.getNote(cloud.note.id).rawMarkdown, cloud.note.rawMarkdown);
  assert.equal(a.knowledge.knowledgeItemService.getItem(item.id).title, '待同步知识');
  assert.equal(cloud.store.state.knowledgeItems.length, 0);
  old = false;
  await a.engine.sync();
  clean(a);
  assert.equal(cloud.store.state.knowledgeItems.length, 1);
  assert.equal(cloud.knowledge.noteService.getNote(cloud.note.id).rawMarkdown, '升级期间保留的离线正文');
});

test('同步拒绝伪造有效状态和改写证据快照，业务与回执均不落盘', async t => {
  const cloud = await fixture(t);
  const source = annotation(cloud.knowledge, cloud.note);
  const { item } = candidate(cloud.knowledge, source);
  const a = cloud.device('a');
  await a.connect();
  a.knowledge.noteService.deleteNote(cloud.note.id);
  a.knowledge.knowledgeItemService.updateItem(item.id, { title: '本地修改' });
  const op = nextEntityUpload(a.store);
  op.changes.find(entry => entry.id === item.id).value.reviewStatus = 'confirmed';
  const before = JSON.stringify(cloud.store.exportSnapshot().data);
  await assert.rejects(cloud.context.http.sync.pushBatch(op), error => error.code === 'KNOWLEDGE_ITEM_SOURCE_REQUIRED');
  assert.equal(JSON.stringify(cloud.store.exportSnapshot().data), before);
  const evidence = cloud.store.state.knowledgeEvidence[0];
  const altered = {
    ...op,
    operationId: 'forge-evidence',
    changes: [
      {
        collection: 'knowledgeEvidence',
        id: evidence.id,
        baseRevision: cloud.store.getSyncJournal().revisions[JSON.stringify(['knowledgeEvidence', evidence.id])],
        value: { ...evidence, quoteText: '伪造来源' }
      }
    ]
  };
  altered.dependencies = ['knowledgeItems', 'notes', 'noteVersions', 'contentAnnotations'].map(collection => {
    const field = {
      knowledgeItems: 'knowledgeItemId',
      notes: 'noteId',
      noteVersions: 'noteVersionId',
      contentAnnotations: 'annotationId'
    }[collection];
    const id = evidence[field];
    return { collection, id, baseRevision: cloud.store.getSyncJournal().revisions[JSON.stringify([collection, id])] };
  });
  await assert.rejects(cloud.context.http.sync.pushBatch(altered), error => error.code === 'SYNC_IMMUTABLE');
  assert.equal(JSON.stringify(cloud.store.exportSnapshot().data), before);
});

test('来源被永久删除时保留待传知识与完整恢复副本，不能静默丢弃或还原失效来源', async t => {
  const cloud = await fixture(t);
  const source = annotation(cloud.knowledge, cloud.note);
  const a = cloud.device('a');
  await a.connect();
  const { item } = candidate(a.knowledge, source);
  cloud.knowledge.noteService.deleteNote(cloud.note.id);
  cloud.context.http.knowledge.permanentlyDeleteNote({ id: cloud.note.id });
  await a.engine.sync();
  const conflict = a.engine.status().entityConflict;
  assert(conflict);
  assert.equal(a.knowledge.knowledgeItemService.getItem(item.id).title, '离线知识');
  await assert.rejects(a.engine.resolve({ conflictId: conflict.id, choice: 'copy' }), /包含知识或来源/);
  await assert.rejects(
    a.engine.resolve({ conflictId: conflict.id, choice: 'manual', rawMarkdown: '正文' }),
    /包含知识或来源/
  );
  await a.engine.resolve({ conflictId: conflict.id, choice: 'remote' });
  clean(a);
  assert(a.engine.recovery().some(record => record.local?.knowledgeItems.some(entry => entry.id === item.id)));
  assert.equal(a.store.state.notes.length, 0);
});

test('两端保存相同正文后版本去重同时规范化知识证据和 sourceId', async t => {
  const cloud = await fixture(t);
  const a = cloud.device('a');
  const b = cloud.device('b');
  await a.connect();
  await b.connect();
  a.knowledge.noteService.updateNote(cloud.note.id, { rawMarkdown: '双端相同新正文' });
  const localVersion = a.store.state.noteVersions.find(version => version.content === '双端相同新正文');
  const { item } = a.knowledge.knowledgeItemService.createCandidate({
    title: '版本别名证据',
    canonicalStatement: '相同内容',
    sourceMode: 'selection',
    evidence: [{ sourceType: 'noteVersion', noteVersionId: localVersion.id, quoteText: '双端相同新正文' }]
  });
  cloud.knowledge.noteService.updateNote(cloud.note.id, { rawMarkdown: '双端相同新正文' });
  const canonical = cloud.store.state.noteVersions.find(version => version.content === '双端相同新正文');
  assert.notEqual(canonical.id, localVersion.id);
  await a.engine.sync();
  clean(a);
  await a.restart();
  await a.engine.sync();
  clean(a);
  await b.engine.sync();
  clean(b);
  for (const knowledge of [a.knowledge, b.knowledge, cloud.knowledge]) {
    const evidence = knowledge.knowledgeItemService.listEvidence(item.id)[0];
    assert.equal(evidence.noteVersionId, canonical.id);
    assert.equal(evidence.sourceId, canonical.id);
  }
});
