import assert from 'node:assert/strict';
import { createNavigationNoteCommandController } from '../../src/controllers/navigation/note-command-controller.js';

function createState(dataMode) {
  return {
    dataMode,
    currentSpaceId: 'space-1',
    allNotes: [{
      id: 'note-1',
      title: 'Test note',
      rawMarkdown: '',
      folderId: null,
      favorite: false,
      deleted: false
    }],
    selectedNoteId: 'note-1',
    selectedFolderId: null,
    openNoteTabs: [],
    foldersById: {},
    libraryIndex: {
      selectedNoteId: 'note-1',
      tab: 'all'
    },
    view: { screen: 'editor' },
    noteTagComposer: { draft: '' },
    draftMarkdown: '',
    draftTitle: '',
    saveState: 'saved',
    lastSavedAt: null
  };
}

{
  const state = createState('local');
  const calls = [];
  const controller = createNavigationNoteCommandController({
    state,
    knowledgeApi: {},
    getNoteById: (noteId) => (
      state.allNotes.find((note) => note.id === noteId) ?? null
    ),
    renderAll: () => calls.push('render'),
    refreshKnowledgeData: async () => calls.push('refresh'),
    loadCurrentNoteSideData: async () => calls.push('side-data'),
    syncLocalWorkspace: () => calls.push('local-sync')
  }, () => ({ openFolderBranch() {} }));

  await controller.setNoteFavorite('note-1', true);

  assert.equal(state.allNotes[0].favorite, true);
  assert.deepEqual(calls, ['local-sync']);
}

{
  const state = createState('api');
  const calls = [];
  const controller = createNavigationNoteCommandController({
    state,
    knowledgeApi: {
      setNoteFavorite: async () => calls.push('api-mutation')
    },
    getNoteById: (noteId) => (
      state.allNotes.find((note) => note.id === noteId) ?? null
    ),
    renderAll: () => calls.push('render'),
    refreshKnowledgeData: async () => calls.push('refresh'),
    loadCurrentNoteSideData: async () => calls.push('side-data'),
    syncLocalWorkspace: () => calls.push('local-sync')
  }, () => ({ openFolderBranch() {} }));

  await controller.setNoteFavorite('note-1', true);

  assert.deepEqual(calls, [
    'api-mutation',
    'refresh'
  ]);
}

{
  const state = createState('api');
  state.allNotes[0] = {
    ...state.allNotes[0],
    rawMarkdown: '',
    summary: 'Compact summary',
    contentLoaded: false
  };
  state.view.screen = 'index';
  const calls = [];
  const controllerRef = {};
  let navigationSequence = 0;
  const controller = createNavigationNoteCommandController({
    state,
    knowledgeApi: {
      getNote: async (noteId) => {
        calls.push(`detail:${noteId}`);
        return {
          ...state.allNotes[0],
          rawMarkdown: '# Full body',
          contentLoaded: true
        };
      }
    },
    getNoteById: (noteId) => (
      state.allNotes.find((note) => note.id === noteId) ?? null
    ),
    persistDraft: async () => ({ ok: true, changed: false }),
    renderAll: () => calls.push('render'),
    loadCurrentNoteSideData: async () => calls.push('side-data'),
    saveCurrentEditorScrollPosition: () => calls.push('scroll'),
    flashStatus: (message) => calls.push(`flash:${message}`)
  }, () => controllerRef);
  Object.assign(controllerRef, {
    canLeaveCurrentNote: async () => {
      calls.push('persist');
      return true;
    },
    beginNavigationIntent: () => ++navigationSequence,
    isNavigationIntentCurrent: (intentId) => intentId === navigationSequence,
    openFolderBranch() {}
  });

  await controller.selectNote('note-1');

  assert.equal(state.allNotes[0].rawMarkdown, '# Full body');
  assert.equal(state.allNotes[0].contentLoaded, true);
  assert.equal(state.draftMarkdown, '# Full body');
  assert.equal(state.view.screen, 'editor');
  assert.deepEqual(calls, [
    'persist',
    'detail:note-1',
    'side-data',
    'scroll',
    'render',
    'flash:已切换到：Test note'
  ]);
}

console.log('ok - note commands share mutation flow and lazy-load full note details');

{
  const state = createState('api');
  state.view.screen = 'editor';
  const calls = [];
  const controllerRef = {};
  const controller = createNavigationNoteCommandController({
    state,
    knowledgeApi: {},
    getNoteById: () => null,
    persistDraft: async () => ({ ok: false, changed: true, error: new Error('save failed') }),
    renderAll: () => calls.push('render'),
    loadCurrentNoteSideData: async () => calls.push('side-data'),
    saveCurrentEditorScrollPosition: () => calls.push('scroll'),
    flashStatus: (message) => calls.push(`flash:${message}`)
  }, () => controllerRef);
  Object.assign(controllerRef, {
    canLeaveCurrentNote: async () => false,
    beginNavigationIntent: () => 1,
    isNavigationIntentCurrent: () => true,
    openFolderBranch() {}
  });

  const selected = await controller.selectNote('note-1');

  assert.equal(selected, false);
  assert.equal(state.view.screen, 'editor');
  assert.deepEqual(calls, []);
}

{
  const state = createState('api');
  state.allNotes = [
    {
      id: 'note-a',
      title: 'A',
      rawMarkdown: '',
      folderId: null,
      favorite: false,
      deleted: false,
      contentLoaded: false
    },
    {
      id: 'note-b',
      title: 'B',
      rawMarkdown: '',
      folderId: null,
      favorite: false,
      deleted: false,
      contentLoaded: false
    }
  ];
  state.selectedNoteId = null;
  const pending = new Map();
  const controllerRef = {};
  let navigationSequence = 0;
  const controller = createNavigationNoteCommandController({
    state,
    knowledgeApi: {
      getNote: (noteId) => new Promise((resolve) => pending.set(noteId, resolve))
    },
    getNoteById: () => null,
    renderAll: () => {},
    loadCurrentNoteSideData: async () => {},
    saveCurrentEditorScrollPosition: () => {},
    flashStatus: () => {}
  }, () => controllerRef);
  Object.assign(controllerRef, {
    canLeaveCurrentNote: async () => true,
    beginNavigationIntent: () => ++navigationSequence,
    isNavigationIntentCurrent: (intentId) => intentId === navigationSequence,
    openFolderBranch() {}
  });

  const waitForRequest = async (noteId) => {
    for (let attempt = 0; attempt < 5 && !pending.has(noteId); attempt += 1) {
      await Promise.resolve();
    }
    assert.equal(pending.has(noteId), true);
  };

  const selectA = controller.selectNote('note-a');
  await waitForRequest('note-a');
  const selectB = controller.selectNote('note-b');
  await waitForRequest('note-b');
  pending.get('note-b')({
    ...state.allNotes[1],
    rawMarkdown: '# B',
    contentLoaded: true
  });
  assert.equal(await selectB, true);
  pending.get('note-a')({
    ...state.allNotes[0],
    rawMarkdown: '# A',
    contentLoaded: true
  });
  assert.equal(await selectA, false);

  assert.equal(state.selectedNoteId, 'note-b');
  assert.equal(state.draftMarkdown, '# B');
}

{
  const state = createState('cache');
  const calls = [];
  const controller = createNavigationNoteCommandController({
    state,
    knowledgeApi: {
      setNoteFavorite: async () => calls.push('api')
    },
    getNoteById: () => null,
    renderAll: () => calls.push('render'),
    refreshKnowledgeData: async () => calls.push('refresh'),
    loadCurrentNoteSideData: async () => calls.push('side-data'),
    syncLocalWorkspace: () => calls.push('local-sync'),
    flashStatus: (message) => calls.push(message)
  }, () => ({ openFolderBranch() {} }));

  const result = await controller.setNoteFavorite('note-1', true);

  assert.equal(result, false);
  assert.equal(state.allNotes[0].favorite, false);
  assert.deepEqual(calls, ['当前显示的是只读缓存，请在后端恢复后刷新页面再修改']);
}

{
  const state = createState('api');
  const calls = [];
  const controller = createNavigationNoteCommandController({
    state,
    knowledgeApi: {
      deleteNote: async () => calls.push('delete')
    },
    getNoteById: () => state.allNotes[0],
    refreshKnowledgeData: async () => calls.push('refresh'),
    syncLocalWorkspace: () => calls.push('local-sync'),
    flashStatus: () => {}
  }, () => ({
    canLeaveCurrentNote: async () => false
  }));

  assert.equal(await controller.deleteNote('note-1'), false);
  assert.deepEqual(calls, []);
  assert.equal(state.view.screen, 'editor');
  assert.equal(state.selectedNoteId, 'note-1');
}
