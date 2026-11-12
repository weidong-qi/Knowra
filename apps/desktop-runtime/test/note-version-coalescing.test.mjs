import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';
import { createSqliteDataStore } from '../src/sqlite-data-store.mjs';
import { createAppContext } from '../../api/src/app.factory.ts';
import { createNoteVersionDiscardGate } from '../src/note-version-discard-gate.mjs';
import { temporaryDirectory } from './helpers.mjs';

function workspace(t) {
  const root = temporaryDirectory(t);
  const store = createSqliteDataStore(path.join(root, 'local.sqlite'));
  t.after(() => store.close());
  const context = createAppContext({
    dataStore: store,
    uploadsDir: path.join(root, 'uploads'),
    storageRootDir: root,
    ownerId: 'demo',
    noteVersionCoalescing: { canDiscard: createNoteVersionDiscardGate(store) }
  });
  const knowledge = context.modules.knowledge;
  const space = knowledge.knowledgeSpaceService.createDefaultKnowledgeSpace({ userId: 'demo' });
  const note = knowledge.noteService.createNote({ title: '长时间编辑', rawMarkdown: 'v0', spaceId: space.id });
  const start = Date.parse(note.updatedAt);
  const edit = index =>
    knowledge.noteService.updateNote(note.id, {
      rawMarkdown: `v${index}`,
      updatedAt: new Date(start + index * 1000).toISOString()
    });
  const contents = () =>
    store.state.noteVersions
      .filter(item => item.noteId === note.id)
      .map(item => item.content)
      .sort();
  return { store, edit, contents, note, knowledge, root };
}

test('本机未同步的连续自动保存合并为基线与最新版本', t => {
  const w = workspace(t);
  for (let index = 1; index <= 6; index++) w.edit(index);
  assert.deepEqual(w.contents(), ['v0', 'v6']);
});

test('已进入同步基线的版本不会被合并删除', t => {
  const w = workspace(t);
  w.edit(1);
  const synced = w.store.state.noteVersions.find(item => item.content === 'v1');
  w.store.metadataTransaction(db =>
    db.prepare('INSERT INTO sync_base VALUES (?, ?, ?, ?)').run('noteVersions', synced.id, 1, JSON.stringify(synced))
  );
  w.edit(2);
  w.edit(3);
  assert.deepEqual(w.contents(), ['v0', 'v1', 'v3']);
});

test('同步上传已冻结时保留版本', t => {
  const w = workspace(t);
  w.edit(1);
  w.store.metadataTransaction(db =>
    db
      .prepare("INSERT INTO metadata VALUES ('sync:entityUpload', ?)")
      .run(JSON.stringify({ operationId: 'op', changes: [] }))
  );
  w.edit(2);
  w.edit(3);
  assert.deepEqual(w.contents(), ['v0', 'v1', 'v2', 'v3']);
});

test('被 AI 私有记录引用的版本不会被合并删除', t => {
  const w = workspace(t);
  w.edit(1);
  const cited = w.store.state.noteVersions.find(item => item.content === 'v1');
  w.store.metadataTransaction(db => db.exec(`CREATE TABLE IF NOT EXISTS ai_citation_probe (payload TEXT)`));
  w.store.metadataTransaction(db =>
    db.prepare('INSERT INTO ai_citation_probe VALUES (?)').run(JSON.stringify({ noteVersionId: cited.id }))
  );
  w.edit(2);
  w.edit(3);
  assert.deepEqual(w.contents(), ['v0', 'v1', 'v3']);
});

test('恢复旧正文后跨分支编辑不合并恢复前检查点，重启仍保留', t => {
  const root = temporaryDirectory(t),
    file = path.join(root, 'local.sqlite');
  let store = createSqliteDataStore(file);
  t.after(() => store.close());
  const context = () =>
    createAppContext({
      dataStore: store,
      storageRootDir: root,
      noteVersionCoalescing: { canDiscard: createNoteVersionDiscardGate(store) }
    }).modules.knowledge;
  let knowledge = context();
  const space = knowledge.knowledgeSpaceService.createDefaultKnowledgeSpace({ userId: 'demo' });
  const note = knowledge.noteService.createNote({ spaceId: space.id, title: '恢复检查点', rawMarkdown: 'v0' });
  const start = Date.parse(note.updatedAt);
  const edit = (content, seconds) =>
    knowledge.noteService.updateNote(note.id, {
      rawMarkdown: content,
      updatedAt: new Date(start + seconds * 1000).toISOString()
    });
  edit('v1', 1);
  const beforeRestore = store.state.noteVersions.find(item => item.content === 'v1');
  edit('v0', 2);
  store.close();
  store = createSqliteDataStore(file);
  knowledge = context();
  for (let i = 3; i <= 5; i++) edit(`v${i}`, i);
  assert.ok(
    store.state.noteVersions.some(item => item.id === beforeRestore.id),
    '恢复前 v1 保持稳定 ID'
  );
  assert.deepEqual(store.state.noteVersions.map(item => item.content).sort(), ['v0', 'v1', 'v5']);
});
