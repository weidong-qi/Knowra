import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { test } from 'node:test';
import { createFileDataStore } from '../src/infrastructure/file-data-store.js';
import { writeJsonFileAtomically } from '../src/infrastructure/atomic-json-file.ts';
import { createAppContext } from '../src/app.factory.js';
import { createServer } from '../src/server.js';
import { syncContract, syncContractQuery } from '../src/modules/sync/protocol-contract.ts';
import { createSyncService } from '../src/modules/sync/service.ts';
import { createBatchSyncService } from '../src/modules/sync/batch-service.ts';
import {
  loadJournal,
  noteContent,
  requestHash,
  resetJournalKeepingTombstones,
  syncKey
} from '../src/modules/sync/journal.ts';
import { WRITABLE_COLLECTIONS } from '../src/modules/sync/entity-contract.ts';
import { assertSyncDeviceNotRetired } from '../src/modules/sync/device-retirement.ts';

function fixture(t, options) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'knowra-retirement-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, 'synthetic-cloud.json');
  const store = createFileDataStore(file, options);
  const context = createAppContext({ dataStore: store, uploadsDir: path.join(root, 'uploads'), storageRootDir: root });
  const knowledge = context.modules.knowledge;
  const space = knowledge.knowledgeSpaceService.createDefaultKnowledgeSpace({ userId: 'demo' });
  const note = knowledge.noteService.createNote({ title: '合成屏障样本', rawMarkdown: '合成基线', spaceId: space.id });
  const service = context.http.sync;
  const batch = (deviceId = 'old-device', sequence = 1, operationId = 'original-operation') => ({
    ...syncContract(),
    protocolVersion: 2,
    deviceId,
    sequence,
    operationId,
    datasetEpoch: store.getSyncJournal().epoch,
    changes: [
      {
        collection: 'notes',
        id: note.id,
        baseRevision: store.getSyncJournal().revisions[syncKey('notes', note.id)],
        value: { ...knowledge.noteService.getNote(note.id), favorite: true }
      }
    ],
    dependencies: WRITABLE_COLLECTIONS.flatMap(collection =>
      store.state[collection]
        .filter(value => collection !== 'notes' || value.id !== note.id)
        .map(value => ({
          collection,
          id: value.id,
          baseRevision: store.getSyncJournal().revisions[syncKey(collection, value.id)] ?? null
        }))
    )
  });
  const legacy = (deviceId = 'old-device', operationId = 'original-legacy') => ({
    ...syncContract(),
    protocolVersion: 1,
    deviceId,
    operationId,
    datasetEpoch: store.getSyncJournal().epoch,
    noteId: note.id,
    baseRevision: store.getSyncJournal().revisions[syncKey('notes', note.id)],
    value: { ...noteContent(knowledge.noteService.getNote(note.id)), favorite: true }
  });
  const command = (operation = batch()) => ({
    ...syncContract(),
    action: 'retire-device',
    acceptJournalUpgrade: true,
    ownerId: 'demo',
    datasetEpoch: store.getSyncJournal().epoch,
    deviceId: operation.deviceId,
    successorDeviceId: 'new-device',
    recoveryId: 'explicit-recovery',
    requests: [
      { operationId: operation.operationId, datasetEpoch: operation.datasetEpoch, requestHash: requestHash(operation) }
    ]
  });
  return { root, file, store, context, knowledge, note, service, batch, legacy, command };
}

function withEnvironment(t, key, value) {
  const previous = process.env[key];
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
  t.after(() => {
    if (previous === undefined) delete process.env[key];
    else process.env[key] = previous;
  });
}

test('预检、状态与回执读取不自动作废编号或升级同步日志', t => {
  const f = fixture(t);
  const before = fs.readFileSync(f.file);
  const operation = f.batch();
  assert.equal(f.service.status().recovery.journalVersion, 1);
  assert.equal(f.service.device({ deviceId: operation.deviceId }).retired, false);
  assert.equal(
    f.service.deviceRetirement({ ...syncContract(), deviceId: operation.deviceId, recoveryId: 'not-started' }).status,
    'missing'
  );
  const receipt = f.service.operationReceipt({
    ...syncContract(),
    deviceId: operation.deviceId,
    operationId: operation.operationId,
    datasetEpoch: operation.datasetEpoch,
    requestHash: requestHash(operation)
  });
  assert.equal(receipt.status, 'missing');
  assert.equal(receipt.ownerId, 'demo');
  assert.equal(receipt.requestHash, requestHash(operation));
  assert.deepEqual(fs.readFileSync(f.file), before);
  assert.equal(f.store.getSyncJournal().version, 1);
});

test('无显式动作、错误owner/epoch/身份或不完整原请求不能触发升级', t => {
  const f = fixture(t);
  const command = f.command();
  assert.throws(() => f.service.retireDevice({ ...command, acceptJournalUpgrade: undefined }), {
    code: 'SYNC_RECOVERY_FORMAT_ACCEPTANCE_REQUIRED'
  });
  for (const changed of [
    { action: undefined },
    { ownerId: 'another-owner' },
    { deviceId: command.successorDeviceId },
    { requests: [] },
    { requests: [{ ...command.requests[0], requestHash: 'invalid' }] },
    { deviceId: '__proto__' },
    { requests: [command.requests[0], command.requests[0]] }
  ])
    assert.throws(() => f.service.retireDevice({ ...command, ...changed }), { code: 'SYNC_RECOVERY_INVALID' });
  assert.throws(() => f.service.retireDevice({ ...command, datasetEpoch: 'not-current-epoch' }), {
    code: 'DATASET_CHANGED'
  });
  assert.equal(f.store.getSyncJournal().version, 1);
  assert.equal(f.store.getSyncJournal().retiredDevices, undefined);
});

test('显式退役与格式门禁原子落库，主体和修订不变，重启仍拒绝旧编号', async t => {
  const f = fixture(t);
  const operation = f.batch();
  const beforeState = structuredClone(f.store.state);
  const beforeJournal = structuredClone(f.store.getSyncJournal());
  const result = f.service.retireDevice(f.command(operation));
  assert.equal(result.status, 'retired');
  assert.equal(result.journalVersion, 2);
  assert.deepEqual(structuredClone(f.store.state), beforeState);
  assert.equal(f.store.getSyncJournal().head, beforeJournal.head);
  assert.deepEqual(f.store.getSyncJournal().revisions, beforeJournal.revisions);
  assert.deepEqual(f.store.getSyncJournal().receipts, beforeJournal.receipts);
  const reopened = createFileDataStore(f.file);
  assert.equal(reopened.getSyncJournal().version, 2);
  assert.throws(() => assertSyncDeviceNotRetired(reopened.getSyncJournal(), operation.deviceId), {
    code: 'SYNC_DEVICE_RETIRED'
  });
  await assert.rejects(f.service.pushBatch(operation), { code: 'SYNC_DEVICE_RETIRED' });
  await assert.rejects(f.service.pushBatch({ ...operation, operationId: 'later-old', sequence: 999 }), {
    code: 'SYNC_DEVICE_RETIRED'
  });
  assert.throws(() => f.service.push(f.legacy()), { code: 'SYNC_DEVICE_RETIRED' });
});

test('响应丢失后同恢复ID可查可重试，不能改原请求、新身份或复用其他恢复ID', t => {
  const f = fixture(t);
  const command = f.command();
  const first = f.service.retireDevice(command);
  const queried = f.service.deviceRetirement({
    ...syncContract(),
    deviceId: command.deviceId,
    recoveryId: command.recoveryId
  });
  assert.deepEqual(queried.retirement, first.retirement);
  assert.deepEqual(f.service.retireDevice(command).retirement, first.retirement);
  for (const changed of [
    { successorDeviceId: 'replacement-new' },
    { recoveryId: 'replacement-recovery' },
    { requests: [{ ...command.requests[0], requestHash: 'f'.repeat(64) }] }
  ])
    assert.throws(() => f.service.retireDevice({ ...command, ...changed }), { code: 'SYNC_RECOVERY_MISMATCH' });
  assert.throws(
    () => f.service.deviceRetirement({ ...syncContract(), deviceId: command.deviceId, recoveryId: 'wrong-recovery' }),
    { code: 'SYNC_RECOVERY_MISMATCH' }
  );
  assert.throws(
    () => f.service.retireDevice({ ...command, deviceId: 'another-old', successorDeviceId: 'another-new' }),
    { code: 'SYNC_RECOVERY_MISMATCH' }
  );
  assert.throws(() => f.service.retireDevice({ ...command, deviceId: 'another-old', recoveryId: 'another-recovery' }), {
    code: 'SYNC_RECOVERY_MISMATCH'
  });
});

test('新身份未列入白名单时拒绝恢复，旧编号不被提前作废，白名单不修改', async t => {
  withEnvironment(t, 'KNOWRA_SYNC_ALLOWED_DEVICE_IDS', 'old-device');
  const f = fixture(t);
  const operation = f.batch();
  assert.throws(() => f.service.retireDevice(f.command(operation)), { code: 'SYNC_DEVICE_NOT_ENABLED' });
  assert.equal(f.store.getSyncJournal().version, 1);
  assert.equal(f.service.device({ deviceId: 'old-device' }).retired, false);
  assert.equal(process.env.KNOWRA_SYNC_ALLOWED_DEVICE_IDS, 'old-device');
  assert.equal((await f.service.pushBatch(operation)).status, 'accepted');
});

test('现有准入允许时新身份才可提交；恢复不授予第三方身份权限', async t => {
  withEnvironment(t, 'KNOWRA_SYNC_ALLOWED_DEVICE_IDS', 'old-device,new-device');
  const f = fixture(t);
  f.service.retireDevice(f.command());
  assert.equal((await f.service.pushBatch(f.batch('new-device', 1, 'new-operation'))).status, 'accepted');
  await assert.rejects(f.service.pushBatch(f.batch('unapproved-device', 1, 'unapproved')), {
    code: 'SYNC_DEVICE_NOT_ENABLED'
  });
  assert.equal(process.env.KNOWRA_SYNC_ALLOWED_DEVICE_IDS, 'old-device,new-device');
});

test('新身份已有操作记录时拒绝绑定，不合并另一设备的序号或资料', async t => {
  const f = fixture(t);
  assert.equal((await f.service.pushBatch(f.batch('new-device', 1, 'already-used'))).status, 'accepted');
  assert.throws(() => f.service.retireDevice(f.command()), { code: 'SYNC_RECOVERY_MISMATCH' });
  assert.equal(f.store.getSyncJournal().version, 1);
});

test('原请求先提交再退役可只读确认，回执淘汰后也不能重新执行', async t => {
  const f = fixture(t);
  const operation = f.batch();
  const accepted = await f.service.pushBatch(operation);
  const command = f.command(operation);
  f.service.retireDevice(command);
  const head = f.store.getSyncJournal().head;
  assert.deepEqual(await f.service.pushBatch(operation), accepted);
  assert.equal(f.store.getSyncJournal().head, head);
  f.store.runSyncJournalTransaction(() => {
    delete f.store.getSyncJournal().receipts[JSON.stringify([operation.deviceId, operation.operationId])];
  });
  await assert.rejects(f.service.pushBatch(operation), { code: 'SYNC_DEVICE_RETIRED' });
  assert.equal(f.store.getSyncJournal().head, head);
});

test('v1 原请求先提交后只读确认，清除回执后退役编号仍不可写入', t => {
  const f = fixture(t);
  const operation = f.legacy();
  const accepted = f.service.push(operation);
  f.service.retireDevice(f.command(operation));
  const head = f.store.getSyncJournal().head;
  assert.deepEqual(f.service.push(operation), accepted);
  assert.equal(f.store.getSyncJournal().head, head);
  f.store.runSyncJournalTransaction(() => {
    delete f.store.getSyncJournal().receipts[JSON.stringify([operation.deviceId, operation.operationId])];
  });
  assert.throws(() => f.service.push(operation), { code: 'SYNC_DEVICE_RETIRED' });
});

test('旧请求预读已放行、退役事务先提交时，真正业务事务仍拒绝写入', async t => {
  const f = fixture(t);
  let releaseRead;
  const pending = new Promise(resolve => {
    releaseRead = resolve;
  });
  let intercepted = false;
  const provider = {
    read(callback) {
      const result = callback(f.store.state, f.store.getSyncJournal());
      if (intercepted) return result;
      intercepted = true;
      return pending.then(() => result);
    },
    mutate: callback => f.store.runSyncTransaction(() => callback(f.store.state, f.store.getSyncJournal())),
    mutateJournal: callback =>
      f.store.runSyncJournalTransaction(() => callback(f.store.state, f.store.getSyncJournal())),
    preview: () => ({ state: f.store.state, journal: f.store.previewSyncJournal() }),
    applyState: state => {
      for (const collection of Object.keys(state))
        f.store.state[collection].splice(0, f.store.state[collection].length, ...state[collection]);
    },
    applyNote: () => {
      throw new Error('此受控场景不应执行笔记写入');
    }
  };
  const batchService = createBatchSyncService(provider, 'demo');
  const noteService = createSyncService(provider, 'demo');
  const operation = f.batch();
  const sending = batchService.pushBatch(operation);
  noteService.retireDevice(f.command(operation));
  releaseRead();
  await assert.rejects(sending, { code: 'SYNC_DEVICE_RETIRED' });
  assert.equal(f.knowledge.noteService.getNote(f.note.id).favorite, false);
});

test('原子写入失败同时回滚作废事实与格式门禁，保留原请求可继续核对', t => {
  let fail = false;
  const f = fixture(t, {
    writeJson(file, value) {
      if (fail && value.sync?.version === 2) throw new Error('合成屏障落盘失败');
      writeJsonFileAtomically(file, value);
    }
  });
  const before = fs.readFileSync(f.file);
  fail = true;
  assert.throws(() => f.service.retireDevice(f.command()), /合成屏障落盘失败/);
  assert.deepEqual(fs.readFileSync(f.file), before);
  assert.equal(f.store.getSyncJournal().version, 1);
  assert.equal(f.store.getSyncJournal().retiredDevices, undefined);
});

test('受支持旧内容回滚与epoch重建均保留退役事实及v2门禁', async t => {
  const f = fixture(t);
  const earlier = f.store.exportSnapshot();
  const operation = f.batch();
  const retirement = f.service.retireDevice(f.command(operation)).retirement;
  f.knowledge.noteService.updateNote(f.note.id, { title: '屏障后的合成编辑' });
  const epoch = f.store.getSyncJournal().epoch;
  f.store.commitImport(earlier);
  const restored = f.store.getSyncJournal();
  assert.notEqual(restored.epoch, epoch);
  assert.equal(restored.version, 2);
  assert.deepEqual(restored.retiredDevices['old-device'], retirement);
  assert.equal(f.knowledge.noteService.getNote(f.note.id).title, earlier.data.notes[0].title);
  await assert.rejects(f.service.pushBatch(f.batch('old-device', 999, 'after-restore')), {
    code: 'SYNC_DEVICE_RETIRED'
  });
  const reset = resetJournalKeepingTombstones(restored, f.store.state);
  assert.notEqual(reset.epoch, restored.epoch);
  assert.equal(reset.version, 2);
  assert.deepEqual(reset.retiredDevices, restored.retiredDevices);
  assert.throws(() => assertSyncDeviceNotRetired(reset, 'old-device'), { code: 'SYNC_DEVICE_RETIRED' });
});

test('退役记录损坏、缺失或降级伪装为v1时停止加载，不当作无保护旧日志', t => {
  const f = fixture(t);
  f.service.retireDevice(f.command());
  const journal = structuredClone(f.store.getSyncJournal());
  for (const value of [
    { ...journal, retiredDevices: undefined },
    { ...journal, retiredDevices: {} },
    { ...journal, version: 1 },
    {
      ...journal,
      retiredDevices: { 'old-device': { ...journal.retiredDevices['old-device'], successorDeviceId: 'tampered' } }
    }
  ])
    assert.throws(() => loadJournal(value, f.store.state), { code: 'SYNC_STORAGE_INVALID' });
  assert.equal(loadJournal(journal, f.store.state).version, 2);
});

test('HTTP仅明确POST才建立屏障，响应查询绑定owner及恢复身份', async t => {
  const f = fixture(t);
  const server = createServer({ appContext: f.context, logger: { error() {} } });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const command = f.command();
  const route = `${origin}/api/sync/device-retirement`;
  const rejected = await fetch(route, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...command, action: 'preview' })
  });
  assert.equal(rejected.status, 409);
  assert.equal(f.store.getSyncJournal().version, 1);
  const accepted = await fetch(route, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(command)
  });
  assert.equal(accepted.status, 200);
  const response = (await accepted.json()).data;
  assert.equal(response.journalVersion, 2);
  assert.equal(response.retirement.ownerId, 'demo');
  const queried = await fetch(`${route}?deviceId=old-device&recoveryId=explicit-recovery&${syncContractQuery()}`);
  assert.deepEqual((await queried.json()).data.retirement, response.retirement);
});
