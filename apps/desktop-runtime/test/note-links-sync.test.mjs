import assert from 'node:assert/strict';
import path from 'node:path';
import { once } from 'node:events';
import { test } from 'node:test';
import { createAppContext } from '../../api/src/app.factory.ts';
import { createFileDataStore } from '../../api/src/infrastructure/file-data-store.ts';
import { createServer } from '../../api/src/server.ts';
import { prepareBatchState } from '../../api/src/modules/sync/batch-domain.ts';
import { createAttachmentTransfer } from '../../api/src/modules/sync/attachment-transfer.ts';
import { createNoteLinkUrl } from '@study-accelerator/content-anchor';
import { createSyncEngine } from '../src/sync-engine.mjs';
import { temporaryDirectory, openWorkspace } from './helpers.mjs';

test('真实SQLite离线引用重启、双端同步、改名移动删除恢复及逐处关系重建', async t => {
  const root = temporaryDirectory(t),
    store = createFileDataStore(path.join(root, 'cloud.json'));
  const cloud = createAppContext({ dataStore: store, uploadsDir: path.join(root, 'uploads'), storageRootDir: root });
  const k = cloud.http.knowledge,
    space = k.createDefaultKnowledgeSpace();
  const target = k.createNote({
    id: 'sync-link-target',
    spaceId: space.id,
    title: '同步目标',
    rawMarkdown: '目标正文'
  });
  const folder = k.createFolder({ spaceId: space.id, name: '目标新目录' });
  const server = createServer({ appContext: cloud, logger: { error() {} } });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const opened = [];
  function device(name) {
    const dir = path.join(root, name),
      local = openWorkspace(dir);
    const engine = createSyncEngine(local.store, {
      autoSync: false,
      noteService: local.knowledge.noteService,
      entityTransfer: createAttachmentTransfer({ uploadsDir: path.join(dir, 'uploads'), storageRootDir: dir })
    });
    const result = { ...local, engine, closed: false };
    opened.push(result);
    return result;
  }
  t.after(async () => {
    for (const local of opened)
      if (!local.closed) {
        await local.engine.close();
        local.store.close();
      }
  });
  let a = device('a'),
    b = device('b');
  await a.engine.configure({ serverUrl: origin });
  await b.engine.configure({ serverUrl: origin });
  const first = createNoteLinkUrl(target.id, 'ref-first'),
    second = createNoteLinkUrl(target.id, 'ref-second');
  const source = a.knowledge.noteService.createNote({
    id: 'sync-link-source',
    spaceId: space.id,
    title: '同步来源',
    rawMarkdown: `[原名](${first}) 第一处\n\n[原名](${second}) 第二处`
  });
  await a.engine.close();
  a.store.close();
  a.closed = true;
  a = device('a');
  assert.equal(a.knowledge.noteService.getNoteLinkRelations(target.id).backlinks[0].occurrences.length, 2);
  k.updateNote({ id: target.id }, { title: '目标改名', folderId: folder.id });
  await a.engine.configure({ serverUrl: origin });
  await b.engine.sync();
  for (const local of [a, b]) {
    assert.equal(local.engine.status().error, null, JSON.stringify(local.engine.status()));
    const outgoing = local.knowledge.noteService.getNoteLinkRelations(source.id).outgoing[0];
    assert.equal(outgoing.id, target.id);
    assert.equal(outgoing.title, '目标改名');
    assert.equal(outgoing.folderId, folder.id);
    assert.equal(outgoing.occurrences.length, 2);
  }
  k.deleteNote({ id: target.id });
  await a.engine.sync();
  await b.engine.sync();
  assert.equal(b.knowledge.noteService.getNoteLinkRelations(source.id).outgoing[0].status, 'deleted');
  k.restoreNote({ id: target.id });
  await a.engine.sync();
  await b.engine.sync();
  assert.equal(b.knowledge.noteService.getNoteLinkRelations(source.id).outgoing[0].status, 'active');
  b.knowledge.noteService.updateNote(source.id, { rawMarkdown: `新增段落\n\n[修改文字](${second}) 更新片段` });
  await b.engine.sync();
  await a.engine.sync();
  const relation = a.knowledge.noteService.getNoteLinkRelations(target.id).backlinks[0];
  assert.equal(relation.occurrences.length, 1);
  assert.match(relation.occurrences[0].context, /更新片段/);
  b.knowledge.noteService.updateNote(source.id, { rawMarkdown: source.rawMarkdown }); // 版本恢复正文同一同步路径
  await b.engine.sync();
  await a.engine.sync();
  assert.equal(a.knowledge.noteService.getNoteLinkRelations(target.id).backlinks[0].occurrences.length, 2);
  const other = k.createKnowledgeSpace({ name: '同步其他空间' });
  const foreign = k.createNote({
    id: 'sync-foreign-link-target',
    spaceId: other.id,
    title: '其他空间目标',
    rawMarkdown: ''
  });
  const value = {
    ...k.getNote({ id: source.id }),
    rawMarkdown: `[越界](${createNoteLinkUrl(foreign.id, 'ref-cross')})`
  };
  assert.throws(() => prepareBatchState(store.state, [{ collection: 'notes', id: source.id, value }], 'demo'), {
    code: 'NOTE_LINK_TARGET_INVALID'
  });
  assert.equal(k.getNoteLinkRelations({ id: target.id }).backlinks[0].occurrences.length, 2);
});
