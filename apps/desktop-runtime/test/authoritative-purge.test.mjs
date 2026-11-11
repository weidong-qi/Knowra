import assert from 'node:assert/strict';
import path from 'node:path';
import { once } from 'node:events';
import { test } from 'node:test';
import { createFileDataStore } from '../../api/src/infrastructure/file-data-store.ts';
import { createAppContext } from '../../api/src/app.factory.ts';
import { createServer } from '../../api/src/server.ts';
import { createAttachmentTransfer } from '../../api/src/modules/sync/attachment-transfer.ts';
import { createSyncEngine } from '../src/sync-engine.mjs';
import { readMeta, writeMeta } from '../src/sync-state.mjs';
import fs from 'node:fs';
import { startLocalRuntime } from '../src/runtime-server.mjs';
import { createPostgresAppContext } from '../../api/src/postgres-app.factory.ts';
import { createPostgresTestDatabase } from '../../../scripts/test-support/postgres-test-database.mjs';
import { WRITABLE_COLLECTIONS } from '../../api/src/modules/sync/entity-contract.ts';
import { trainingAssets } from '../../api/test/authoritative-asset-purge.test.js';
import { openWorkspace, temporaryDirectory } from './helpers.mjs';

async function fixture(t) {
  const root = temporaryDirectory(t),
    store = createFileDataStore(path.join(root, 'cloud.json'));
  const app = createAppContext({ dataStore: store, storageRootDir: root, uploadsDir: path.join(root, 'uploads') });
  const server = createServer({ appContext: app, logger: { error() {} } });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`;
  function device(name, fetcher = fetch) {
    const directory = path.join(root, name),
      device = {};
    function open() {
      Object.assign(device, openWorkspace(directory));
      device.engine = createSyncEngine(device.store, {
        autoSync: false,
        fetcher,
        noteService: device.knowledge.noteService,
        entityTransfer: createAttachmentTransfer({
          uploadsDir: path.join(directory, 'uploads'),
          storageRootDir: directory
        })
      });
    }
    open();
    device.connect = () => device.engine.configure({ serverUrl: origin });
    device.restart = async () => {
      await device.engine.close();
      device.store.close();
      open();
    };
    t.after(async () => {
      await device.engine.close();
      device.store.close();
    });
    return device;
  }
  const knowledge = app.modules.knowledge;
  const { item } = knowledge.knowledgeItemService.createCandidate({
    title: '合成手工清理',
    canonicalStatement: '仅测试正文',
    sourceMode: 'manual'
  });
  knowledge.knowledgeItemService.trash(item.id);
  return { root, store, app, knowledge, item, origin, device };
}
const meta = (device, key) => device.store.readSync(db => readMeta(db, key));

test('联网权威知识清理两SQLite端收敛，只有云端revision墓碑产生删除事实', async t => {
  const cloud = await fixture(t),
    a = cloud.device('a'),
    b = cloud.device('b');
  await a.connect();
  await b.connect();
  const preview = await a.engine.purgePreview('knowledgeItem', cloud.item.id);
  assert.equal(preview.coverage.runningTasks, 'verified');
  assert.equal(preview.expectedDatasetEpoch, cloud.store.getSyncJournal().epoch);
  const result = await a.engine.purge('knowledgeItem', cloud.item.id, preview);
  assert.equal(result.status, 'subject-purged');
  assert.equal(meta(a, 'authoritativePurgePending'), null);
  await b.engine.sync();
  for (const device of [a, b]) {
    assert.equal(
      device.store.state.knowledgeItems.some(row => row.id === cloud.item.id),
      false
    );
    const fact = device.store.deletionFacts.list().find(row => row.entityId === cloud.item.id);
    assert.equal(fact.source.kind, 'remote-delete');
    assert(fact.source.revision > 0);
    assert(
      !device.store
        .readOutbox()
        .some(
          row =>
            row.state !== 'acknowledged' &&
            row.changes.some(change => change.entityId === cloud.item.id && change.value === null)
        )
    );
  }
});

test('离线权威清理预检拒绝，本地原件及outbox不受影响', async t => {
  const cloud = await fixture(t);
  let offline = false,
    executions = 0;
  const a = cloud.device('offline', (url, init) => {
    if (init?.method === 'DELETE' || url.endsWith('/purge')) executions++;
    return offline ? Promise.reject(new Error('合成离线')) : fetch(url, init);
  });
  await a.connect();
  const before = a.store.exportSnapshot().data,
    outbox = a.store.readOutbox();
  offline = true;
  await assert.rejects(a.engine.purgePreview('knowledgeItem', cloud.item.id), { code: 'SYNC_NETWORK_UNAVAILABLE' });
  assert.deepEqual(a.store.exportSnapshot().data, before);
  assert.deepEqual(a.store.readOutbox(), outbox);
  assert.equal(executions, 0);
});

test('清理响应丢失后重启先拉取核对，不再次发送DELETE', async t => {
  const cloud = await fixture(t);
  let lose = true,
    executions = 0;
  const a = cloud.device('lost', async (url, init) => {
    const response = await fetch(url, init);
    if (init?.method === 'DELETE') {
      executions++;
      if (lose) {
        lose = false;
        throw new Error('合成丢响应');
      }
    }
    return response;
  });
  await a.connect();
  const preview = await a.engine.purgePreview('knowledgeItem', cloud.item.id);
  await assert.rejects(a.engine.purge('knowledgeItem', cloud.item.id, preview), { code: 'SYNC_NETWORK_UNAVAILABLE' });
  assert(meta(a, 'authoritativePurgePending'));
  assert(a.store.state.knowledgeItems.some(row => row.id === cloud.item.id));
  assert.equal(
    cloud.store.state.knowledgeItems.some(row => row.id === cloud.item.id),
    false
  );
  await a.restart();
  assert(meta(a, 'authoritativePurgePending'));
  await a.engine.sync();
  assert.equal(a.engine.status().error, null);
  assert.equal(executions, 1);
  assert.equal(meta(a, 'authoritativePurgePending'), null);
  assert.equal(
    a.store.state.knowledgeItems.some(row => row.id === cloud.item.id),
    false
  );
});

for (const outcome of ['accepted-with-edit', 'not-delivered'])
  test(`真实513次日志裁剪后清理${outcome}只读快照恢复游标，先核对墓碑并保全修改`, async t => {
    const cloud = await fixture(t);
    let lose = true,
      deletes = 0,
      snapshots = 0,
      uploadBeforeFact = false;
    const requests = [];
    const space = cloud.knowledge.knowledgeSpaceService.createDefaultKnowledgeSpace({ userId: 'demo' });
    const note = cloud.knowledge.noteService.createNote({ title: '无关日志活动', rawMarkdown: '0', spaceId: space.id });
    const a = cloud.device(`expired-${outcome}`, async (url, init) => {
      if (init?.method === 'DELETE') {
        deletes++;
        if (lose && outcome === 'not-delivered') {
          lose = false;
          throw new Error('合成未送达');
        }
      }
      if (url.includes('/snapshot?')) snapshots++;
      if (url.endsWith('/batch') && !a.store.deletionFacts.has('knowledgeItems', cloud.item.id))
        uploadBeforeFact = true;
      const entry = { path: new URL(url).pathname, method: init?.method ?? 'GET' };
      requests.push(entry);
      let response;
      // 513次同步JSON写入会阻塞事件循环并耗尽空闲keepalive；本例专测游标恢复，使用独立真实HTTP连接。
      try {
        response = await fetch(url, { ...init, headers: { ...init?.headers, Connection: 'close' } });
        entry.status = response.status;
      } catch (failure) {
        entry.failure = {
          code: failure.code ?? null,
          causeCode: failure.cause?.code ?? null,
          message: failure.message
        };
        throw failure;
      }
      if (init?.method === 'DELETE' && lose) {
        lose = false;
        throw new Error('合成已接纳但丢响应');
      }
      return response;
    });
    await a.connect();
    const preview = await a.engine.purgePreview('knowledgeItem', cloud.item.id);
    await assert.rejects(a.engine.purge('knowledgeItem', cloud.item.id, preview), { code: 'SYNC_NETWORK_UNAVAILABLE' });
    const originalPending = structuredClone(meta(a, 'authoritativePurgePending'));
    const sequence = JSON.parse(Buffer.from(meta(a, 'cursor'), 'base64url')).sequence;
    for (let i = 1; i <= 513; i++) cloud.knowledge.noteService.updateNote(note.id, { rawMarkdown: String(i) });
    assert(cloud.store.getSyncJournal().floor > sequence, '真正触发内置512组保留裁剪');
    if (outcome === 'accepted-with-edit') {
      a.knowledge.knowledgeItemService.restoreDeleted(cloud.item.id);
      a.knowledge.knowledgeItemService.updateItem(cloud.item.id, { canonicalStatement: '裁剪后仍须保全的新编辑' });
    }
    await a.restart();
    snapshots = 0;
    requests.length = 0;
    await a.engine.sync();
    assert(
      snapshots > 0,
      JSON.stringify({
        outcome,
        requests,
        error: a.engine.status().error,
        floor: cloud.store.getSyncJournal().floor,
        sequence
      })
    );
    assert(
      requests.some(entry => entry.path === '/api/sync/bootstrap' && entry.method === 'POST' && entry.status === 200)
    );
    assert(
      requests.some(entry => entry.path === '/api/sync/snapshot' && entry.method === 'GET' && entry.status === 200)
    );
    assert(!requests.some(entry => entry.method === 'DELETE'));
    assert(meta(a, 'cursor'));
    assert.equal(deletes, 1);
    assert.equal(uploadBeforeFact, false);
    if (outcome === 'accepted-with-edit') {
      assert.equal(a.engine.status().error, null);
      assert.equal(meta(a, 'authoritativePurgePending'), null);
      const fact = a.store.deletionFacts.list().find(row => row.entityId === cloud.item.id);
      assert.equal(fact.source.kind, 'remote-delete');
      assert(fact.source.revision > 0);
      assert.equal(meta(a, 'authoritativePurgeResult').localState, 'recovery-required');
      assert(a.engine.status().entityConflict);
      assert.equal(
        a.store.state.knowledgeItems.find(row => row.id === cloud.item.id).canonicalStatement,
        '裁剪后仍须保全的新编辑'
      );
      await a.restart();
      assert(a.engine.status().entityConflict);
      assert.equal(
        a.store.state.knowledgeItems.find(row => row.id === cloud.item.id).canonicalStatement,
        '裁剪后仍须保全的新编辑'
      );
    } else {
      assert.equal(a.engine.status().error.code, 'LOCAL_PURGE_RESULT_PENDING');
      assert.deepEqual(meta(a, 'authoritativePurgePending'), originalPending);
      assert(a.store.state.knowledgeItems.some(row => row.id === cloud.item.id));
      assert.equal(a.store.deletionFacts.has('knowledgeItems', cloud.item.id), false);
      const fresh = await a.engine.purgePreview('knowledgeItem', cloud.item.id);
      assert(fresh.confirmationToken);
      assert.equal(deletes, 1);
      assert.equal(meta(a, 'authoritativePurgePending'), null);
    }
  });

test('清理待核对且游标已空时，云端epoch改变拒绝只读bootstrap并保全原请求', async t => {
  const cloud = await fixture(t);
  let snapshots = 0,
    deletes = 0,
    lose = true;
  const a = cloud.device('pending-epoch-changed', async (url, init) => {
    if (url.includes('/snapshot?') || url.endsWith('/bootstrap')) snapshots++;
    const response = await fetch(url, init);
    if (init?.method === 'DELETE') {
      deletes++;
      if (lose) {
        lose = false;
        throw new Error('合成丢响应');
      }
    }
    return response;
  });
  await a.connect();
  const preview = await a.engine.purgePreview('knowledgeItem', cloud.item.id);
  await assert.rejects(a.engine.purge('knowledgeItem', cloud.item.id, preview), { code: 'SYNC_NETWORK_UNAVAILABLE' });
  a.knowledge.knowledgeItemService.restoreDeleted(cloud.item.id);
  a.knowledge.knowledgeItemService.updateItem(cloud.item.id, { canonicalStatement: '不同世代不能吞掉的修改' });
  a.store.metadataTransaction(db => writeMeta(db, 'cursor', null));
  const pending = structuredClone(meta(a, 'authoritativePurgePending')),
    state = a.store.exportSnapshot().data,
    outbox = a.store.readOutbox();
  cloud.store.commitImport(cloud.store.exportSnapshot());
  await a.restart();
  snapshots = 0;
  await a.engine.sync();
  assert.equal(a.engine.status().error.code, 'LOCAL_PURGE_BINDING_CHANGED');
  assert.equal(snapshots, 0);
  assert.equal(deletes, 1);
  assert.deepEqual(meta(a, 'authoritativePurgePending'), pending);
  assert.deepEqual(a.store.exportSnapshot().data, state);
  assert.deepEqual(a.store.readOutbox(), outbox);
  await assert.rejects(a.engine.purgePreview('knowledgeItem', cloud.item.id), {
    code: 'LOCAL_PURGE_CONNECTION_REQUIRED'
  });
  assert.equal(snapshots, 0);
  assert.equal(deletes, 1);
});

test('未送达清理不形成离线删除队列；主动新预检后必须再次人工确认', async t => {
  const cloud = await fixture(t);
  let lose = true,
    executions = 0;
  const a = cloud.device('not-delivered', async (url, init) => {
    if (init?.method === 'DELETE' && lose) {
      lose = false;
      throw new Error('合成未送达');
    }
    if (init?.method === 'DELETE') executions++;
    return fetch(url, init);
  });
  await a.connect();
  const preview = await a.engine.purgePreview('knowledgeItem', cloud.item.id);
  await assert.rejects(a.engine.purge('knowledgeItem', cloud.item.id, preview), { code: 'SYNC_NETWORK_UNAVAILABLE' });
  await a.restart();
  await a.engine.sync();
  assert.equal(a.engine.status().error.code, 'LOCAL_PURGE_RESULT_PENDING');
  assert.equal(executions, 0);
  assert(a.store.state.knowledgeItems.some(row => row.id === cloud.item.id));
  assert(meta(a, 'authoritativePurgePending'));
  const fresh = await a.engine.purgePreview('knowledgeItem', cloud.item.id);
  assert.notEqual(fresh.confirmationToken, preview.confirmationToken);
  assert.equal(meta(a, 'authoritativePurgePending'), null);
  assert.equal(executions, 0);
  await assert.rejects(a.engine.purge('knowledgeItem', cloud.item.id, preview), {
    code: 'LOCAL_PURGE_PREVIEW_REQUIRED'
  });
  assert.equal((await a.engine.purge('knowledgeItem', cloud.item.id, fresh)).status, 'subject-purged');
  assert.equal(executions, 1);
});

test('清理请求期间合法恢复和新编辑不会消失，云端事实与本地待恢复分别报告', async t => {
  const cloud = await fixture(t);
  let entered, release;
  const requestEntered = new Promise(resolve => {
      entered = resolve;
    }),
    gate = new Promise(resolve => {
      release = resolve;
    });
  t.after(() => release());
  const a = cloud.device('editing', async (url, init) => {
    const response = await fetch(url, init);
    if (init?.method === 'DELETE') {
      entered();
      await gate;
    }
    return response;
  });
  await a.connect();
  const preview = await a.engine.purgePreview('knowledgeItem', cloud.item.id);
  const executing = a.engine.purge('knowledgeItem', cloud.item.id, preview);
  await requestEntered;
  a.knowledge.knowledgeItemService.restoreDeleted(cloud.item.id);
  a.knowledge.knowledgeItemService.updateItem(cloud.item.id, { canonicalStatement: '执行期间需要保全的新编辑' });
  release();
  const result = await executing;
  assert.equal(result.status, 'subject-purged');
  assert.equal(result.localState, 'recovery-required');
  assert.equal(
    a.store.state.knowledgeItems.find(row => row.id === cloud.item.id).canonicalStatement,
    '执行期间需要保全的新编辑'
  );
  assert(a.engine.status().entityConflict);
  assert(
    a.engine
      .recovery()
      .some(record =>
        record.snapshot?.knowledgeItems.some(row => row.canonicalStatement === '执行期间需要保全的新编辑')
      )
  );
  await a.restart();
  assert(a.engine.status().entityConflict);
  assert.equal(
    a.store.state.knowledgeItems.find(row => row.id === cloud.item.id).canonicalStatement,
    '执行期间需要保全的新编辑'
  );
});

test(
  '融合训练同步后：题目清理期间合法恢复和编辑保留为待恢复冲突',
  { skip: WRITABLE_COLLECTIONS.includes('questions') ? false : '等待第二批训练同步核心融合' },
  async t => {
    const cloud = await fixture(t),
      records = await trainingAssets(cloud.knowledge),
      question = records.find(([type]) => type === 'question')[2];
    cloud.knowledge.trainingAssetLifecycle.trash('question', question.id);
    let entered, release;
    const requestEntered = new Promise(resolve => {
        entered = resolve;
      }),
      gate = new Promise(resolve => {
        release = resolve;
      });
    t.after(() => release());
    const a = cloud.device('training-editing', async (url, init) => {
      const response = await fetch(url, init);
      if (init?.method === 'POST' && url.endsWith('/purge')) {
        entered();
        await gate;
      }
      return response;
    });
    await a.connect();
    const preview = await a.engine.purgePreview('question', question.id);
    const executing = a.engine.purge('question', question.id, preview);
    await requestEntered;
    a.knowledge.trainingAssetLifecycle.restore('question', question.id);
    a.knowledge.questionService.updateQuestion(question.id, { stem: '清理期间人工新编辑题干' });
    release();
    const result = await executing;
    assert.equal(result.localState, 'recovery-required');
    assert(a.engine.status().entityConflict);
    assert.equal(a.store.state.questions.find(row => row.id === question.id).stem, '清理期间人工新编辑题干');
    assert(
      a.engine.recovery().some(record => record.snapshot?.questions.some(row => row.stem === '清理期间人工新编辑题干'))
    );
    await a.restart();
    assert(a.engine.status().entityConflict);
    assert.equal(a.store.state.questions.find(row => row.id === question.id).stem, '清理期间人工新编辑题干');
  }
);

test('旧预检确认遇云端对象改变或资料库epoch变化均拒绝执行', async t => {
  for (const change of ['object', 'epoch']) {
    const cloud = await fixture(t);
    let executions = 0;
    const a = cloud.device(change, (url, init) => {
      if (init?.method === 'DELETE') executions++;
      return fetch(url, init);
    });
    await a.connect();
    const preview = await a.engine.purgePreview('knowledgeItem', cloud.item.id);
    if (change === 'object') {
      cloud.knowledge.knowledgeItemService.restoreDeleted(cloud.item.id);
      cloud.knowledge.knowledgeItemService.updateItem(cloud.item.id, { title: '预检后变化' });
      cloud.knowledge.knowledgeItemService.trash(cloud.item.id);
    } else cloud.store.commitImport(cloud.store.exportSnapshot());
    await assert.rejects(a.engine.purge('knowledgeItem', cloud.item.id, preview), {
      code: change === 'object' ? 'LOCAL_PURGE_PREVIEW_STALE' : 'LOCAL_PURGE_BINDING_CHANGED'
    });
    assert.equal(executions, 0);
    assert.equal(meta(a, 'authoritativePurgePending'), null);
    assert(cloud.store.state.knowledgeItems.some(row => row.id === cloud.item.id));
  }
});

test('独立笔记冲突不阻止已同步手工资产的权威清理', async t => {
  const cloud = await fixture(t),
    a = cloud.device('unrelated-a'),
    b = cloud.device('unrelated-b');
  await a.connect();
  await b.connect();
  const note = a.knowledge.noteService.createNote({ title: '独立笔记', rawMarkdown: '共同正文', spaceId: a.space.id });
  await a.engine.sync();
  await b.engine.sync();
  a.knowledge.noteService.updateNote(note.id, { rawMarkdown: '本地待保留' });
  b.knowledge.noteService.updateNote(note.id, { rawMarkdown: '另一端正文' });
  await b.engine.sync();
  await a.engine.sync();
  assert(a.engine.status().entityConflict);
  const preview = await a.engine.purgePreview('knowledgeItem', cloud.item.id);
  assert.equal((await a.engine.purge('knowledgeItem', cloud.item.id, preview)).status, 'subject-purged');
  assert.equal(a.knowledge.noteService.getNote(note.id).rawMarkdown, '本地待保留');
  assert(a.engine.status().entityConflict);
});

test('四类手工训练清理经真实HTTP发送CAS，题目独占引用也拉取墓碑', async t => {
  const cloud = await fixture(t),
    records = await trainingAssets(cloud.knowledge);
  for (const [type, , asset] of records) await cloud.knowledge.trainingAssetLifecycle.trash(type, asset.id);
  const a = cloud.device('training-a'),
    b = cloud.device('training-b');
  await a.connect();
  await b.connect();
  for (const [type, , asset] of records) {
    const preview = await a.engine.purgePreview(type, asset.id);
    assert.equal(preview.decision, 'can-purge-no-history', JSON.stringify(preview));
    const result = await a.engine.purge(type, asset.id, preview);
    assert.equal(result.localState, 'synchronized');
    await b.engine.sync();
    for (const device of [a, b]) {
      assert(
        device.store.deletionFacts
          .list()
          .some(fact => fact.entityId === asset.id && fact.source.kind === 'remote-delete')
      );
      if (type === 'question')
        for (const ids of Object.values(preview.exclusiveRecords))
          for (const id of ids) assert(device.store.deletionFacts.list().some(fact => fact.entityId === id));
    }
  }
});

for (const action of ['sync', 'configure', 'disconnect', 'close'])
  test(`权威命令独占锁与${action}排空共用，等待期间不改变连接或关闭SQLite`, async t => {
    const cloud = await fixture(t);
    let entered,
      release,
      commandActive = false,
      overlapped = false;
    const requestEntered = new Promise(resolve => {
        entered = resolve;
      }),
      gate = new Promise(resolve => {
        release = resolve;
      });
    t.after(() => release());
    const a = cloud.device(`lock-${action}`, async (url, init) => {
      if (commandActive) overlapped = true;
      const response = await fetch(url, init);
      if (init?.method === 'DELETE') {
        commandActive = true;
        entered();
        await gate;
        commandActive = false;
      }
      return response;
    });
    await a.connect();
    const preview = await a.engine.purgePreview('knowledgeItem', cloud.item.id);
    const command = a.engine.purge('knowledgeItem', cloud.item.id, preview);
    await requestEntered;
    let finished = false;
    const waiting = (
      action === 'configure' ? a.engine.configure({ serverUrl: cloud.origin }) : a.engine[action]()
    ).then(() => {
      finished = true;
    });
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(finished, false);
    assert.equal(overlapped, false);
    assert(a.store.state.knowledgeItems.some(row => row.id === cloud.item.id));
    release();
    assert.equal((await command).status, 'subject-purged');
    await waiting;
    assert.equal(overlapped, false);
    assert.equal(finished, true);
  });

test('云端成功响应缺少真实墓碑时不能报成功或在本地产生删除事务', async t => {
  const cloud = await fixture(t);
  let hide = false;
  const a = cloud.device('missing-tombstone', async (url, init) => {
    const response = await fetch(url, init);
    if (init?.method === 'DELETE') hide = true;
    if (hide && url.includes('/changes?')) {
      const body = await response.json();
      body.data.groups.forEach(group => {
        group.items = group.items.filter(entry => entry.id !== cloud.item.id);
      });
      return Response.json(body);
    }
    return response;
  });
  await a.connect();
  const preview = await a.engine.purgePreview('knowledgeItem', cloud.item.id),
    before = a.store.exportSnapshot().data;
  await assert.rejects(a.engine.purge('knowledgeItem', cloud.item.id, preview), { code: 'LOCAL_PURGE_RESULT_PENDING' });
  assert(meta(a, 'authoritativePurgePending'));
  assert.deepEqual(a.store.exportSnapshot().data, before);
  assert.equal(
    a.store.deletionFacts.list().some(fact => fact.entityId === cloud.item.id),
    false
  );
});

test('云端执行CAS拒绝证明未接纳，可清待核对记录但保留原件及旧确认失效', async t => {
  const cloud = await fixture(t);
  const a = cloud.device('server-rejected', (url, init) => {
    if (init?.method === 'DELETE') {
      cloud.knowledge.knowledgeItemService.restoreDeleted(cloud.item.id);
      cloud.knowledge.knowledgeItemService.trash(cloud.item.id);
    }
    return fetch(url, init);
  });
  await a.connect();
  const preview = await a.engine.purgePreview('knowledgeItem', cloud.item.id),
    before = a.store.exportSnapshot().data;
  await assert.rejects(a.engine.purge('knowledgeItem', cloud.item.id, preview), {
    code: 'KNOWLEDGE_ITEM_UPDATE_CONFLICT'
  });
  assert.equal(meta(a, 'authoritativePurgePending'), null);
  assert.deepEqual(a.store.exportSnapshot().data, before);
  await assert.rejects(a.engine.purge('knowledgeItem', cloud.item.id, preview), {
    code: 'LOCAL_PURGE_PREVIEW_REQUIRED'
  });
});

test('预检网络期间产生关联本地对象，执行guard涵盖其未确认事务和旧引用', async t => {
  const cloud = await fixture(t);
  let edit = false;
  const a = cloud.device('related-edits', async (url, init) => {
    const response = await fetch(url, init);
    if (edit && url.endsWith('/purge-preview')) {
      a.store.runTransaction(() => {
        const current = a.store.state.knowledgeItems.find(row => row.id === cloud.item.id);
        current.title = '预检期间新修改';
        current.updatedAt = new Date(Date.parse(current.updatedAt) + 1).toISOString();
      });
    }
    return response;
  });
  await a.connect();
  edit = true;
  await assert.rejects(a.engine.purgePreview('knowledgeItem', cloud.item.id), { code: 'LOCAL_PURGE_PENDING_CHANGES' });
  assert.equal(a.store.state.knowledgeItems.find(row => row.id === cloud.item.id).title, '预检期间新修改');
  assert.equal(meta(a, 'authoritativePurgePending'), null);
});

test('任务覆盖未验证及非手工知识不能执行限定清理', async t => {
  const cloud = await fixture(t);
  let executions = 0;
  const a = cloud.device('unverified', async (url, init) => {
    if (init?.method === 'DELETE') executions++;
    const response = await fetch(url, init);
    if (url.endsWith('/purge-preview')) {
      const body = await response.json();
      body.data.coverage.runningTasks = 'unverified';
      return Response.json(body);
    }
    return response;
  });
  await a.connect();
  const preview = await a.engine.purgePreview('knowledgeItem', cloud.item.id);
  await assert.rejects(a.engine.purge('knowledgeItem', cloud.item.id, preview), { code: 'LOCAL_PURGE_BLOCKED' });
  assert.equal(executions, 0);
  assert.equal(meta(a, 'authoritativePurgePending'), null);
  const nonmanual = cloud.knowledge.knowledgeItemService.createCandidate({
    title: '合成非手工知识',
    canonicalStatement: '保留来源',
    sourceMode: 'annotation',
    evidence: [{ sourceType: 'manual', quoteText: '合成来源' }]
  }).item;
  cloud.knowledge.knowledgeItemService.trash(nonmanual.id);
  await a.engine.sync();
  await assert.rejects(a.engine.purgePreview('knowledgeItem', nonmanual.id), { code: 'PURGE_MANUAL_SCOPE_REQUIRED' });
  assert.equal(executions, 0);
});

test('冻结关联请求和旧outbox引用都必须先核对，不能只检查当前终态', async t => {
  for (const recordType of ['frozen', 'old-outbox-reference']) {
    const cloud = await fixture(t);
    let inject = false;
    const a = cloud.device(recordType, async (url, init) => {
      const response = await fetch(url, init);
      if (inject && url.endsWith('/purge-preview'))
        a.store.metadataTransaction(db => {
          if (recordType === 'frozen')
            writeMeta(db, 'entityUpload', {
              operationId: 'synthetic-in-flight',
              changes: [
                {
                  collection: 'knowledgeItems',
                  id: cloud.item.id,
                  value: structuredClone(a.store.state.knowledgeItems.find(row => row.id === cloud.item.id))
                }
              ]
            });
          else
            db.prepare(
              "INSERT INTO sync_outbox (operation_id,device_id,protocol_version,state,changes,dependencies,created_at) VALUES (?,?,2,'pending',?,'[]',?)"
            ).run(
              'synthetic-old-reference',
              a.store.getStatus().deviceId,
              JSON.stringify([
                {
                  collection: 'analysisScopeSnapshots',
                  entityId: 'synthetic-scope',
                  before: { id: 'synthetic-scope', artifactId: cloud.item.id },
                  value: { id: 'synthetic-scope', artifactId: 'another-synthetic-artifact' }
                }
              ]),
              new Date().toISOString()
            );
        });
      return response;
    });
    await a.connect();
    inject = true;
    await assert.rejects(a.engine.purgePreview('knowledgeItem', cloud.item.id), {
      code: 'LOCAL_PURGE_PENDING_CHANGES'
    });
    assert.equal(meta(a, 'authoritativePurgePending'), null);
  }
});

test('待核对元数据损坏明确停止，不能默默清除或当作执行成功', async t => {
  const cloud = await fixture(t),
    a = cloud.device('malformed');
  await a.connect();
  const before = a.store.exportSnapshot().data;
  a.store.metadataTransaction(db => writeMeta(db, 'authoritativePurgePending', false));
  assert.throws(() => a.engine.status(), { code: 'LOCAL_PURGE_PENDING_INVALID' });
  assert.deepEqual(a.store.exportSnapshot().data, before);
  assert.equal(meta(a, 'authoritativePurgePending'), false);
});

async function runtime(t, cloud, fetcher = fetch) {
  const directory = path.join(cloud.root, 'runtime'),
    distRoot = path.join(cloud.root, 'dist');
  fs.mkdirSync(distRoot);
  fs.writeFileSync(path.join(distRoot, 'index.html'), '<html><head></head><body>synthetic</body></html>');
  const local = await startLocalRuntime({
    dataDirectory: directory,
    distRoot,
    syncOptions: { autoSync: false, fetcher },
    logger: { error() {}, warn() {} }
  });
  t.after(() => local.close());
  const cookie = (await fetch(local.launchUrl, { redirect: 'manual' })).headers.get('set-cookie').split(';')[0];
  async function call(route, method = 'GET', body, headers = {}) {
    const response = await fetch(`${local.origin}${route}`, {
      method,
      headers: {
        Cookie: cookie,
        'Content-Type': 'application/json',
        'X-Knowra-Dataset': local.store.getStatus().datasetId,
        ...headers
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    });
    return { status: response.status, ...(await response.json()) };
  }
  return { local, call };
}

test('真实桌面controller截获五类权威清理，不能走SQLite本地永久删除', async t => {
  const cloud = await fixture(t),
    { local, call } = await runtime(t, cloud);
  assert.equal(
    (await call(`/api/knowledge/items/${cloud.item.id}/purge-preview`)).error.code,
    'LOCAL_PURGE_CONNECTION_REQUIRED'
  );
  assert.equal(
    (await call(`/api/knowledge/items/${cloud.item.id}/permanent`, 'DELETE', {})).error.code,
    'LOCAL_PURGE_PREVIEW_REQUIRED'
  );
  assert.equal((await call('/api/local-runtime/sync/configure', 'POST', { serverUrl: cloud.origin })).status, 200);
  const preview = await call(`/api/knowledge/items/${cloud.item.id}/purge-preview`);
  assert.equal(preview.status, 200);
  assert(preview.data.confirmationToken);
  const result = await call(`/api/knowledge/items/${cloud.item.id}/permanent`, 'DELETE', preview.data);
  assert.equal(result.status, 200);
  assert.equal(result.data.localState, 'synchronized');
  assert(
    local.store.deletionFacts
      .list()
      .some(fact => fact.entityId === cloud.item.id && fact.source.kind === 'remote-delete')
  );
  assert.equal(
    (await call('/api/knowledge/notes/unknown/permanent', 'DELETE', {})).error.code,
    'LOCAL_FEATURE_UNAVAILABLE'
  );
  assert.equal((await call('/api/knowledge/recycle-bin', 'DELETE', {})).error.code, 'LOCAL_FEATURE_UNAVAILABLE');
});

test('实际恢复请求先排空清理command，随后已知删除事实阻断旧备份恢复', async t => {
  const cloud = await fixture(t);
  let entered, release;
  const requestEntered = new Promise(resolve => {
      entered = resolve;
    }),
    gate = new Promise(resolve => {
      release = resolve;
    });
  t.after(() => release());
  const { local, call } = await runtime(t, cloud, async (url, init) => {
    const response = await fetch(url, init);
    if (init?.method === 'DELETE') {
      entered();
      await gate;
    }
    return response;
  });
  await call('/api/local-runtime/sync/configure', 'POST', { serverUrl: cloud.origin });
  const backup = (await call('/api/local-runtime/backup', 'POST', {})).data;
  const preview = (await call(`/api/knowledge/items/${cloud.item.id}/purge-preview`)).data;
  const purging = call(`/api/knowledge/items/${cloud.item.id}/permanent`, 'DELETE', preview);
  await requestEntered;
  let restored = false;
  const restoring = call(`/api/local-runtime/backups/${backup.id}/restore`, 'POST', {
    confirmBackupId: backup.id
  }).then(value => {
    restored = true;
    return value;
  });
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(restored, false);
  release();
  assert.equal((await purging).data.localState, 'synchronized');
  const rejected = await restoring;
  assert.equal(rejected.status, 409);
  assert.equal(rejected.error.code, 'LOCAL_RESTORE_DELETION_CONFLICT');
  assert.equal(
    local.store.state.knowledgeItems.some(row => row.id === cloud.item.id),
    false
  );
});

test(
  '真实PostgreSQL云端与两SQLite设备权威清理五类手工资产及独占墓碑',
  { skip: !process.env.KNOWRA_SYNC_TEST_DATABASE_URL, timeout: 60000 },
  async t => {
    const database = await createPostgresTestDatabase();
    t.after(() => database.close());
    const root = temporaryDirectory(t),
      app = await createPostgresAppContext({
        databaseUrl: database.databaseUrl,
        storageRootDir: root,
        uploadsDir: path.join(root, 'uploads')
      });
    t.after(() => app.close());
    await app.modules.knowledge.knowledgeSpaceService.createDefaultKnowledgeSpace({ userId: 'demo' });
    const records = await trainingAssets(app.modules.knowledge);
    const parent = (
      await app.modules.knowledge.knowledgeItemService.createCandidate({
        title: 'PG清理知识',
        canonicalStatement: '合成正文',
        sourceMode: 'manual'
      })
    ).item;
    await app.modules.knowledge.knowledgeItemService.trash(parent.id);
    for (const [type, , asset] of records) await app.modules.knowledge.trainingAssetLifecycle.trash(type, asset.id);
    const server = createServer({ appContext: app, logger: { error() {} } });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    t.after(() => new Promise(resolve => server.close(resolve)));
    const devices = ['pg-a', 'pg-b'].map(name => {
      const directory = path.join(root, name),
        workspace = openWorkspace(directory),
        engine = createSyncEngine(workspace.store, {
          autoSync: false,
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
      return { ...workspace, engine };
    });
    for (const device of devices)
      await device.engine.configure({ serverUrl: `http://127.0.0.1:${server.address().port}` });
    for (const [type, , asset] of [...records, ['knowledgeItem', 'items', parent]]) {
      const preview = await devices[0].engine.purgePreview(type, asset.id),
        result = await devices[0].engine.purge(type, asset.id, preview);
      assert.equal(result.localState, 'synchronized');
      await devices[1].engine.sync();
      for (const device of devices)
        assert(
          device.store.deletionFacts
            .list()
            .some(fact => fact.entityId === asset.id && fact.source.kind === 'remote-delete')
        );
    }
  }
);
