import assert from 'node:assert/strict';
import { createAppStateActions } from '../../src/app/app-state-actions.js';
import { createInitialAppState } from '../../src/app/app-state.js';

function createState(overrides = {}) {
  return {
    ...createInitialAppState(),
    foldersById: {
      'folder-1': { id: 'folder-1' }
    },
    folderTree: [{ id: 'folder-1', children: [] }],
    allNotes: [
      { id: 'note-1', title: 'Active', folderId: 'folder-1', deleted: false, updatedAt: '2026-06-27T10:00:00Z' },
      { id: 'note-2', title: 'Deleted newer', folderId: null, deleted: true, updatedAt: '2026-06-27T11:00:00Z' },
      { id: 'note-3', title: 'Deleted older', folderId: null, deleted: true, updatedAt: '2026-06-26T11:00:00Z' }
    ],
    selectedFolderId: 'missing-folder',
    selectedNoteId: 'missing-note',
    openNoteTabs: ['missing-note'],
    noteTagComposer: {
      draft: 'draft',
      isExpanded: false
    },
    ...overrides
  };
}

function createActions(state = createState()) {
  const calls = [];
  const actions = createAppStateActions({
    state,
    getVisibleNotes: () => state.allNotes.filter((note) => !note.deleted),
    clearNoteSideData: () => calls.push('clearNoteSideData'),
    loadLocalNoteSideData: (noteId) => calls.push(['loadLocalNoteSideData', noteId]),
    persistBackendCache: () => calls.push('persistBackendCache'),
    renderAll: () => calls.push('renderAll'),
    renderStatus: () => calls.push('renderStatus')
  });

  return { actions, calls, state };
}

const { actions, calls, state } = createActions();

actions.reconcileSelection();
assert.equal(state.selectedFolderId, null);
assert.equal(state.selectedNoteId, 'note-1');
assert.deepEqual(state.openNoteTabs, ['note-1']);

assert.equal(actions.getCurrentNote().id, 'note-1');
assert.equal(actions.getNoteById('note-1').title, 'Active');
assert.equal(actions.getNoteById(null), null);
assert.deepEqual(actions.getActiveNotes().map((note) => note.id), ['note-1']);
assert.deepEqual(actions.getRecycleNotes().map((note) => note.id), ['note-2', 'note-3']);

actions.syncLocalWorkspace();
assert.ok(state.foldersById['folder-1']);
assert.deepEqual(calls.at(-2), ['loadLocalNoteSideData', 'note-1']);
assert.equal(calls.at(-1), 'renderAll');

actions.replaceNoteInState({ id: 'note-1', title: 'Updated' });
assert.equal(actions.getNoteById('note-1').title, 'Updated');
assert.ok(calls.includes('persistBackendCache'));

actions.flashStatus('Ready');
assert.equal(state.statusMessage, 'Ready');
assert.equal(calls.at(-1), 'renderStatus');

console.log('app-state-actions tests passed');
