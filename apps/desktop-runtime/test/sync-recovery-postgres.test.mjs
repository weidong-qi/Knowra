import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createPostgresTestDatabase } from '../../../scripts/test-support/postgres-test-database.mjs';

const ownerId = 'demo';
const confirm = { confirmRetire: true, acceptJournalUpgrade: true };
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const entityKey = (collection, id) => JSON.stringify([collection, id]);
const realPostgres = {
  skip: !process.env.KNOWRA_SYNC_TEST_DATABASE_URL
    ? '未设置 KNOWRA_SYNC_TEST_DATABASE_URL；不连接 PostgreSQL。'
    : process.env.KNOWRA_SYNC_TEST_ALLOW_WRITES !== '1'
      ? '未设置 KNOWRA_SYNC_TEST_ALLOW_WRITES=1；不连接 PostgreSQL。'
      : false,
  timeout: 120000
};

// 仅由显式测试环境启用。共用 helper 校验回环 Knowra 测试库、迁移随机 schema 并删除。
// 不修改设备白名单或准入配置；所有 SQLite、附件、备份和云端文件只使用新建临时目录。
async function fixture(t, { delayed = false } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'knowra-recovery-real-pg-'));
  const localRoot = path.join(root, 'synthetic-local');
  const previousVerify = process.env.KNOWRA_SYNC_VERIFY_SCOPED_AFTER;
  let database;
  let cloud;
  let server;
  let local;
  let engine;
  t.after(async () => {
    const failures = [];
    const cleanup = async operation => {
      try {
        await operation();
      } catch (error) {
        failures.push(error);
      }
    };
    await cleanup(() => engine?.close());
    await cleanup(() => local?.store.close());
    await cleanup(async () => {
      if (server?.listening)
        await new Promise((resolve, reject) => server.close(error => (error ? reject(error) : resolve())));
    });
    await cleanup(() => cloud?.close());
    await cleanup(() => database?.close());
    await cleanup(() => fs.rmSync(root, { recursive: true, force: true }));
    if (previousVerify === undefined) delete process.env.KNOWRA_SYNC_VERIFY_SCOPED_AFTER;
    else process.env.KNOWRA_SYNC_VERIFY_SCOPED_AFTER = previousVerify;
    if (failures.length) throw new AggregateError(failures, '真实 PG 客户端恢复测试清理失败');
  });
  database = await createPostgresTestDatabase();
  assert.match(database.schema, /^knowra_test_[a-f0-9]{32}$/);
  // 缺少任一测试环境变量时连生产模块和 Prisma 都不加载，也不启动 HTTP 服务。
  const { createPostgresAppContext } = await import('../../api/src/postgres-app.factory.ts');
  const { createServer } = await import('../../api/src/server.js');
  const { createAttachmentTransfer } = await import('../../api/src/modules/sync/attachment-transfer.ts');
  const { createSyncEngine } = await import('../src/sync-engine.mjs');
  const { createRuntimeBackup } = await import('../src/backup.mjs');
  const { readMeta } = await import('../src/sync-state.mjs');
  const { openWorkspace } = await import('./helpers.mjs');
  const { validateDeviceRetirements } = await import('../../api/src/modules/sync/device-retirement.ts');
  cloud = await createPostgresAppContext({
    databaseUrl: database.databaseUrl,
    ownerId,
    storageRootDir: path.join(root, 'synthetic-cloud'),
    uploadsDir: path.join(root, 'synthetic-cloud', 'uploads')
  });
  const space = await cloud.http.knowledge.createDefaultKnowledgeSpace();
  const note = await cloud.http.knowledge.createNote({
    spaceId: space.id,
    title: '真实 PG 客户端合成恢复',
    rawMarkdown: '合成基线正文'
  });
  server = createServer({ appContext: cloud, logger: { error() {} } });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`;
  local = openWorkspace(localRoot);
  const meta = key => local.store.readSync(db => readMeta(db, key));
  let armed = false;
  let original;
  const writes = [];
  const backups = [];
  const retirements = [];
  const fetcher = async (url, init) => {
    if (url.endsWith('/batch')) {
      const attempt = {
        url,
        init,
        operation: JSON.parse(init.body),
        pendingKeys: meta('recoveryPendingKeys') ?? []
      };
      writes.push(attempt);
      if (armed) {
        armed = false;
        original = attempt;
        if (!delayed) {
          const response = await fetch(url, init);
          attempt.httpStatus = response.status;
          attempt.result = await response.json();
        }
        // delayed=true 时没有发 HTTP 请求；稍后显式使用同一 URL/init 发送，不靠 sleep 竞争。
        throw Object.assign(new Error('合成原提交响应超时'), { name: 'TimeoutError' });
      }
      const response = await fetch(url, init);
      attempt.httpStatus = response.status;
      attempt.result = await response.clone().json();
      attempt.pendingBeforeDelivery = meta('recoveryPendingKeys') ?? [];
      return response;
    }
    if (url.endsWith('/device-retirement') && init?.method === 'POST') {
      // 真正的完整 SQLite 备份必须先于退役 HTTP 请求完成。
      assert.equal(backups.length, 1);
      retirements.push(JSON.parse(init.body));
    }
    return fetch(url, init);
  };
  engine = createSyncEngine(local.store, {
    autoSync: false,
    noteService: local.knowledge.noteService,
    entityTransfer: createAttachmentTransfer({
      uploadsDir: path.join(localRoot, 'uploads'),
      storageRootDir: localRoot
    }),
    fetcher,
    createRecoveryBackup: () => {
      const directory = createRuntimeBackup(local.store, localRoot, { purpose: 'sync-safety-recovery' });
      assert.equal(path.dirname(directory), path.join(localRoot, 'backups'));
      const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'manifest.json'), 'utf8'));
      assert.equal(manifest.purpose, 'sync-safety-recovery');
      assert(manifest.files.some(file => file.path === 'local.sqlite' && file.size > 0));
      assert(fs.statSync(path.join(directory, 'local.sqlite')).isFile());
      backups.push(directory);
      return directory;
    }
  });
  await engine.configure({ serverUrl: origin });
  assert.equal(engine.status().phase, 'synced', JSON.stringify(engine.status().error));
  const journal = async () => {
    const row = await cloud.prisma.syncJournal.findUnique({ where: { ownerId } });
    assert.ok(row, '必须回读真实 SyncJournal JSONB 行');
    const [version] = await cloud.prisma.$queryRawUnsafe(
      'SELECT xmin::text AS version FROM "SyncJournal" WHERE "ownerId" = $1',
      ownerId
    );
    return { payload: row.payload, xmin: version.version };
  };
  const pause = async edit => {
    armed = true;
    edit();
    await engine.sync();
    assert.ok(original, '必须拦截到真实引擎构造的 batch');
    assert.equal(engine.status().safetyPaused, true);
    assert.deepEqual(meta('entityUpload'), original.operation);
    if (!delayed) {
      assert.equal(original.httpStatus, 200);
      assert.equal(original.result.data.status, 'accepted', JSON.stringify(original.result));
    }
  };
  return {
    cloud,
    note,
    local,
    engine,
    meta,
    writes,
    backups,
    retirements,
    journal,
    pause,
    original: () => original,
    sendOriginal: () => fetch(original.url, original.init),
    persistedNote: () => cloud.prisma.note.findUnique({ where: { id: note.id } }),
    validateDeviceRetirements
  };
}

const baseRows = f =>
  f.local.store.readSync(db =>
    db
      .prepare('SELECT * FROM sync_base ORDER BY collection,id')
      .all()
      .map(row => ({ ...row }))
  );
const outboxRows = f =>
  f.local.store.readSync(db =>
    db
      .prepare('SELECT * FROM sync_outbox ORDER BY sequence')
      .all()
      .map(row => ({ ...row }))
  );
const historyRows = f =>
  f.local.store.readSync(db =>
    db
      .prepare('SELECT id,payload FROM sync_recovery ORDER BY id')
      .all()
      .map(row => ({ ...row }))
  );

async function prepareRecovery(f) {
  const before = {
    base: baseRows(f),
    outbox: outboxRows(f),
    upload: f.meta('entityUpload'),
    local: structuredClone(f.local.store.state),
    globalDeviceId: f.local.store.getStatus().deviceId
  };
  const status = await f.engine.recover(confirm);
  assert.equal(status.safetyPaused, true);
  assert.equal(status.recoverySession.stage, 'preview');
  assert.deepEqual(baseRows(f), before.base, '固定快照预览不能提前清理旧基线');
  assert.deepEqual(outboxRows(f), before.outbox, '固定快照预览不能提前清理 outbox');
  assert.deepEqual(f.meta('entityUpload'), before.upload);
  assert.deepEqual(f.local.store.state, before.local);
  assert.equal(f.local.store.getStatus().deviceId, before.globalDeviceId);
  assert.equal(status.deviceId, before.globalDeviceId);
  assert.equal(f.backups.length, 1);
  assert.equal(f.retirements.length, 1);
  const session = f.meta('recoverySession');
  const { payload } = await f.journal();
  assert.equal(payload.version, 2);
  f.validateDeviceRetirements(payload);
  assert.deepEqual(payload.retiredDevices[before.globalDeviceId], session.proof);
  const binding = {
    ownerId,
    datasetEpoch: f.original().operation.datasetEpoch,
    deviceId: before.globalDeviceId,
    successorDeviceId: session.newDeviceId,
    recoveryId: session.id,
    requests: [
      {
        operationId: before.upload.operationId,
        datasetEpoch: before.upload.datasetEpoch,
        requestHash: hash(before.upload)
      }
    ]
  };
  for (const [key, value] of Object.entries(binding)) assert.deepEqual(session.proof[key], value);
  assert.equal(session.proof.bindingHash, hash(binding));
  assert.equal(session.download.offset, null);
  const preview = f.engine.recoveryPreview({ limit: 100 });
  assert.equal(preview.recoveryId, session.id);
  assert.equal(preview.nextOffset, null);
  assert.equal(preview.total, preview.items.length);
  before.history = historyRows(f);
  assert(before.history.length > 0, '预览之前必须已有原证据封存');
  return { before, preview };
}

async function chooseLocal(f, preview) {
  return f.engine.recoverResolve({ recoveryId: preview.recoveryId, revision: preview.revision, choice: 'local' });
}

function assertRecovered(f, before, preview, status) {
  assert.equal(status.safetyPaused, false, JSON.stringify(status.error));
  assert.equal(status.phase, 'synced', JSON.stringify(status.error));
  assert.equal(f.local.store.getStatus().deviceId, before.globalDeviceId);
  assert.notEqual(status.deviceId, before.globalDeviceId);
  assert.equal(status.deviceId, preview.newDeviceId);
  assert.equal(f.backups.length, 2);
  assert.notEqual(f.backups[0], f.backups[1]);
  assert.equal(f.retirements.length, 1);
  assert.equal(f.meta('entityUpload'), null);
  assert.deepEqual(f.meta('recoveryPendingKeys'), []);
  const historyAfter = historyRows(f);
  for (const row of before.history)
    assert.deepEqual(
      historyAfter.find(current => current.id === row.id),
      row,
      '已有历史必须按原字符串保留'
    );
  const newWrites = f.writes.slice(f.writes.indexOf(f.original()) + 1);
  assert(newWrites.length > 0, '选择本机必须以新编号提交当前意图');
  assert(newWrites.every(attempt => attempt.operation.deviceId === preview.newDeviceId));
  assert(newWrites.every(attempt => attempt.operation.operationId !== before.upload.operationId));
  const history = f.engine
    .recovery()
    .find(record => record.kind === 'sync-safety-recovery' && record.choice === 'local');
  assert.ok(history, '必须完整封存原请求、旧基线、outbox 和当前后继编辑');
  assert.equal(history.history.readOnly, true);
  assert.deepEqual(history.local, before.local);
  assert.deepEqual(history.outbox, before.outbox);
  assert.deepEqual(JSON.parse(history.metadata.find(row => row.key === 'sync:entityUpload').value), before.upload);
  assert.deepEqual(
    [...history.base].sort((a, b) => entityKey(a.collection, a.id).localeCompare(entityKey(b.collection, b.id))),
    [...before.base].sort((a, b) => entityKey(a.collection, a.id).localeCompare(entityKey(b.collection, b.id)))
  );
  return { history, newWrites };
}

// 这是顺序明确的 HTTP/PG/SQLite 合成故障测试，不宣称覆盖物理断电或真实 PG 锁等待竞争。
test('真实 PostgreSQL：已提交 batch 的响应丢失，撤回经屏障恢复，旧回执不重放业务', realPostgres, async t => {
  const f = await fixture(t);
  assert.equal((await f.journal()).payload.version, 1);
  await f.pause(() => f.local.knowledge.noteService.updateNote(f.note.id, { favorite: true }));
  assert.equal((await f.persistedNote()).favorite, true);
  f.local.knowledge.noteService.updateNote(f.note.id, { favorite: false });
  const { before, preview } = await prepareRecovery(f);
  assert.equal(
    JSON.parse(before.base.find(row => row.collection === 'notes' && row.id === f.note.id).payload).favorite,
    false
  );
  const item = preview.items.find(item => item.collection === 'notes' && item.id === f.note.id);
  assert.equal(item.local.favorite, false);
  assert.equal(item.remote.favorite, true);
  const status = await chooseLocal(f, preview);
  const { newWrites } = assertRecovered(f, before, preview, status);
  assert.equal(f.local.knowledge.noteService.getNote(f.note.id).favorite, false);
  assert.equal((await f.persistedNote()).favorite, false);
  const replacement = newWrites.find(attempt => attempt.operation.changes.some(change => change.id === f.note.id));
  assert.equal(replacement.result.data.status, 'accepted');
  assert(replacement.pendingKeys.includes(entityKey('notes', f.note.id)));
  assert(replacement.pendingBeforeDelivery.includes(entityKey('notes', f.note.id)), '收到 accepted 前不能清除强制意图');
  const protectedRow = await f.journal();
  const protectedNote = await f.persistedNote();
  const replay = await f.sendOriginal();
  assert.equal(replay.status, 200);
  assert.deepEqual(await replay.json(), f.original().result);
  assert.deepEqual(await f.persistedNote(), protectedNote, '精确旧重试只返回回执，不能再次收藏');
  assert.deepEqual(await f.journal(), protectedRow, '回执重试不能重写 JSONB，即使内容相同也不允许');
});

test('真实 PostgreSQL：旧请求在屏障后才发送被拒，快照后的云端变更使本机撤回转普通冲突', realPostgres, async t => {
  const f = await fixture(t, { delayed: true });
  await f.pause(() => f.local.knowledge.noteService.updateNote(f.note.id, { favorite: true }));
  assert.equal(f.original().httpStatus, undefined, '原 HTTP 请求尚未执行');
  assert.equal((await f.persistedNote()).favorite, false);
  f.local.knowledge.noteService.updateNote(f.note.id, { favorite: false });
  const { before, preview } = await prepareRecovery(f);
  assert.equal(
    JSON.parse(before.base.find(row => row.collection === 'notes' && row.id === f.note.id).payload).favorite,
    false
  );
  const item = preview.items.find(item => item.collection === 'notes' && item.id === f.note.id);
  assert.equal(item.local.favorite, false);
  assert.equal(item.remote.favorite, false);
  const protectedRow = await f.journal();
  const protectedNote = await f.persistedNote();
  const late = await f.sendOriginal();
  assert.equal(late.status, 409);
  assert.equal((await late.json()).error.code, 'SYNC_DEVICE_RETIRED');
  assert.deepEqual(await f.journal(), protectedRow);
  assert.deepEqual(await f.persistedNote(), protectedNote);
  await f.cloud.http.knowledge.updateNote({ id: f.note.id }, { favorite: true });
  assert.equal((await f.persistedNote()).favorite, true);
  assert.deepEqual(f.engine.recoveryPreview({ limit: 100 }), preview, '固定快照不能被后续云端更新偷换');
  const conflicted = await chooseLocal(f, preview);
  assert.equal(conflicted.safetyPaused, false, JSON.stringify(conflicted.error));
  assert.equal(conflicted.phase, 'conflict');
  assert.ok(conflicted.entityConflict);
  assert.equal(f.local.knowledge.noteService.getNote(f.note.id).favorite, false);
  assert.equal((await f.persistedNote()).favorite, true, '未经普通冲突确认不能覆盖新云端值');
  assert(f.meta('recoveryPendingKeys').includes(entityKey('notes', f.note.id)), '等于旧基线的明确撤回仍须保持强制意图');
  await f.engine.resolve({ conflictId: conflicted.entityConflict.id, choice: 'local' });
  const { newWrites } = assertRecovered(f, before, preview, f.engine.status());
  const accepted = newWrites.filter(attempt => attempt.result.data?.status === 'accepted');
  assert(
    accepted.some(attempt =>
      attempt.operation.changes.some(change => change.id === f.note.id && change.value.favorite === false)
    )
  );
  for (const attempt of accepted) {
    if (!attempt.operation.changes.some(change => change.id === f.note.id)) continue;
    assert(attempt.pendingKeys.includes(entityKey('notes', f.note.id)));
    assert(attempt.pendingBeforeDelivery.includes(entityKey('notes', f.note.id)));
  }
  assert.equal(f.local.knowledge.noteService.getNote(f.note.id).favorite, false);
  assert.equal((await f.persistedNote()).favorite, false);
});

test('真实 PostgreSQL：回收后恢复并重新确认训练关联组，按当前快照同步且保留旧历史', realPostgres, async t => {
  const f = await fixture(t);
  const cloud = f.cloud.http.knowledge;
  const { item } = await cloud.createKnowledgeItem({
    title: '合成训练恢复',
    canonicalStatement: '解释安全恢复的关联',
    sourceMode: 'manual'
  });
  await cloud.confirmKnowledgeItem({ id: item.id });
  const objective = await cloud.createLearningObjective({
    knowledgeItemId: item.id,
    objective: '能够解释安全恢复的关联',
    actionVerb: 'explain',
    cognitiveLevel: 'understand'
  });
  await cloud.confirmLearningObjective({ id: objective.id });
  const profile = await cloud.createExamProfile({
    name: '合成人工考试',
    scope: ['恢复'],
    commonQuestionTypes: ['shortAnswer']
  });
  const focus = await cloud.createExamFocus({
    examProfileId: profile.id,
    learningObjectiveId: objective.id,
    description: '合成人工考点',
    sourceType: 'manual'
  });
  await cloud.confirmExamFocus({ id: focus.id });
  const question = await cloud.createQuestion({
    questionType: 'shortAnswer',
    stem: '解释安全恢复的关联？',
    referenceAnswer: '先屏障后明确恢复。',
    learningObjectiveIds: [objective.id],
    sources: [{ sourceType: 'learningObjective', sourceId: objective.id }]
  });
  await cloud.validateQuestion({ id: question.id });
  await cloud.confirmQuestion({ id: question.id });
  await f.engine.sync();
  assert.equal(f.engine.status().phase, 'synced', JSON.stringify(f.engine.status().error));
  const local = f.local.knowledge;
  await f.pause(() => local.knowledgeItemService.trash(item.id));
  assert.ok((await f.cloud.prisma.knowledgeItem.findUnique({ where: { id: item.id } })).deletedAt);
  local.knowledgeItemService.restoreDeleted(item.id);
  local.learningObjectiveService.confirmObjective(objective.id);
  // 知识回收不会归档考点；confirmed 再次 confirm 不登记审阅边界，须走正式重新审阅流程。
  assert.equal(local.examFocusService.get(focus.id).reviewStatus, 'confirmed');
  local.examFocusService.archive(focus.id);
  local.examFocusService.restore(focus.id);
  assert.equal(local.examFocusService.get(focus.id).reviewStatus, 'candidate');
  local.examFocusService.confirm(focus.id);
  assert.equal(local.examFocusService.get(focus.id).reviewStatus, 'confirmed');
  local.questionService.validateQuestion(question.id);
  local.questionService.confirmQuestion(question.id);
  const lifecycle = f.meta('knowledgeLifecycleQueue');
  const reviews = f.meta('examFocusReviewQueue');
  assert(lifecycle.length >= 2, '原回收及后继恢复都仍在本机证据中');
  assert(Array.isArray(reviews) && reviews.length > 0, 'candidate→confirmed 必须登记非空的后继人工审阅依赖记录');
  assert(reviews.some(review => review.focusId === focus.id && review.parents.length > 0));
  const { before, preview } = await prepareRecovery(f);
  const status = await chooseLocal(f, preview);
  const { history, newWrites } = assertRecovered(f, before, preview, status);
  assert.equal(f.local.store.state.knowledgeItems.find(row => row.id === item.id).deletedAt, null);
  assert.equal((await f.cloud.prisma.knowledgeItem.findUnique({ where: { id: item.id } })).deletedAt, null);
  for (const [collection, model, id] of [
    ['learningObjectives', 'learningObjective', objective.id],
    ['examFocuses', 'examFocus', focus.id],
    ['questions', 'question', question.id]
  ]) {
    assert.equal(f.local.store.state[collection].find(row => row.id === id).reviewStatus, 'confirmed');
    const persisted = await f.cloud.prisma[model].findUnique({ where: { id } });
    assert.equal(persisted.reviewStatus, 'confirmed');
    assert.equal(persisted.deletedAt, null);
  }
  for (const [collection, model, fields] of [
    ['questionObjectives', 'questionObjective', ['id', 'questionId', 'learningObjectiveId', 'isPrimary', 'order']],
    ['questionSources', 'questionSource', ['id', 'questionId', 'sourceType', 'sourceId', 'status']]
  ]) {
    const expected = before.local[collection]
      .filter(row => row.questionId === question.id)
      .map(row => Object.fromEntries(fields.map(field => [field, row[field]])))
      .sort((a, b) => a.id.localeCompare(b.id));
    assert(expected.length > 0, '合成训练必须包含关联和来源');
    const persisted = await f.cloud.prisma[model].findMany({
      where: { questionId: question.id },
      select: Object.fromEntries(fields.map(field => [field, true]))
    });
    assert.deepEqual(
      persisted.sort((a, b) => a.id.localeCompare(b.id)),
      expected
    );
  }
  assert(
    newWrites.every(
      attempt =>
        !attempt.operation.changes.some(
          change => change.collection === 'knowledgeItems' && change.id === item.id && change.value?.deletedAt
        )
    ),
    '新编号不能为重建历史审阅而重演旧回收'
  );
  for (const [key, value] of [
    ['knowledgeLifecycleQueue', lifecycle],
    ['examFocusReviewQueue', reviews]
  ]) {
    assert.deepEqual(JSON.parse(history.metadata.find(row => row.key === `sync:${key}`).value), value);
    assert.deepEqual(f.meta(key), [], '旧队列只能封存，不得继续驱动恢复后的操作');
  }
  const protectedRow = await f.journal();
  const replay = await f.sendOriginal();
  assert.equal(replay.status, 200);
  assert.deepEqual(await replay.json(), f.original().result);
  assert.equal((await f.cloud.prisma.knowledgeItem.findUnique({ where: { id: item.id } })).deletedAt, null);
  assert.equal((await f.cloud.prisma.question.findUnique({ where: { id: question.id } })).reviewStatus, 'confirmed');
  assert.deepEqual(await f.journal(), protectedRow);
});
