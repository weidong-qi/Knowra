import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { test } from 'node:test';
import { createAppContext } from '../../api/src/app.factory.js';
import { createServer } from '../../api/src/server.js';
import { createFileDataStore } from '../../api/src/infrastructure/file-data-store.js';
import { createAttachmentTransfer } from '../../api/src/modules/sync/attachment-transfer.ts';
import { createSyncEngine } from '../src/sync-engine.mjs';
import { createRuntimeBackup, inspectRuntimeBackup, listRuntimeBackups, readBackupDrafts } from '../src/backup.mjs';
import { prepareRestoredDirectory, activateRestoredDirectory } from '../src/restore-directory.mjs';
import { startLocalRuntime } from '../src/runtime-server.mjs';
import { createUnavailableAiRuntime } from '../../api/src/modules/ai/runtime.js';
import { scopeHash } from '../../api/src/modules/ai/record-contract.ts';
import { readMeta, nextUpload } from '../src/sync-state.mjs';
import { openWorkspace } from './helpers.mjs';

async function fixture(t, { delayed = false, loseRetirement = false, failBackup = false } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'knowra-recovery-test-'));
  const cloudStore = createFileDataStore(path.join(root, 'synthetic-cloud.json'));
  const context = createAppContext({
    dataStore: cloudStore,
    uploadsDir: path.join(root, 'cloud-uploads'),
    storageRootDir: root
  });
  const knowledge = context.modules.knowledge;
  const space = knowledge.knowledgeSpaceService.createDefaultKnowledgeSpace({ userId: 'demo' });
  const note = knowledge.noteService.createNote({ title: '合成安全恢复', rawMarkdown: '基线正文', spaceId: space.id });
  const server = createServer({ appContext: context, logger: { error() {} } });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`;
  const localRoot = path.join(root, 'synthetic-local');
  const opened = [];
  let armed = false;
  let original;
  let lateRequest;
  let retirementLost = loseRetirement;
  const writes = [];
  let retirements = 0;
  let backups = 0;
  let fail = failBackup;
  let commitFailure = false;
  let editOnBackup = null;
  let backupOverride = null;
  const fetcher = async (url, init) => {
    if (url.endsWith('/batch')) {
      const body = JSON.parse(init.body);
      writes.push(body);
      if (armed) {
        armed = false;
        original = body;
        if (delayed) lateRequest = () => fetch(url, init);
        else await fetch(url, init);
        throw new Error('合成原提交响应丢失');
      }
    }
    if (url.endsWith('/device-retirement') && init?.method === 'POST') {
      retirements++;
      const response = await fetch(url, init);
      if (retirementLost && response.ok) {
        retirementLost = false;
        throw new Error('合成屏障响应丢失');
      }
      return response;
    }
    return fetch(url, init);
  };
  const open = () => {
    const workspace = openWorkspace(localRoot, {
      beforeCommit: () => {
        if (commitFailure) throw new Error('合成最终提交失败');
      }
    });
    const transfer = createAttachmentTransfer({
      uploadsDir: path.join(localRoot, 'uploads'),
      storageRootDir: localRoot
    });
    const engine = createSyncEngine(workspace.store, {
      autoSync: false,
      noteService: workspace.knowledge.noteService,
      entityTransfer: transfer,
      fetcher,
      createRecoveryBackup: () => {
        backups++;
        if (fail) throw new Error('合成完整备份失败');
        if (editOnBackup) {
          const edit = editOnBackup;
          editOnBackup = null;
          edit(workspace);
        }
        if (backupOverride) return backupOverride(workspace);
        return createRuntimeBackup(workspace.store, localRoot, { purpose: 'sync-safety-recovery' });
      }
    });
    const value = {
      ...workspace,
      engine,
      closed: false,
      async close() {
        if (value.closed) return;
        await engine.close();
        workspace.store.close();
        value.closed = true;
      }
    };
    opened.push(value);
    return value;
  };
  const a = open();
  t.after(async () => {
    for (const item of opened) await item.close();
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(root, { recursive: true, force: true });
  });
  await a.engine.configure({ serverUrl: origin });
  const pause = async () => {
    armed = true;
    a.knowledge.noteService.updateNote(note.id, { favorite: true });
    await a.engine.sync();
    assert.equal(a.engine.status().safetyPaused, true);
  };
  const meta = (key, device = a) => device.store.readSync(db => readMeta(db, key));
  return {
    root,
    cloudStore,
    context,
    knowledge,
    note,
    a,
    origin,
    open,
    pause,
    meta,
    writes,
    original: () => original,
    late: () => lateRequest(),
    retirements: () => retirements,
    backups: () => backups,
    arm: () => {
      armed = true;
    },
    failCommit: value => {
      commitFailure = value;
    },
    onBackup: callback => {
      editOnBackup = callback;
    },
    overrideBackup: callback => {
      backupOverride = callback;
    },
    failBackup: value => {
      fail = value;
    }
  };
}
const confirm = { confirmRetire: true, acceptJournalUpgrade: true };

for (const delayed of [false, true]) {
  test(`${delayed ? '旧请求迟到' : '原请求已提交'}：屏障后保留撤回，专用事务换发送身份但不改全局身份`, async t => {
    const f = await fixture(t, { delayed });
    await f.pause();
    f.a.knowledge.noteService.updateNote(f.note.id, { favorite: false });
    const original = f.original();
    const localId = f.a.store.getStatus().deviceId;
    const outbox = f.a.store.readOutbox();
    const base = f.a.store.readSync(db => db.prepare('SELECT * FROM sync_base').all());
    const status = await f.a.engine.recover(confirm);
    assert.equal(status.safetyPaused, true);
    assert.equal(status.recoverySession.stage, 'preview');
    assert.equal(f.a.knowledge.noteService.getNote(f.note.id).favorite, false);
    assert.deepEqual(f.meta('entityUpload'), original);
    assert.deepEqual(f.a.store.readOutbox(), outbox);
    assert.deepEqual(
      f.a.store.readSync(db => db.prepare('SELECT * FROM sync_base').all()),
      base
    );
    assert.equal(f.retirements(), 1);
    assert.equal(f.backups(), 1);
    if (delayed) {
      const late = await f.late();
      assert.equal(late.status, 409);
      assert.equal((await late.json()).error.code, 'SYNC_DEVICE_RETIRED');
    }
    const preview = f.a.engine.recoveryPreview();
    assert(preview.items.some(item => item.id === f.note.id && item.local.favorite === false));
    const final = await f.a.engine.recoverResolve({
      recoveryId: preview.recoveryId,
      revision: preview.revision,
      choice: 'local'
    });
    assert.equal(final.safetyPaused, false);
    assert.equal(final.phase, 'synced', JSON.stringify(final.error));
    assert.equal(f.a.knowledge.noteService.getNote(f.note.id).favorite, false);
    assert.equal(f.knowledge.noteService.getNote(f.note.id).favorite, false);
    assert.equal(f.a.store.getStatus().deviceId, localId);
    assert.notEqual(final.deviceId, localId);
    assert.equal(final.deviceId, status.recoverySession.newDeviceId);
    assert.equal(f.backups(), 2);
    assert(
      f.a.engine
        .recovery()
        .some(
          item =>
            item.kind === 'sync-safety-recovery' &&
            item.local.notes.some(note => note.id === f.note.id && note.favorite === false)
        )
    );
    assert(f.writes.slice(1).every(operation => operation.deviceId === final.deviceId));
  });
}

test('采用云端前封存当前正文与后继outbox，主动选择不丢恢复依据', async t => {
  const f = await fixture(t);
  await f.pause();
  f.a.knowledge.noteService.updateNote(f.note.id, { rawMarkdown: '暂停后的重要合成后继正文' });
  await f.a.engine.recover(confirm);
  const preview = f.a.engine.recoveryPreview();
  const final = await f.a.engine.recoverResolve({
    recoveryId: preview.recoveryId,
    revision: preview.revision,
    choice: 'remote'
  });
  assert.equal(final.safetyPaused, false);
  assert.equal(f.a.knowledge.noteService.getNote(f.note.id).rawMarkdown, '基线正文');
  assert(
    f.a.engine
      .recovery()
      .some(
        item =>
          item.kind === 'sync-safety-recovery' &&
          item.local.notes.some(note => note.rawMarkdown === '暂停后的重要合成后继正文') &&
          item.outbox.length
      )
  );
});

test('屏障响应丢失后重启沿用同一新编号和恢复ID，只查询既有证明', async t => {
  const f = await fixture(t, { loseRetirement: true });
  await f.pause();
  await assert.rejects(f.a.engine.recover(confirm));
  const session = f.a.engine.status().recoverySession;
  assert.equal(session.stage, 'retiring');
  await f.a.close();
  const reopened = f.open();
  assert.equal(reopened.engine.status().recoverySession.id, session.id);
  await reopened.engine.retry();
  await assert.rejects(reopened.engine.resolve({ conflictId: 'other', choice: 'remote' }), {
    code: 'SYNC_RESULT_UNCERTAIN'
  });
  const restored = await reopened.engine.recover(confirm);
  assert.equal(restored.recoverySession.newDeviceId, session.newDeviceId);
  assert.equal(restored.recoverySession.id, session.id);
  assert.equal(restored.recoverySession.stage, 'preview');
  assert.equal(f.retirements(), 1);
  assert.equal(restored.safetyPaused, true);
});

test('预览后继续编辑拒绝旧决定，刷新对照后完整保留新编辑', async t => {
  const f = await fixture(t);
  await f.pause();
  await f.a.engine.recover(confirm);
  const old = f.a.engine.recoveryPreview();
  f.a.knowledge.noteService.updateNote(f.note.id, { rawMarkdown: '预览后新增的合成正文' });
  await assert.rejects(
    f.a.engine.recoverResolve({ recoveryId: old.recoveryId, revision: old.revision, choice: 'remote' }),
    { code: 'SYNC_RECOVERY_PREVIEW_CHANGED' }
  );
  assert.equal(f.a.knowledge.noteService.getNote(f.note.id).rawMarkdown, '预览后新增的合成正文');
  assert.equal(f.a.engine.status().safetyPaused, true);
  const fresh = f.a.engine.recoveryPreview();
  assert.notEqual(fresh.revision, old.revision);
  const final = await f.a.engine.recoverResolve({
    recoveryId: fresh.recoveryId,
    revision: fresh.revision,
    choice: 'local'
  });
  assert.equal(final.safetyPaused, false);
  assert.equal(f.knowledge.noteService.getNote(f.note.id).rawMarkdown, '预览后新增的合成正文');
});

test('未明确确认或完整备份失败时，旧编号不作废，原请求与后继编辑不清理', async t => {
  const f = await fixture(t, { failBackup: true });
  await f.pause();
  await assert.rejects(f.a.engine.recover({}), { code: 'SYNC_RECOVERY_CONFIRMATION_REQUIRED' });
  assert.equal(f.backups(), 0);
  await assert.rejects(f.a.engine.recover(confirm), /合成完整备份失败/);
  assert.equal(f.retirements(), 0);
  assert.equal(f.a.engine.status().recoverySession, null);
  assert.deepEqual(f.meta('entityUpload'), f.original());
});

test('最终保护备份失败不清暂停或原请求，修复后仍使用原恢复会话', async t => {
  const f = await fixture(t);
  await f.pause();
  await f.a.engine.recover(confirm);
  const preview = f.a.engine.recoveryPreview();
  f.failBackup(true);
  await assert.rejects(
    f.a.engine.recoverResolve({ recoveryId: preview.recoveryId, revision: preview.revision, choice: 'remote' }),
    /合成完整备份失败/
  );
  assert.equal(f.a.engine.status().safetyPaused, true);
  assert.deepEqual(f.meta('entityUpload'), f.original());
  f.failBackup(false);
  const final = await f.a.engine.recoverResolve({
    recoveryId: preview.recoveryId,
    revision: preview.revision,
    choice: 'remote'
  });
  assert.equal(final.safetyPaused, false);
  assert.equal(f.retirements(), 1);
});

test('已恢复本机遇到云端屏障丢失时先持久暂停，不拉取覆盖或继续发送', async t => {
  const f = await fixture(t);
  await f.pause();
  await f.a.engine.recover(confirm);
  const preview = f.a.engine.recoveryPreview();
  await f.a.engine.recoverResolve({ recoveryId: preview.recoveryId, revision: preview.revision, choice: 'local' });
  f.a.knowledge.noteService.updateNote(f.note.id, { rawMarkdown: '屏障丢失前的新合成编辑' });
  const before = f.writes.length;
  f.cloudStore.runSyncJournalTransaction(() => {
    const journal = f.cloudStore.getSyncJournal();
    journal.version = 1;
    delete journal.retiredDevices;
  });
  await f.a.engine.sync();
  assert.equal(f.a.engine.status().safetyPaused, true);
  assert.equal(f.writes.length, before);
  assert.equal(f.a.knowledge.noteService.getNote(f.note.id).rawMarkdown, '屏障丢失前的新合成编辑');
});

for (const delayed of [false, true]) {
  test(`${delayed ? '生命周期原请求尚未执行' : '生命周期原请求已执行'}：恢复当前快照不重演旧回收，保留后继恢复及候选降级`, async t => {
    const f = await fixture(t, { delayed });
    const { item } = f.knowledge.knowledgeItemService.createCandidate({
      title: '合成回收恢复',
      canonicalStatement: '合成正式知识',
      sourceMode: 'manual'
    });
    f.knowledge.knowledgeItemService.confirmItem(item.id);
    const objective = f.knowledge.learningObjectiveService.createCandidate({
      knowledgeItemId: item.id,
      objective: '能够解释合成知识',
      actionVerb: 'explain',
      cognitiveLevel: 'understand'
    });
    f.knowledge.learningObjectiveService.confirmObjective(objective.id);
    await f.a.engine.sync();
    f.arm();
    f.a.knowledge.knowledgeItemService.trash(item.id);
    await f.a.engine.sync();
    assert.equal(f.a.engine.status().safetyPaused, true);
    f.a.knowledge.knowledgeItemService.restoreDeleted(item.id);
    const beforeRecovery = f.writes.length;
    await f.a.engine.recover(confirm);
    const preview = f.a.engine.recoveryPreview({ limit: 100 });
    const final = await f.a.engine.recoverResolve({
      recoveryId: preview.recoveryId,
      revision: preview.revision,
      choice: 'local'
    });
    assert.equal(final.safetyPaused, false, JSON.stringify(final.error));
    assert.equal(final.phase, 'synced', JSON.stringify(final.error));
    assert.equal(f.a.store.state.knowledgeItems.find(value => value.id === item.id).deletedAt, null);
    assert.equal(f.cloudStore.state.knowledgeItems.find(value => value.id === item.id).deletedAt, null);
    assert.equal(f.a.store.state.learningObjectives.find(value => value.id === objective.id).reviewStatus, 'candidate');
    assert.equal(
      f.cloudStore.state.learningObjectives.find(value => value.id === objective.id).reviewStatus,
      'candidate'
    );
    assert(
      !f.writes
        .slice(beforeRecovery)
        .some(op =>
          op.changes.some(
            change => change.collection === 'knowledgeItems' && change.id === item.id && change.value?.deletedAt
          )
        ),
      '新身份不得重演历史回收'
    );
    assert(
      f.a.engine
        .recovery()
        .some(
          record =>
            record.kind === 'sync-safety-recovery' &&
            record.metadata.some(row => row.key === 'sync:knowledgeLifecycleQueue' && JSON.parse(row.value).length)
        )
    );
  });
}

for (const delayed of [false, true]) {
  test(`${delayed ? '训练原请求尚未执行' : '训练原请求已执行'}：保留后继重新确认的当前关联组，不重放历史回收前像`, async t => {
    const f = await fixture(t, { delayed });
    const k = f.knowledge;
    const { item } = k.knowledgeItemService.createCandidate({
      title: '合成训练恢复',
      canonicalStatement: '解释安全恢复的关联',
      sourceMode: 'manual'
    });
    k.knowledgeItemService.confirmItem(item.id);
    const objective = k.learningObjectiveService.createCandidate({
      knowledgeItemId: item.id,
      objective: '能够解释安全恢复的关联',
      actionVerb: 'explain',
      cognitiveLevel: 'understand'
    });
    k.learningObjectiveService.confirmObjective(objective.id);
    const profile = k.examProfileService.create({
      name: '合成人工考试',
      scope: ['恢复'],
      commonQuestionTypes: ['shortAnswer']
    });
    const focus = k.examFocusService.create({
      examProfileId: profile.id,
      learningObjectiveId: objective.id,
      description: '合成人工考点',
      sourceType: 'manual'
    });
    k.examFocusService.confirm(focus.id);
    const question = k.questionService.createQuestion({
      questionType: 'shortAnswer',
      stem: '解释安全恢复的关联？',
      referenceAnswer: '先屏障后明确恢复。',
      learningObjectiveIds: [objective.id],
      sources: [{ sourceType: 'learningObjective', sourceId: objective.id }]
    });
    k.questionService.validateQuestion(question.id);
    k.questionService.confirmQuestion(question.id);
    await f.a.engine.sync();
    const local = f.a.knowledge;
    f.arm();
    local.knowledgeItemService.trash(item.id);
    await f.a.engine.sync();
    assert.equal(f.a.engine.status().safetyPaused, true);
    local.knowledgeItemService.restoreDeleted(item.id);
    local.learningObjectiveService.confirmObjective(objective.id);
    local.examFocusService.archive(focus.id);
    local.examFocusService.restore(focus.id);
    assert.equal(local.examFocusService.get(focus.id).reviewStatus, 'candidate');
    local.examFocusService.confirm(focus.id);
    assert(f.meta('examFocusReviewQueue').length > 0, '正式 candidate→confirmed 必须生成后继私有审阅边界');
    local.questionService.validateQuestion(question.id);
    local.questionService.confirmQuestion(question.id);
    const beforeRecovery = f.writes.length;
    await f.a.engine.recover(confirm);
    const preview = f.a.engine.recoveryPreview({ limit: 100 });
    const final = await f.a.engine.recoverResolve({
      recoveryId: preview.recoveryId,
      revision: preview.revision,
      choice: 'local'
    });
    assert.equal(final.safetyPaused, false, JSON.stringify(final.error));
    assert.equal(final.phase, 'synced', JSON.stringify(final.error));
    for (const [collection, id] of [
      ['learningObjectives', objective.id],
      ['examFocuses', focus.id],
      ['questions', question.id]
    ]) {
      assert.equal(f.a.store.state[collection].find(row => row.id === id).reviewStatus, 'confirmed');
      assert.equal(f.cloudStore.state[collection].find(row => row.id === id).reviewStatus, 'confirmed');
    }
    assert(
      !f.writes
        .slice(beforeRecovery)
        .some(op =>
          op.changes.some(
            change => change.collection === 'knowledgeItems' && change.id === item.id && change.value?.deletedAt
          )
        ),
      '不能重演旧回收来重建历史审阅'
    );
  });
}

test('固定快照之后云端再变更，选择本机即使等于旧基线也必须保留意图并转冲突', async t => {
  const f = await fixture(t, { delayed: true });
  await f.pause();
  f.a.knowledge.noteService.updateNote(f.note.id, { favorite: false });
  await f.a.engine.recover(confirm);
  const preview = f.a.engine.recoveryPreview();
  f.knowledge.noteService.updateNote(f.note.id, { favorite: true });
  const final = await f.a.engine.recoverResolve({
    recoveryId: preview.recoveryId,
    revision: preview.revision,
    choice: 'local'
  });
  assert.equal(final.safetyPaused, false);
  assert.equal(f.a.knowledge.noteService.getNote(f.note.id).favorite, false);
  assert.equal(final.phase, 'conflict');
  assert(final.entityConflict);
  await f.a.engine.resolve({ conflictId: final.entityConflict.id, choice: 'local' });
  assert.equal(f.a.engine.status().phase, 'synced');
  assert.equal(f.knowledge.noteService.getNote(f.note.id).favorite, false);
});

test('恢复会话重新取得不同云端快照时，即使本机未改也拒绝旧预览决定', async t => {
  const f = await fixture(t, { delayed: true });
  await f.pause();
  f.a.knowledge.noteService.updateNote(f.note.id, { favorite: false });
  await f.a.engine.recover(confirm);
  const old = f.a.engine.recoveryPreview();
  f.knowledge.noteService.updateNote(f.note.id, { favorite: true });
  f.cloudStore.commitImport(f.cloudStore.exportSnapshot());
  await f.a.engine.recover(confirm);
  const fresh = f.a.engine.recoveryPreview();
  assert.notEqual(fresh.revision, old.revision);
  await assert.rejects(
    f.a.engine.recoverResolve({ recoveryId: old.recoveryId, revision: old.revision, choice: 'remote' }),
    { code: 'SYNC_RECOVERY_PREVIEW_CHANGED' }
  );
  assert.equal(f.a.knowledge.noteService.getNote(f.note.id).favorite, false);
  assert.equal(f.a.engine.status().safetyPaused, true);
});

for (const mode of ['missing', 'accepted', 'operation-reused']) {
  test(`legacy ${mode}：专用屏障恢复不重建或重放旧线报文，当前撤回仍保留`, async t => {
    const f = await fixture(t);
    f.a.knowledge.noteService.updateNote(f.note.id, { favorite: true });
    const old = nextUpload(f.a.store);
    const { syncContract } = await import('../../api/src/modules/sync/protocol-contract.ts');
    const wire = { ...old, ...syncContract() };
    if (mode === 'accepted') f.context.http.sync.push(wire);
    if (mode === 'operation-reused') f.context.http.sync.push({ ...wire, value: { ...wire.value, favorite: false } });
    f.a.knowledge.noteService.updateNote(f.note.id, { favorite: false });
    await f.a.engine.sync();
    assert.equal(f.a.engine.status().safetyPaused, true);
    await f.a.engine.recover(confirm);
    const preview = f.a.engine.recoveryPreview();
    const final = await f.a.engine.recoverResolve({
      recoveryId: preview.recoveryId,
      revision: preview.revision,
      choice: 'local'
    });
    assert.equal(final.phase, 'synced', JSON.stringify(final.error));
    assert.equal(f.knowledge.noteService.getNote(f.note.id).favorite, false);
    assert.equal(f.a.knowledge.noteService.getNote(f.note.id).favorite, false);
    assert(f.a.engine.recovery().some(record => record.kind === 'sync-safety-recovery' && record.legacyUploads.length));
    if (mode === 'missing') assert.throws(() => f.context.http.sync.push(wire), { code: 'SYNC_DEVICE_RETIRED' });
    if (mode === 'accepted') assert.equal(f.context.http.sync.push(wire).status, 'accepted');
    if (mode === 'operation-reused') assert.throws(() => f.context.http.sync.push(wire), { code: 'OPERATION_REUSED' });
    assert.equal(f.knowledge.noteService.getNote(f.note.id).favorite, false);
  });
}

test('最终SQLite提交失败整体回滚身份、基线和清理，原请求及暂停仍在', async t => {
  const f = await fixture(t);
  await f.pause();
  await f.a.engine.recover(confirm);
  const preview = f.a.engine.recoveryPreview();
  const oldId = f.a.engine.status().deviceId;
  f.failCommit(true);
  await assert.rejects(
    f.a.engine.recoverResolve({ recoveryId: preview.recoveryId, revision: preview.revision, choice: 'remote' }),
    /合成最终提交失败/
  );
  assert.equal(f.a.engine.status().safetyPaused, true);
  assert.equal(f.a.engine.status().deviceId, oldId);
  assert.deepEqual(f.meta('entityUpload'), f.original());
  f.failCommit(false);
  assert.equal(
    (await f.a.engine.recoverResolve({ recoveryId: preview.recoveryId, revision: preview.revision, choice: 'remote' }))
      .safetyPaused,
    false
  );
});

test('最终备份期间新编辑也使旧决定失效，不覆盖刚保存的后继正文', async t => {
  const f = await fixture(t);
  await f.pause();
  await f.a.engine.recover(confirm);
  const preview = f.a.engine.recoveryPreview();
  f.onBackup(workspace =>
    workspace.knowledge.noteService.updateNote(f.note.id, { rawMarkdown: '最终备份期间的新编辑' })
  );
  await assert.rejects(
    f.a.engine.recoverResolve({ recoveryId: preview.recoveryId, revision: preview.revision, choice: 'remote' }),
    { code: 'SYNC_RECOVERY_PREVIEW_CHANGED' }
  );
  assert.equal(f.a.knowledge.noteService.getNote(f.note.id).rawMarkdown, '最终备份期间的新编辑');
  assert.equal(f.a.engine.status().safetyPaused, true);
});

test('首次创建已提交但回执丢失，暂停后删除的缺席实体仍形成显式删除意图', async t => {
  const f = await fixture(t);
  const tag = f.a.knowledge.tagService.createTag({ spaceId: f.note.spaceId, name: '合成撤回的新标签' });
  f.arm();
  await f.a.engine.sync();
  assert.equal(
    f.cloudStore.state.tags.some(item => item.id === tag.id),
    true
  );
  f.a.knowledge.deleteTagAndCleanup(tag.id);
  await f.a.engine.recover(confirm);
  const preview = f.a.engine.recoveryPreview();
  const item = preview.items.find(entry => entry.collection === 'tags' && entry.id === tag.id);
  assert.equal(item.local, null);
  assert.equal(item.remote.id, tag.id);
  // 云端选择不得越过本机永久删除事实；仍可明确选择本机删除以收敛。
  await assert.rejects(
    f.a.engine.recoverResolve({ recoveryId: preview.recoveryId, revision: preview.revision, choice: 'remote' }),
    { code: 'LOCAL_DELETION_FACT_CONFLICT' }
  );
  assert.equal(f.a.engine.status().safetyPaused, true);
  const final = await f.a.engine.recoverResolve({
    recoveryId: preview.recoveryId,
    revision: preview.revision,
    choice: 'local'
  });
  assert.equal(final.phase, 'synced');
  assert.equal(
    f.a.store.state.tags.some(entry => entry.id === tag.id),
    false
  );
  assert.equal(
    f.cloudStore.state.tags.some(entry => entry.id === tag.id),
    false
  );
});

for (const choice of ['local', 'remote']) {
  test(`采用${choice}仍保留正式 AI 私有来源引用的本机历史版本别名`, async t => {
    const f = await fixture(t);
    const original = f.a.store.state.noteVersions.find(item => item.noteId === f.note.id);
    const alias = { ...original, id: 'synthetic-private-alias' };
    f.a.store.runTransaction(() => f.a.store.state.noteVersions.push(alias));
    const scope = {
      contractVersion: 1,
      kind: 'scopeSnapshot',
      scopeSnapshotId: 'synthetic-scope',
      ownerId: 'demo',
      ...f.a.store.aiRepository.identity(),
      spaceId: f.note.spaceId,
      scopeKind: 'note',
      allowedSources: [
        {
          sourceId: 'synthetic-source',
          noteId: f.note.id,
          noteVersionId: alias.id,
          contentHash: alias.contentHash,
          start: 0,
          end: alias.content.length,
          quoteHash: alias.contentHash,
          characters: alias.content.length,
          estimatedTokens: 2
        }
      ],
      allowedFolderIds: [],
      excludedSourceIds: [],
      createdAt: '2026-11-07T00:00:00.000Z'
    };
    scope.scopeHash = scopeHash(scope);
    f.a.store.aiRepository.insert('scopeSnapshot', scope);
    await f.a.engine.sync();
    assert(f.a.store.state.noteVersions.some(item => item.id === alias.id));
    await f.pause();
    await f.a.engine.recover(confirm);
    inspectRuntimeBackup(f.meta('recoverySession').backupDirectory);
    const preview = f.a.engine.recoveryPreview();
    const final = await f.a.engine.recoverResolve({
      recoveryId: preview.recoveryId,
      revision: preview.revision,
      choice
    });
    assert.equal(final.phase, 'synced');
    assert(f.a.store.state.noteVersions.some(item => item.id === alias.id));
    assert.equal(
      f.a.store.aiRepository.get('scopeSnapshot', 'synthetic-scope').allowedSources[0].noteVersionId,
      alias.id
    );
    assert(
      !f.writes.some(body => body.changes.some(entry => entry.collection === 'noteVersions' && entry.id === alias.id))
    );
  });
}

test('普通 ready 附件损坏时保留救援备份，但不得退役或创建恢复会话', async t => {
  const f = await fixture(t);
  const localRoot = path.join(f.root, 'synthetic-local');
  const context = createAppContext({
    dataStore: f.a.store,
    uploadsDir: path.join(localRoot, 'uploads'),
    storageRootDir: localRoot
  });
  const attachment = context.http.storage.uploadAttachment({
    noteId: f.note.id,
    fileName: 'synthetic.txt',
    mimeType: 'text/plain',
    contentBase64: Buffer.from('synthetic attachment bytes').toString('base64')
  });
  await f.a.engine.sync();
  await f.pause();
  fs.writeFileSync(path.join(localRoot, attachment.storagePath), 'synthetic corrupted bytes');
  await assert.rejects(f.a.engine.recover(confirm), { code: 'SYNC_RECOVERY_BACKUP_FAILED' });
  assert.equal(f.retirements(), 0);
  assert.equal(f.meta('recoverySession'), null);
  assert.deepEqual(f.meta('entityUpload'), f.original());
  assert.equal(fs.readdirSync(path.join(localRoot, 'backups')).length, 1);
});

for (const kind of ['other-dataset', 'stale-same-dataset', 'stale-final']) {
  test(`有效但不属于当前完整记录的备份被拒：${kind}`, async t => {
    const f = await fixture(t);
    await f.pause();
    const localRoot = path.join(f.root, 'synthetic-local');
    if (kind === 'stale-final') await f.a.engine.recover(confirm);
    let directory;
    if (kind === 'other-dataset') {
      const otherRoot = path.join(f.root, 'other-synthetic-local');
      const other = openWorkspace(otherRoot);
      directory = createRuntimeBackup(other.store, otherRoot, { purpose: 'sync-safety-recovery' });
      other.store.close();
    } else directory = createRuntimeBackup(f.a.store, localRoot, { purpose: 'sync-safety-recovery' });
    assert.equal(inspectRuntimeBackup(directory).valid, true);
    f.a.knowledge.noteService.updateNote(f.note.id, { rawMarkdown: '旧备份之后的后继正文' });
    f.overrideBackup(() => directory);
    if (kind === 'stale-final') {
      const preview = f.a.engine.recoveryPreview();
      await assert.rejects(
        f.a.engine.recoverResolve({ recoveryId: preview.recoveryId, revision: preview.revision, choice: 'remote' }),
        { code: 'SYNC_RECOVERY_BACKUP_FAILED' }
      );
    } else {
      await assert.rejects(f.a.engine.recover(confirm), { code: 'SYNC_RECOVERY_BACKUP_FAILED' });
      assert.equal(f.retirements(), 0);
    }
    assert.equal(f.a.knowledge.noteService.getNote(f.note.id).rawMarkdown, '旧备份之后的后继正文');
    assert.equal(f.a.engine.status().safetyPaused, true);
    assert.deepEqual(f.meta('entityUpload'), f.original());
  });
}

test('从备份形成另一 dataset 后不能复用旧恢复会话，也不重新退役', async t => {
  const f = await fixture(t);
  await f.pause();
  await f.a.engine.recover(confirm);
  f.a.store.metadataTransaction(db =>
    db.prepare("UPDATE metadata SET value='synthetic-restored-dataset' WHERE key='datasetId'").run()
  );
  await assert.rejects(f.a.engine.recover({}), { code: 'SYNC_RECOVERY_DIFFERENT_WORKSPACE' });
  const preview = f.a.engine.recoveryPreview();
  await assert.rejects(
    f.a.engine.recoverResolve({ recoveryId: preview.recoveryId, revision: preview.revision, choice: 'local' }),
    { code: 'SYNC_RECOVERY_DIFFERENT_WORKSPACE' }
  );
  assert.equal(f.retirements(), 1);
  assert.deepEqual(f.meta('entityUpload'), f.original());
});

test('已被其它副本使用的新发送编号不能激活', async t => {
  const f = await fixture(t);
  await f.pause();
  await f.a.engine.recover(confirm);
  const preview = f.a.engine.recoveryPreview();
  f.cloudStore.runSyncJournalTransaction(() => {
    f.cloudStore.getSyncJournal().deviceSequences[preview.newDeviceId] = 1;
  });
  await assert.rejects(
    f.a.engine.recoverResolve({ recoveryId: preview.recoveryId, revision: preview.revision, choice: 'local' }),
    { code: 'SYNC_RECOVERY_SUCCESSOR_USED' }
  );
  assert.equal(f.a.engine.status().safetyPaused, true);
  assert.deepEqual(f.meta('entityUpload'), f.original());
});

test('官方恢复目录中的真实 runtime 恢复备份可在根列表找到，并完整保存原生根草稿', async t => {
  const f = await fixture(t);
  await f.pause();
  const root = path.join(f.root, 'synthetic-local');
  const seed = createRuntimeBackup(f.a.store, root);
  await f.a.close();
  const active = prepareRestoredDirectory(root, seed);
  activateRestoredDirectory(root, active, { sourceBackupId: path.basename(seed) });
  const distRoot = path.join(f.root, 'synthetic-dist');
  fs.mkdirSync(distRoot);
  fs.writeFileSync(path.join(distRoot, 'index.html'), '<html><body>合成</body></html>');
  const runtime = await startLocalRuntime({
    dataDirectory: root,
    distRoot,
    syncOptions: { autoSync: false },
    aiRuntimeFactory: () => createUnavailableAiRuntime('synthetic-offline')
  });
  try {
    const drafts = {
      version: 1,
      drafts: {
        [`knowra:note-draft:v1:${JSON.stringify([runtime.store.getStatus().datasetId, f.note.id])}`]: {
          markdown: '官方恢复后根目录的重要草稿',
          baseMarkdown: '基线正文'
        }
      }
    };
    fs.writeFileSync(path.join(root, 'recovery-drafts.json'), JSON.stringify(drafts));
    const cookie = (await fetch(runtime.launchUrl, { redirect: 'manual' })).headers.get('set-cookie').split(';')[0];
    const response = await fetch(`${runtime.origin}/api/local-runtime/sync/recover`, {
      method: 'POST',
      headers: {
        Cookie: cookie,
        'Content-Type': 'application/json',
        'X-Knowra-Dataset': runtime.store.getStatus().datasetId
      },
      body: JSON.stringify(confirm)
    });
    const result = await response.json();
    assert.equal(response.status, 200, JSON.stringify(result));
    assert.equal(result.data.recoverySession.stage, 'preview');
    const session = runtime.store.readSync(db => readMeta(db, 'recoverySession'));
    assert.equal(path.dirname(session.backupDirectory), path.join(root, 'backups'));
    assert(listRuntimeBackups(root).some(item => item.id === result.data.recoverySession.backupId));
    assert.deepEqual(readBackupDrafts(session.backupDirectory), drafts);
  } finally {
    await runtime.close();
  }
});
