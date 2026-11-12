import assert from 'node:assert/strict';
import path from 'node:path';
import { once } from 'node:events';
import { test } from 'node:test';
import { createFileDataStore } from '../../api/src/infrastructure/file-data-store.ts';
import { createAppContext } from '../../api/src/app.factory.ts';
import { createServer } from '../../api/src/server.ts';
import { createAttachmentTransfer } from '../../api/src/modules/sync/attachment-transfer.ts';
import { NoteVersion } from '../../api/src/modules/knowledge/domain/note-version.ts';
import { SYNC_CLIENT_BATCH_BODY_LIMIT_BYTES } from '@study-accelerator/shared/http-limits';
import { createSyncEngine } from '../src/sync-engine.mjs';
import { nextEntityUpload, getEntitySyncState, acknowledgeEntityUpload } from '../src/entity-sync-state.mjs';
import { writeMeta } from '../src/sync-state.mjs';
import { temporaryDirectory, openWorkspace, markText, inlineId } from './helpers.mjs';
import { calculateContentHash } from '../../../packages/content-anchor/src/index.js';

async function fixture(t) {
  const root = temporaryDirectory(t);
  const cloud = createFileDataStore(path.join(root, 'cloud.json'));
  const context = createAppContext({ dataStore: cloud, storageRootDir: root });
  const space = context.modules.knowledge.knowledgeSpaceService.createDefaultKnowledgeSpace({ userId: 'demo' });
  const server = createServer({ appContext: context });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`;
  function device(name, fetcher) {
    const directory = path.join(root, name);
    const open = () => {
      const workspace = openWorkspace(directory);
      const transfer = createAttachmentTransfer({
        uploadsDir: path.join(directory, 'uploads'),
        storageRootDir: directory
      });
      return {
        ...workspace,
        engine: createSyncEngine(workspace.store, { entityTransfer: transfer, autoSync: false, fetcher })
      };
    };
    const result = open();
    result.restart = async () => {
      await result.engine.close();
      result.store.close();
      Object.assign(result, open());
    };
    result.connect = () => result.engine.configure({ serverUrl: origin });
    t.after(async () => {
      await result.engine.close();
      result.store.close();
    });
    return result;
  }
  return { cloud, space, device };
}

function annotatedNote(device, spaceId) {
  const note = device.knowledge.noteService.createNote({
    title: '长时间编辑',
    rawMarkdown: markText('重点正文', 'long-edit'),
    spaceId
  });
  device.knowledge.noteService.updateNote(note.id, {
    rawMarkdown: `${markText('重点正文', 'long-edit')}\n\n最终新增内容`
  });
  return { noteId: note.id, annotationId: inlineId(note.id, 'long-edit') };
}

for (const existing of [false, true])
  for (const loseResponse of [false, true])
    test(`长时间编辑${existing ? '已有' : '新建'}笔记：千条修订分批${loseResponse ? '、丢响应重启后暂停保全' : '并在第二设备完整收敛'}`, async t => {
      const f = await fixture(t);
      let armed = false,
        lost = false;
      const sent = [];
      const a = f.device('a', async (url, options) => {
        const response = await fetch(url, options);
        if (armed && url.endsWith('/batch')) {
          const operation = JSON.parse(options.body);
          sent.push(operation);
          if (
            loseResponse &&
            !lost &&
            operation.changes.some(entry => entry.collection === 'annotationRevisions' && entry.value.revision === 500)
          ) {
            lost = true;
            throw new Error('历史分批已接受但响应丢失');
          }
        }
        return response;
      });
      const b = f.device('b');
      await a.connect();
      const ids = annotatedNote(a, f.space.id);
      if (existing) {
        await a.engine.sync();
        assert.equal(a.engine.status().error, null);
      }
      const final = a.knowledge.noteService.updateNote(ids.noteId, { rawMarkdown: '重点正文\n\n离线编辑完成' });
      a.store.runTransaction(
        () => {
          const annotation = a.store.state.contentAnnotations.find(item => item.id === ids.annotationId);
          const template = a.store.state.annotationRevisions.find(item => item.annotationId === ids.annotationId);
          const start = annotation.revision + 1;
          for (let i = start; i <= 1105; i++)
            a.store.state.annotationRevisions.push({
              ...structuredClone(template),
              id: `long-revision-${i}`,
              revision: i,
              operation: 'comment'
            });
          annotation.revision = 1105;
          annotation.comment = '离线最终备注';
          for (let i = 0; i < 80; i++)
            a.store.state.noteVersions.push(
              new NoteVersion({ id: `long-version-${i}`, noteId: ids.noteId, content: `历史正文 ${i}` })
            );
        },
        { origin: 'migration' }
      );
      const revisions = structuredClone(a.store.state.annotationRevisions);
      const versions = structuredClone(a.store.state.noteVersions);
      armed = true;
      await a.engine.sync();
      if (loseResponse) {
        assert(lost);
        assert.equal(a.engine.status().error.code, 'SYNC_RESULT_UNCERTAIN');
        const frozen = a.store.readSync(db =>
          JSON.parse(db.prepare("SELECT value FROM metadata WHERE key='sync:entityUpload'").get().value)
        );
        await a.restart();
        await assert.rejects(a.connect(), { code: 'SYNC_RESULT_UNCERTAIN' });
        await a.engine.sync();
        assert.equal(sent.filter(operation => operation.operationId === frozen.operationId).length, 1);
        assert.equal(a.knowledge.noteService.getNote(ids.noteId).rawMarkdown, final.rawMarkdown);
        assert.deepEqual(a.store.state.annotationRevisions, revisions);
        assert.deepEqual(a.store.state.noteVersions, versions);
        assert(a.engine.status().pendingEntities > 0);
        assert(
          sent.every(
            operation => operation.changes.length <= 250 && Buffer.byteLength(JSON.stringify(operation)) <= 1024 * 1024
          )
        );
        return;
      }
      assert.equal(a.engine.status().error, null, JSON.stringify(a.engine.status()));
      assert.equal(a.engine.status().pendingEntities, 0);
      assert.equal(a.store.getStatus().pendingOperations, 0);
      await b.connect();
      assert.equal(b.engine.status().error, null);
      for (const store of [a.store, b.store, f.cloud]) {
        assert.equal(store.state.notes.find(item => item.id === ids.noteId).rawMarkdown, final.rawMarkdown);
        assert.equal(store.state.contentAnnotations.find(item => item.id === ids.annotationId).revision, 1105);
        for (const [collection, originals] of [
          ['annotationRevisions', revisions],
          ['noteVersions', versions]
        ]) {
          assert.deepEqual(store.state[collection], f.cloud.state[collection], '设备与云端保留历史一致');
          for (const original of originals) {
            const present = store.state[collection].find(item => item.id === original.id);
            if (present) assert.deepEqual(present, original);
            else
              assert.ok(
                f.cloud.getSyncJournal().tombstones[JSON.stringify([collection, original.id])],
                '旧历史必须有已提交的删除事实'
              );
          }
        }
      }
      assert(
        sent.every(
          operation => operation.changes.length <= 250 && Buffer.byteLength(JSON.stringify(operation)) <= 1024 * 1024
        )
      );
    });

test('单篇累计历史超过12MiB时按最终请求容量自动分批', async t => {
  const f = await fixture(t);
  const operations = [];
  const a = f.device('large', async (url, options) => {
    if (url.endsWith('/batch')) operations.push(JSON.parse(options.body));
    return fetch(url, options);
  });
  await a.connect();
  const ids = annotatedNote(a, f.space.id);
  a.store.runTransaction(() => {
    for (let i = 0; i < 30; i++)
      a.store.state.noteVersions.push(
        new NoteVersion({ id: `large-version-${i}`, noteId: ids.noteId, content: `${i}\n${'中'.repeat(150000)}` })
      );
  });
  await a.engine.sync();
  assert.equal(a.engine.status().error, null, JSON.stringify(a.engine.status()));
  assert.equal(a.engine.status().pendingEntities, 0);
  assert(operations.length >= 2);
  assert(
    operations.every(operation => Buffer.byteLength(JSON.stringify(operation)) <= SYNC_CLIENT_BATCH_BODY_LIMIT_BYTES)
  );
  assert.equal(
    f.cloud.state.noteVersions.filter(item => item.noteId === ids.noteId).length,
    a.store.state.noteVersions.length
  );
});

test('1MiB 是传输目标：合法的大正文及当前版本仍独立原子上传，旧历史留到后批', async t => {
  const f = await fixture(t);
  const operations = [];
  const a = f.device('large-core', async (url, options) => {
    if (url.endsWith('/batch')) operations.push(JSON.parse(options.body));
    return fetch(url, options);
  });
  await a.connect();
  operations.length = 0;
  const rawMarkdown = 'x'.repeat(650000);
  const note = a.knowledge.noteService.createNote({ title: '大正文原子提交', rawMarkdown, spaceId: f.space.id });
  a.store.runTransaction(() => {
    for (let i = 0; i < 3; i++)
      a.store.state.noteVersions.push(
        new NoteVersion({ id: `older-large-${i}`, noteId: note.id, content: `旧历史 ${i}` })
      );
  });
  await a.engine.sync();
  assert.equal(a.engine.status().error, null);
  const core = operations.find(operation =>
    operation.changes.some(entry => entry.collection === 'notes' && entry.id === note.id)
  );
  assert(Buffer.byteLength(JSON.stringify(core)) > 1024 * 1024);
  assert(Buffer.byteLength(JSON.stringify(core)) <= SYNC_CLIENT_BATCH_BODY_LIMIT_BYTES);
  assert(
    core.changes.some(
      entry => entry.collection === 'noteVersions' && entry.value.contentHash === calculateContentHash(rawMarkdown)
    )
  );
  assert(!core.changes.some(entry => entry.id.startsWith('older-large-')));
  assert.equal(a.engine.status().pendingEntities, 0);
  assert.equal(f.cloud.state.notes.find(item => item.id === note.id).rawMarkdown, rawMarkdown);
  assert.equal(f.cloud.state.noteVersions.filter(item => item.noteId === note.id).length, 4);
});

for (const stage of ['fetch', 'receipt'])
  test(`上传${stage === 'fetch' ? '等待响应' : '下载回执'}超时保留固定请求，90秒上传预算与15秒连通性预算分离，重启不丢后继编辑`, async t => {
    const originalTimeout = AbortSignal.timeout;
    const budgets = new WeakMap();
    AbortSignal.timeout = ms => {
      const signal = originalTimeout(ms);
      budgets.set(signal, ms);
      return signal;
    };
    t.after(() => {
      AbortSignal.timeout = originalTimeout;
    });
    const f = await fixture(t);
    let armed = false,
      lost = false;
    const requests = [];
    const a = f.device(`timeout-${stage}`, async (url, options) => {
      const upload = url.endsWith('/batch');
      requests.push({
        upload,
        bootstrap: url.endsWith('/bootstrap'),
        budget: budgets.get(options.signal),
        ...(upload ? { operation: JSON.parse(options.body) } : {})
      });
      const response = await fetch(url, options);
      if (armed && upload && !lost) {
        lost = true;
        await response.arrayBuffer();
        const failure = new DOMException('upload timed out', 'TimeoutError');
        if (stage === 'fetch') throw failure;
        return {
          ok: true,
          status: 200,
          headers: response.headers,
          json: async () => {
            throw failure;
          }
        };
      }
      return response;
    });
    await a.connect();
    const note = a.knowledge.noteService.createNote({
      title: `上传超时-${stage}`,
      rawMarkdown: '已在云端接受的正文',
      spaceId: f.space.id
    });
    armed = true;
    await a.engine.sync();
    assert.equal(a.engine.status().error.code, 'SYNC_RESULT_UNCERTAIN');
    assert.equal(a.engine.status().error.reason, 'SYNC_UPLOAD_TIMEOUT');
    assert.match(a.engine.status().error.message, /原请求和后续修改均已保留/);
    const frozen = a.store.readSync(db =>
      JSON.parse(db.prepare("SELECT value FROM metadata WHERE key='sync:entityUpload'").get().value)
    );
    assert(frozen);
    a.knowledge.noteService.updateNote(note.id, { rawMarkdown: '超时后继续编辑仍然保留' });
    await a.restart();
    await assert.rejects(a.connect(), { code: 'SYNC_RESULT_UNCERTAIN' });
    await a.engine.sync();
    assert.equal(a.engine.status().error.code, 'SYNC_RESULT_UNCERTAIN');
    assert(a.engine.status().pendingEntities > 0);
    assert.equal(a.knowledge.noteService.getNote(note.id).rawMarkdown, '超时后继续编辑仍然保留');
    assert.equal(f.cloud.state.notes.find(item => item.id === note.id).rawMarkdown, '已在云端接受的正文');
    const retries = requests.filter(item => item.operation?.operationId === frozen.operationId);
    assert.equal(retries.length, 1);
    assert.deepEqual(retries[0].operation, frozen);
    assert(requests.filter(item => item.upload).every(item => item.budget === 90000));
    assert(requests.filter(item => item.bootstrap).every(item => item.budget === 90000));
    assert(requests.filter(item => !item.upload && !item.bootstrap).every(item => item.budget === 15000));
  });

for (const stage of ['fetch', 'receipt'])
  test(`初始化快照${stage === 'fetch' ? '等待响应' : '下载响应'}超时保留本机修改，重启后使用90秒预算完成同步`, async t => {
    const originalTimeout = AbortSignal.timeout;
    const budgets = new WeakMap();
    AbortSignal.timeout = ms => {
      const signal = originalTimeout(ms);
      budgets.set(signal, ms);
      return signal;
    };
    t.after(() => {
      AbortSignal.timeout = originalTimeout;
    });
    const f = await fixture(t);
    let lost = false;
    const requests = [];
    const a = f.device(`bootstrap-timeout-${stage}`, async (url, options) => {
      requests.push({
        bootstrap: url.endsWith('/bootstrap'),
        upload: url.endsWith('/batch'),
        budget: budgets.get(options.signal)
      });
      const response = await fetch(url, options);
      if (url.endsWith('/bootstrap') && !lost) {
        lost = true;
        await response.arrayBuffer();
        const failure = new DOMException('snapshot timed out', 'TimeoutError');
        if (stage === 'fetch') throw failure;
        return {
          ok: true,
          status: 200,
          headers: response.headers,
          json: async () => {
            throw failure;
          }
        };
      }
      return response;
    });
    const note = a.knowledge.noteService.createNote({
      title: '初始化前的本机笔记',
      rawMarkdown: '尚未上传的正文',
      spaceId: f.space.id
    });
    await a.connect();
    assert.equal(a.engine.status().error.code, 'SYNC_BOOTSTRAP_TIMEOUT');
    assert.match(a.engine.status().error.message, /本地资料已保留/);
    assert(a.engine.status().pendingEntities > 0);
    assert.equal(a.store.state.notes.find(item => item.id === note.id).rawMarkdown, '尚未上传的正文');
    await a.restart();
    await a.connect();
    assert.equal(a.engine.status().error, null);
    assert.equal(a.engine.status().pendingEntities, 0);
    assert.equal(f.cloud.state.notes.find(item => item.id === note.id).rawMarkdown, '尚未上传的正文');
    assert(requests.some(item => item.bootstrap));
    assert(requests.filter(item => item.bootstrap).every(item => item.budget === 90000));
    assert(requests.filter(item => item.upload).every(item => item.budget === 90000));
    assert(requests.filter(item => !item.bootstrap && !item.upload).every(item => item.budget === 15000));
  });

test('升级前的1000条冻结请求不拆改也不重放，重启后仍保留全部后续历史', async t => {
  const f = await fixture(t);
  const sent = [];
  let lost = false;
  const a = f.device('legacy-frozen', async (url, options) => {
    const response = await fetch(url, options);
    if (url.endsWith('/batch')) {
      const operation = JSON.parse(options.body);
      sent.push(operation);
      if (operation.changes.length === 1000 && !lost) {
        lost = true;
        await response.arrayBuffer();
        throw new DOMException('legacy upload timeout', 'TimeoutError');
      }
    }
    return response;
  });
  await a.connect();
  sent.length = 0;
  const ids = annotatedNote(a, f.space.id);
  a.store.runTransaction(
    () => {
      const annotation = a.store.state.contentAnnotations.find(item => item.id === ids.annotationId);
      const template = a.store.state.annotationRevisions.find(item => item.annotationId === ids.annotationId);
      for (let i = annotation.revision + 1; i <= 1105; i++)
        a.store.state.annotationRevisions.push({
          ...structuredClone(template),
          id: `legacy-revision-${i}`,
          revision: i,
          operation: 'comment'
        });
      annotation.revision = 1105;
    },
    { origin: 'migration' }
  );
  const originalRevisions = structuredClone(a.store.state.annotationRevisions);
  const legacy = nextEntityUpload(a.store);
  const own = new Set(legacy.changes.map(entry => entry.id));
  legacy.changes.push(
    ...a.store.state.annotationRevisions
      .filter(item => !own.has(item.id))
      .slice(0, 1000 - legacy.changes.length)
      .map(value => ({
        collection: 'annotationRevisions',
        id: value.id,
        baseRevision: null,
        value: structuredClone(value)
      }))
  );
  assert.equal(legacy.changes.length, 1000);
  a.store.metadataTransaction(db => writeMeta(db, 'entityUpload', legacy));
  await a.engine.sync();
  assert.equal(a.engine.status().error.code, 'SYNC_RESULT_UNCERTAIN');
  await a.restart();
  await assert.rejects(a.connect(), { code: 'SYNC_RESULT_UNCERTAIN' });
  await a.engine.sync();
  assert.equal(sent.length, 0);
  assert.deepEqual(
    a.store.readSync(db =>
      JSON.parse(db.prepare("SELECT value FROM metadata WHERE key='sync:entityUpload'").get().value)
    ),
    legacy
  );
  assert.deepEqual(a.store.state.annotationRevisions, originalRevisions);
  assert.equal(a.store.state.contentAnnotations.find(item => item.id === ids.annotationId).revision, 1105);
  assert(a.engine.status().pendingEntities > 0);
});

test('真正超大的当前正文组明确阻塞，正文、历史、outbox和冻结元数据原样保留', t => {
  const workspace = openWorkspace(temporaryDirectory(t));
  t.after(() => workspace.store.close());
  const note = workspace.knowledge.noteService.createNote({
    title: '超大当前正文',
    rawMarkdown: '',
    spaceId: workspace.space.id
  });
  const initial = nextEntityUpload(workspace.store);
  acknowledgeEntityUpload(workspace.store, initial, {
    status: 'accepted',
    entries: initial.changes.map(entry => ({ ...entry, revision: 1 }))
  });
  const rawMarkdown = 'x'.repeat(SYNC_CLIENT_BATCH_BODY_LIMIT_BYTES);
  workspace.store.runTransaction(() => {
    const current = workspace.store.state.notes.find(item => item.id === note.id);
    Object.assign(current, { rawMarkdown, contentHash: calculateContentHash(rawMarkdown), annotationStructure: null });
    workspace.store.state.noteVersions.push(
      new NoteVersion({ id: 'oversized-current-version', noteId: note.id, content: rawMarkdown })
    );
  });
  const pending = getEntitySyncState(workspace.store).pendingEntities;
  const rows = () =>
    workspace.store.readSync(db => ({
      metadata: db.prepare('SELECT * FROM metadata ORDER BY key').all(),
      outbox: db.prepare('SELECT * FROM sync_outbox').all()
    }));
  const before = rows();
  assert.throws(() => nextEntityUpload(workspace.store), { code: 'SYNC_ATOMIC_GROUP_TOO_LARGE' });
  assert.deepEqual(rows(), before);
  assert.equal(getEntitySyncState(workspace.store).pendingEntities, pending);
  assert.equal(workspace.store.state.notes.find(item => item.id === note.id).rawMarkdown, rawMarkdown);
  assert.equal(
    workspace.store.state.noteVersions.find(item => item.id === 'oversized-current-version').content,
    rawMarkdown
  );
});
