import assert from 'node:assert/strict';
import { createTabController } from '../../src/controllers/tab-controller.js';

function createState(overrides = {}) {
  return {
    allNotes: [
      {
        id: 'note-a',
        title: 'Alpha',
        folderId: 'folder-a',
        rawMarkdown: '# Alpha',
        updatedAt: '2026-06-27T00:00:00.000Z'
      },
      {
        id: 'note-b',
        title: 'Beta',
        folderId: null,
        rawMarkdown: '# Beta',
        updatedAt: '2026-06-27T00:00:00.000Z'
      }
    ],
    foldersById: {
      'folder-a': { id: 'folder-a', name: 'Folder A', parentId: null }
    },
    openNoteTabs: ['note-a', 'note-b'],
    selectedNoteId: 'note-a',
    saveState: 'saved',
    tabMenu: { open: false, x: 0, y: 0, noteId: null },
    tabOverflowMenuOpen: false,
    tabDragState: { activeId: null, overId: null },
    draftMarkdown: '# Alpha',
    draftTitle: 'Alpha',
    linkedNotes: ['linked'],
    attachments: ['attachment'],
    ...overrides
  };
}

function createElements() {
  const tabNodes = [
    { dataset: { tabNoteId: 'note-a' } },
    { dataset: { tabNoteId: 'note-b' } }
  ];
  return {
    noteTabs: {
      innerHTML: '',
      querySelectorAll(selector) {
        return selector === '[data-tab-note-id]' ? tabNodes : [];
      }
    },
    noteTabMenu: {
      hidden: true,
      innerHTML: '',
      style: {}
    },
    noteTabOverflowMenu: {
      hidden: true,
      innerHTML: ''
    },
    tabNodes
  };
}

function createDeps({ state = createState(), elements = createElements(), overrides = {} } = {}) {
  const calls = {
    closeContextMenu: 0,
    closeSectionMenu: 0,
    flashStatus: [],
    persistBackendCache: 0,
    canLeaveCurrentNote: 0,
    renderAll: 0,
    selectNote: []
  };
  const controller = createTabController({
    state,
    elements,
    closeContextMenu: () => { calls.closeContextMenu += 1; },
    closeSectionMenu: () => { calls.closeSectionMenu += 1; },
    flashStatus: (message) => { calls.flashStatus.push(message); },
    persistBackendCache: () => { calls.persistBackendCache += 1; },
    canLeaveCurrentNote: async () => {
      calls.canLeaveCurrentNote += 1;
      return true;
    },
    renderAll: () => { calls.renderAll += 1; },
    selectNote: async (...args) => { calls.selectNote.push(args); },
    ...overrides
  });
  return { controller, state, elements, calls };
}

function runTest(name, callback) {
  try {
    const result = callback();
    if (result && typeof result.then === 'function') {
      return result.then(() => console.log(`ok - ${name}`));
    }
    console.log(`ok - ${name}`);
    return undefined;
  } catch (error) {
    console.error(`not ok - ${name}`);
    throw error;
  }
}

await runTest('renderTabs renders open notes and persists backend cache', () => {
  const { controller, elements, calls } = createDeps();

  controller.renderTabs();

  assert.match(elements.noteTabs.innerHTML, /Alpha/);
  assert.match(elements.noteTabs.innerHTML, /Beta/);
  assert.equal(calls.persistBackendCache, 1);
});

await runTest('openTabMenu closes other menus and renders menu position', () => {
  const { controller, state, elements, calls } = createDeps();

  controller.openTabMenu({ x: 12, y: 34, noteId: 'note-a' });

  assert.equal(calls.closeContextMenu, 1);
  assert.equal(calls.closeSectionMenu, 1);
  assert.deepEqual(state.tabMenu, { open: true, x: 12, y: 34, noteId: 'note-a' });
  assert.equal(elements.noteTabMenu.hidden, false);
  assert.equal(elements.noteTabMenu.style.left, '12px');
  assert.equal(elements.noteTabMenu.style.top, '34px');
});

await runTest('handleTabMenuAction close-others selects target note when needed', async () => {
  const state = createState({
    selectedNoteId: 'note-b',
    tabMenu: { open: true, x: 0, y: 0, noteId: 'note-a' }
  });
  const { controller, calls } = createDeps({ state });

  await controller.handleTabMenuAction('close-others');

  assert.deepEqual(state.openNoteTabs, ['note-a']);
  assert.deepEqual(calls.selectNote, [['note-a', { syncFolder: true, ensureTab: true }]]);
});

await runTest('handleTabClose clears editor state when closing last active tab', async () => {
  const state = createState({
    openNoteTabs: ['note-a'],
    selectedNoteId: 'note-a'
  });
  const { controller, calls } = createDeps({ state });

  await controller.handleTabClose('note-a');

  assert.deepEqual(state.openNoteTabs, []);
  assert.equal(state.selectedNoteId, null);
  assert.equal(state.draftMarkdown, '');
  assert.equal(state.draftTitle, '');
  assert.deepEqual(state.linkedNotes, []);
  assert.deepEqual(state.attachments, []);
  assert.equal(calls.canLeaveCurrentNote, 1);
  assert.equal(calls.renderAll, 1);
});

await runTest('handleTabClose keeps the active tab when draft persistence fails', async () => {
  const state = createState({
    openNoteTabs: ['note-a'],
    selectedNoteId: 'note-a'
  });
  const { controller, calls } = createDeps({
    state,
    overrides: {
      canLeaveCurrentNote: async () => false
    }
  });

  assert.equal(await controller.handleTabClose('note-a'), false);
  assert.deepEqual(state.openNoteTabs, ['note-a']);
  assert.equal(state.selectedNoteId, 'note-a');
  assert.equal(calls.renderAll, 0);
});

await runTest('resetTabDragState can sync indicators without rerender', () => {
  const state = createState({
    tabDragState: { activeId: 'note-a', overId: 'note-b' }
  });
  const { controller, elements } = createDeps({ state });

  controller.resetTabDragState({ rerender: false });

  assert.deepEqual(state.tabDragState, { activeId: null, overId: null });
  assert.equal(elements.tabNodes[0].dataset.dragging, 'false');
  assert.equal(elements.tabNodes[1].dataset.dropTarget, 'false');
});

await runTest('handleTabMenuAction copy-path falls back to legacy copy when async clipboard is unavailable', async () => {
  const originalDocumentDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const originalNavigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    writable: true,
    value: {}
  });
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    writable: true,
    value: {
    activeElement: { focus() {} },
    body: {
      appendChild() {}
    },
    createElement() {
      return {
        value: '',
        style: {},
        setAttribute() {},
        focus() {},
        select() {},
        setSelectionRange() {},
        remove() {}
      };
    },
    execCommand(command) {
      return command === 'copy';
    }
    }
  });

  try {
    const state = createState({
      tabMenu: { open: true, x: 0, y: 0, noteId: 'note-a' }
    });
    const { controller, calls } = createDeps({ state });

    await controller.handleTabMenuAction('copy-path');

    assert.deepEqual(calls.flashStatus, ['已复制笔记路径']);
  } finally {
    if (!originalDocumentDescriptor) {
      delete globalThis.document;
    } else {
      Object.defineProperty(globalThis, 'document', originalDocumentDescriptor);
    }

    if (!originalNavigatorDescriptor) {
      delete globalThis.navigator;
    } else {
      Object.defineProperty(globalThis, 'navigator', originalNavigatorDescriptor);
    }
  }
});

console.log('tab-controller tests passed');
