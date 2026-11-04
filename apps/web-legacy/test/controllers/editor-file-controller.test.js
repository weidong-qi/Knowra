import assert from 'node:assert/strict';
import { createEditorFileController } from '../../src/controllers/editor/file-controller.js';

const calls = {
  closed: 0,
  created: [],
  deleted: [],
  flashed: []
};

const controller = createEditorFileController({
  state: {
    selectedFolderId: null,
    foldersById: {},
    folderTree: [],
    allNotes: [],
    dataMode: 'local'
  },
  elements: {},
  getCurrentNote: () => ({ id: 'note-1', title: 'Untitled Note', deleted: false, favorite: false }),
  createNote: async (...args) => {
    calls.created.push(args);
    return true;
  },
  startTreeEditor: () => {},
  setNoteFavorite: async () => {},
  deleteNote: async (...args) => { calls.deleted.push(args); },
  restoreNote: async () => {},
  flashStatus: (message) => { calls.flashed.push(message); }
}, () => ({
  closeEditorMenuBar() { calls.closed += 1; },
  persistDraft: async () => ({ ok: true, changed: false })
}));

await controller.handleFileMenuAction('new-note');

assert.equal(calls.closed, 1);
assert.deepEqual(calls.created, [[null, 'Untitled Note']]);
assert.deepEqual(calls.flashed, ['已创建笔记：Untitled Note']);

await controller.handleFileMenuAction('delete-note');

assert.deepEqual(calls.deleted, [['note-1']]);
assert.deepEqual(calls.flashed, ['已创建笔记：Untitled Note', '笔记已删除']);

console.log('ok - editor file menu delegates new notes to navigation');
