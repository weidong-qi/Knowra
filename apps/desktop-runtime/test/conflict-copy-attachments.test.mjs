import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { once } from 'node:events';
import { test } from 'node:test';
import { calculateContentHash } from '@study-accelerator/content-anchor';
import { attachmentIdsInText } from '@study-accelerator/shared/attachments';
import { createAppContext } from '../../api/src/app.factory.js';
import { createFileDataStore } from '../../api/src/infrastructure/file-data-store.ts';
import { createAttachmentTransfer } from '../../api/src/modules/sync/attachment-transfer.ts';
import { createServer } from '../../api/src/server.js';
import { createSyncEngine } from '../src/sync-engine.mjs';
import { createSqliteDataStore } from '../src/sqlite-data-store.mjs';
import { temporaryDirectory, openWorkspace } from './helpers.mjs';

async function fixture(t) {
  const root = temporaryDirectory(t);
  const cloud = createAppContext({
    dataStore: createFileDataStore(path.join(root, 'cloud.json')),
    uploadsDir: path.join(root, 'uploads'),
    storageRootDir: root
  });
  const knowledge = cloud.modules.knowledge;
  const space = knowledge.knowledgeSpaceService.createDefaultKnowledgeSpace({ userId: 'demo' });
  const note = knowledge.noteService.createNote({ title: '附件冲突', rawMarkdown: '基线', spaceId: space.id });
  const server = createServer({ appContext: cloud, logger: { error() {} } });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  function device(name, options = {}) {
    const directory = path.join(root, name);
    const workspace = openWorkspace(directory, options.storeOptions);
    const context = createAppContext({
      dataStore: workspace.store,
      uploadsDir: path.join(directory, 'uploads'),
      storageRootDir: directory
    });
    const transfer = createAttachmentTransfer({
      uploadsDir: path.join(directory, 'uploads'),
      storageRootDir: directory
    });
    const engine = createSyncEngine(workspace.store, {
      entityTransfer: transfer,
      noteService: options.noteService?.(workspace.knowledge.noteService) ?? workspace.knowledge.noteService,
      autoSync: false,
      fetcher: options.fetcher
    });
    t.after(async () => {
      await engine.close();
      workspace.store.close();
    });
    return {
      ...workspace,
      context,
      transfer,
      engine,
      directory,
      connect: () => engine.configure({ serverUrl: `http://127.0.0.1:${server.address().port}` })
    };
  }
  return { root, cloud, knowledge, space, note, device };
}
const upload = (context, noteId, fileName, content) =>
  context.http.storage.uploadAttachment({ noteId, fileName, contentBase64: Buffer.from(content).toString('base64') });
const url = id => `/api/storage/attachments/${id}/content`;
const clean = device => assert.equal(device.engine.status().error, null, JSON.stringify(device.engine.status()));

async function conflictWithFiles(t, options) {
  const f = await fixture(t);
  const a = f.device('a', options);
  await a.connect();
  clean(a);
  const first = upload(a.context, f.note.id, '一.txt', '本地附件一');
  const second = upload(a.context, f.note.id, '二.txt', '本地附件二');
  const markdown = `本地正文\n[一](${url(first.id)})\n[二](${url(second.id)})`;
  a.knowledge.noteService.updateNote(f.note.id, { rawMarkdown: markdown });
  f.knowledge.noteService.updateNote(f.note.id, { rawMarkdown: '云端正文' });
  await a.engine.sync();
  clean(a);
  const conflict = a.engine.status().entityConflict;
  assert(conflict);
  return { ...f, a, first, second, markdown, conflict };
}

test('保留两篇：本地新增及已有附件独立归属副本，文件可读且两设备再次同步收敛', async t => {
  const f = await fixture(t);
  const existing = upload(f.cloud, f.note.id, '已有.txt', '已有附件');
  const externalNote = f.knowledge.noteService.createNote({
    title: '其他笔记',
    rawMarkdown: '其他正文',
    spaceId: f.space.id
  });
  const external = upload(f.cloud, externalNote.id, '跨笔记.txt', '跨笔记附件');
  f.knowledge.noteService.updateNote(f.note.id, { rawMarkdown: `[已有](${url(existing.id)})` });
  const a = f.device('a');
  await a.connect();
  clean(a);
  const local = upload(a.context, f.note.id, '离线.txt', '本地新增附件');
  const unreferenced = upload(a.context, f.note.id, '未插入.txt', '附件面板中的文件');
  const encodedId = local.id.replace('attachment-', '%61ttachment-');
  const markdown = `本地正文\n[已有](${url(existing.id)})\n![新](${url(local.id)}#preview)\n[重复][文件]\n[文件]: ${url(encodedId)}?download=1\n<a href="${url(local.id)}">HTML</a>\n[跨笔记](${url(external.id)})`;
  a.knowledge.noteService.updateNote(f.note.id, { rawMarkdown: markdown });
  const remoteOnly = upload(f.cloud, f.note.id, '云端.txt', '云端新增附件');
  const remoteMarkdown = `云端正文\n[已有](${url(existing.id)})\n[云端](${url(remoteOnly.id)})`;
  f.knowledge.noteService.updateNote(f.note.id, { rawMarkdown: remoteMarkdown });
  await a.engine.sync();
  clean(a);
  const conflict = a.engine.status().entityConflict;
  assert(conflict);
  await a.engine.resolve({ conflictId: conflict.id, choice: 'copy' });
  const copy = a.store.state.notes.find(note => ![f.note.id, externalNote.id].includes(note.id));
  assert(copy);
  const copies = a.store.state.attachments.filter(item => item.noteId === copy.id);
  assert.equal(copies.length, 4, '副本必须保留当前笔记附件面板中的全部记录，包括未插入正文的附件');
  clean(a);
  const remapped = new Map(
    [existing, local, unreferenced, remoteOnly].map(original => [
      original.id,
      copies.find(item => item.fileName === original.fileName)
    ])
  );
  for (const original of [existing, local, unreferenced, remoteOnly]) {
    const copied = remapped.get(original.id);
    assert.notEqual(copied.id, original.id);
    assert.equal(copied.sha256, original.sha256);
    assert.equal(copied.size, original.size);
    assert.equal(copied.status, 'ready');
    assert(copied.storagePath.includes(copied.id));
    const expected =
      original.id === existing.id
        ? '已有附件'
        : original.id === local.id
          ? '本地新增附件'
          : original.id === unreferenced.id
            ? '附件面板中的文件'
            : '云端新增附件';
    assert.equal(a.context.http.storage.getAttachmentContent({ id: copied.id }).content.toString(), expected);
    assert.equal(f.cloud.http.storage.getAttachmentContent({ id: copied.id }).content.toString(), expected);
  }
  assert.deepEqual(
    attachmentIdsInText(copy.rawMarkdown).sort(),
    [remapped.get(existing.id).id, remapped.get(local.id).id, external.id].sort()
  );
  assert(copy.rawMarkdown.includes(`${url(remapped.get(local.id).id)}?download=1`));
  assert(copy.rawMarkdown.includes(`${url(remapped.get(local.id).id)}#preview`));
  assert.equal(a.knowledge.noteService.getNote(f.note.id).rawMarkdown, remoteMarkdown);
  assert.equal(f.knowledge.noteService.getNote(f.note.id).rawMarkdown, remoteMarkdown);
  assert.equal(a.store.state.attachments.find(item => item.id === existing.id).noteId, f.note.id);
  assert.equal(f.cloud.http.storage.getAttachmentContent({ id: existing.id }).content.toString(), '已有附件');
  assert.equal(copy.contentHash, calculateContentHash(copy.rawMarkdown));
  assert(
    a.store.state.noteVersions.some(
      version =>
        version.noteId === copy.id && version.content === copy.rawMarkdown && version.contentHash === copy.contentHash
    )
  );
  assert.equal(a.engine.status().entityConflict, null);
  assert.equal(a.engine.status().pendingEntities, 0);
  const recovery = a.engine.recovery().find(item => item.kind === 'entity-conflict');
  assert(recovery);
  assert.equal(recovery.local.notes.find(item => item.id === f.note.id).rawMarkdown, markdown);
  assert(recovery.local.attachments.some(item => item.id === local.id));
  assert.equal(a.transfer.read(local).toString(), '本地新增附件');
  const recovered = createSqliteDataStore(path.join(f.root, 'recovered', 'local.sqlite'));
  try {
    recovered.importSnapshot({ ...a.store.exportSnapshot(), data: recovery.local });
    const restoredContext = createAppContext({
      dataStore: recovered,
      uploadsDir: path.join(a.directory, 'uploads'),
      storageRootDir: a.directory
    });
    assert.equal(restoredContext.modules.knowledge.noteService.getNote(f.note.id).rawMarkdown, markdown);
    assert.equal(
      restoredContext.http.storage.getAttachmentContent({ id: local.id }).content.toString(),
      '本地新增附件'
    );
  } finally {
    recovered.close();
  }
  const persisted = createSqliteDataStore(path.join(a.directory, 'local.sqlite'));
  try {
    assert.equal(persisted.state.attachments.filter(item => item.noteId === copy.id).length, 4);
  } finally {
    persisted.close();
  }
  const b = f.device('b');
  await b.connect();
  clean(b);
  assert.equal(b.knowledge.noteService.getNote(copy.id).rawMarkdown, copy.rawMarkdown);
  for (const attachment of copies)
    assert.deepEqual(
      b.context.http.storage.getAttachmentContent({ id: attachment.id }).content,
      a.transfer.read(attachment)
    );
  await a.engine.sync();
  await b.engine.sync();
  clean(a);
  clean(b);
  assert.equal(a.engine.status().pendingEntities, 0);
  assert.equal(b.engine.status().pendingEntities, 0);
  assert.equal(a.store.getStatus().pendingOperations, 0);
});

function persistedState(device) {
  return device.store.readSync((db, state) => ({
    state: structuredClone(state),
    tables: Object.fromEntries(
      ['entities', 'local_revisions', 'metadata', 'sync_base', 'sync_outbox', 'sync_recovery'].map(table => [
        table,
        db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()
      ])
    )
  }));
}
const managedFiles = device =>
  fs
    .readdirSync(path.join(device.directory, 'uploads'), { withFileTypes: true })
    .filter(entry => entry.isFile())
    .map(entry => entry.name)
    .sort();

test('保留两篇失败回滚：缺失、损坏、写文件失败、创建笔记失败及 SQLite 提交失败', async t => {
  for (const failure of ['missing', 'corrupt', 'write', 'note', 'commit'])
    await t.test(failure, async t => {
      let rejectCommit = false;
      let rejectNote = false;
      const f = await conflictWithFiles(t, {
        storeOptions: {
          beforeCommit() {
            if (rejectCommit) throw new Error('模拟 SQLite 提交失败');
          }
        },
        noteService: service => ({
          ...service,
          createNote(input) {
            if (rejectNote) throw new Error('模拟创建笔记失败');
            return service.createNote(input);
          }
        })
      });
      const { a, conflict, first, second } = f;
      if (failure === 'missing') fs.unlinkSync(path.join(a.directory, second.storagePath));
      if (failure === 'corrupt') fs.writeFileSync(path.join(a.directory, second.storagePath), '损坏内容');
      const before = persistedState(a);
      const files = managedFiles(a);
      rejectCommit = failure === 'commit';
      rejectNote = failure === 'note';
      if (failure === 'write') {
        const copy = fs.copyFileSync;
        let copies = 0;
        t.mock.method(fs, 'copyFileSync', (source, destination, flags) => {
          if (++copies === 2) throw Object.assign(new Error('模拟附件磁盘写入失败'), { code: 'ENOSPC' });
          return copy(source, destination, flags);
        });
      }
      const expected = {
        missing: /ENOENT|尚未传输完成/,
        corrupt: /校验失败/,
        write: /磁盘写入失败/,
        note: /创建笔记失败/,
        commit: /SQLite 提交失败/
      }[failure];
      await assert.rejects(a.engine.resolve({ conflictId: conflict.id, choice: 'copy' }), expected);
      assert.deepEqual(persistedState(a), before, '正文、附件、恢复记录、基线和上传队列必须整体回滚');
      assert.deepEqual(managedFiles(a), files, '不得遗留本次复制的文件，也不得删除原文件');
      assert.equal(a.context.http.storage.getAttachmentContent({ id: first.id }).content.toString(), '本地附件一');
      assert.equal(f.knowledge.noteService.getNote(f.note.id).rawMarkdown, '云端正文');
      assert.equal(a.engine.status().entityConflict.id, conflict.id);
      rejectCommit = false;
      rejectNote = false;
      t.mock.restoreAll();
      if (failure === 'missing' || failure === 'corrupt') {
        a.context.http.storage.restoreAttachment(
          { id: second.id },
          { contentBase64: Buffer.from('本地附件二').toString('base64') }
        );
      }
      await a.engine.resolve({ conflictId: conflict.id, choice: 'copy' });
      clean(a);
      assert.equal(a.engine.status().entityConflict, null);
      assert.equal(a.engine.status().pendingEntities, 0);
      const copy = a.store.state.notes.find(note => note.id !== f.note.id);
      assert(copy);
      assert.equal(a.store.state.attachments.filter(item => item.noteId === copy.id).length, 2);
    });
});

test('保留两篇遇到附件元数据缺失时保留冲突与本地内容', async t => {
  const f = await conflictWithFiles(t);
  f.a.knowledge.noteService.updateNote(f.note.id, {
    rawMarkdown: `${f.markdown}\n[缺失](${url('attachment-unknown')})`
  });
  const before = persistedState(f.a);
  const files = managedFiles(f.a);
  await assert.rejects(f.a.engine.resolve({ conflictId: f.conflict.id, choice: 'copy' }), /附件元数据缺失/);
  assert.deepEqual(persistedState(f.a), before);
  assert.deepEqual(managedFiles(f.a), files);
});

test('保留两篇后上传丢响应保持暂停，不再发送且保留副本和附件 ID', async t => {
  let lose = false;
  const operations = [];
  const f = await conflictWithFiles(t, {
    fetcher: async (url, options) => {
      const response = await fetch(url, options);
      if (url.endsWith('/batch')) {
        operations.push(JSON.parse(options.body).operationId);
        if (lose) {
          lose = false;
          throw new Error('模拟上传回执丢失');
        }
      }
      return response;
    }
  });
  lose = true;
  await f.a.engine.resolve({ conflictId: f.conflict.id, choice: 'copy' });
  assert(f.a.engine.status().error);
  assert.equal(f.a.engine.status().entityConflict, null);
  const copy = f.a.store.state.notes.find(note => note.id !== f.note.id);
  assert(copy);
  const ids = f.a.store.state.attachments
    .filter(item => item.noteId === copy.id)
    .map(item => item.id)
    .sort();
  assert.equal(ids.length, 2);
  assert.deepEqual(attachmentIdsInText(copy.rawMarkdown).sort(), ids);
  for (const id of ids) assert(f.a.context.http.storage.getAttachmentContent({ id }).content.length);
  const count = operations.length;
  const frozen = f.a.engine.recovery()[0].upload;
  await f.a.engine.sync();
  assert.equal(f.a.engine.status().error.code, 'SYNC_RESULT_UNCERTAIN');
  assert.equal(operations.length, count);
  assert.deepEqual(f.a.engine.recovery()[0].upload, frozen);
  assert.deepEqual(
    f.a.store.state.attachments
      .filter(item => item.noteId === copy.id)
      .map(item => item.id)
      .sort(),
    ids
  );
  assert(f.a.engine.status().pendingEntities > 0);
  assert.equal(f.cloud.modules.knowledge.noteService.getNote(copy.id).rawMarkdown, copy.rawMarkdown);
  const b = f.device('b');
  await b.connect();
  clean(b);
  for (const id of ids)
    assert.deepEqual(
      b.context.http.storage.getAttachmentContent({ id }).content,
      f.a.context.http.storage.getAttachmentContent({ id }).content
    );
});
