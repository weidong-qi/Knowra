import assert from 'node:assert/strict';
import { createNavigationSelectionCommandController } from '../../src/controllers/navigation/selection-command-controller.js';

function createState() {
  return {
    allNotes: [{
      id: 'note-1',
      title: 'Note',
      folderId: 'folder-1',
      rawMarkdown: '# Note',
      deleted: false
    }],
    foldersById: {
      'folder-1': { id: 'folder-1', name: 'Folder', parentId: null },
      'folder-2': { id: 'folder-2', name: 'Other', parentId: null }
    },
    selectedFolderId: 'folder-1',
    selectedNoteId: 'note-1',
    openNoteTabs: ['note-1'],
    openFolders: {},
    libraryIndex: { selectedNoteId: 'note-1', tab: 'all', page: 1 },
    search: { keyword: '', selectedTagIds: [] },
    view: { screen: 'editor' },
    draftMarkdown: '# Unsaved',
    draftTitle: 'Note'
  };
}

function createHarness(persistResult) {
  const state = createState();
  const calls = [];
  let controller;
  controller = createNavigationSelectionCommandController({
    state,
    renderAll: () => calls.push('render'),
    loadCurrentNoteSideData: async () => calls.push('side'),
    clearNoteSideData: () => calls.push('clear'),
    persistDraft: async () => persistResult,
    flashStatus: (message) => calls.push(message)
  }, () => controller);
  return { controller, state, calls };
}

{
  const { controller, state, calls } = createHarness({
    ok: false,
    changed: true,
    error: new Error('save failed')
  });

  assert.equal(await controller.selectFolder('folder-2'), false);
  assert.equal(state.selectedFolderId, 'folder-1');
  assert.equal(state.selectedNoteId, 'note-1');
  assert.equal(state.view.screen, 'editor');
  assert.deepEqual(calls, []);
}

{
  const { controller, state, calls } = createHarness({ ok: true, changed: true });

  assert.equal(await controller.returnToLibraryIndex({ global: true }), true);
  assert.equal(state.view.screen, 'index');
  assert.equal(state.selectedFolderId, null);
  assert.equal(state.libraryIndex.tab, 'all');
  assert.equal(state.search.keyword, '');
  assert.equal(state.statusMessage, '当前工作域：资料库');
  assert.deepEqual(calls, ['render']);
}

console.log('ok - navigation leave guard preserves context when draft persistence fails');
