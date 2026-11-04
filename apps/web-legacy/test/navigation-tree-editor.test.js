import assert from 'node:assert/strict';
import { validateTreeEditorName } from '../lib/navigation/tree-editor.js';

function runTest(name, callback) {
  try {
    callback();
    console.log(`ok - ${name}`);
  } catch (error) {
    console.error(`not ok - ${name}`);
    throw error;
  }
}

const folderTree = [
  { id: 'folder-a', name: 'Alpha', parentId: null },
  { id: 'folder-b', name: 'Beta', parentId: null }
];

const foldersById = {
  'folder-a': { id: 'folder-a', name: 'Alpha', parentId: null, children: [] },
  'folder-b': {
    id: 'folder-b',
    name: 'Beta',
    parentId: null,
    children: [{ id: 'folder-c', name: 'Child', parentId: 'folder-b' }]
  },
  'folder-c': { id: 'folder-c', name: 'Child', parentId: 'folder-b', children: [] }
};

const notes = [
  { id: 'note-a', title: 'Root Note', folderId: null },
  { id: 'note-b', title: 'Child Note', folderId: 'folder-b' }
];

runTest('validateTreeEditorName checks root create collisions', () => {
  assert.throws(() => validateTreeEditorName({
    editor: { mode: 'create-folder', parentId: null },
    candidateName: 'Root Note',
    foldersById,
    folderTree,
    notes
  }), /same name already exists/);
});

runTest('validateTreeEditorName checks child create collisions', () => {
  assert.throws(() => validateTreeEditorName({
    editor: { mode: 'create-note', parentId: 'folder-b' },
    candidateName: 'Child',
    foldersById,
    folderTree,
    notes
  }), /same name already exists/);
});

runTest('validateTreeEditorName ignores current folder when renaming', () => {
  assert.doesNotThrow(() => validateTreeEditorName({
    editor: { mode: 'rename-folder', targetId: 'folder-c' },
    candidateName: 'Child',
    foldersById,
    folderTree,
    notes
  }));
});

runTest('validateTreeEditorName ignores current note when renaming', () => {
  assert.doesNotThrow(() => validateTreeEditorName({
    editor: { mode: 'rename-note', targetId: 'note-b' },
    candidateName: 'Child Note',
    foldersById,
    folderTree,
    notes
  }));
});
