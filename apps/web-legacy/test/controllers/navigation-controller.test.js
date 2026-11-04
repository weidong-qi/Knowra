import assert from 'node:assert/strict';
import { createNavigationController } from '../../src/controllers/navigation-controller.js';

const state = {
  dataMode: 'local',
  currentSpaceId: 'space-1',
  folderTree: [],
  foldersById: {},
  allNotes: [],
  selectedFolderId: null,
  selectedNoteId: null,
  openFolders: {},
  openNoteTabs: [],
  navSections: {
    materials: true,
    favorites: false,
    recent: false,
    recycle: false
  },
  secondarySections: {
    favorites: true,
    recent: true,
    recycle: true
  },
  search: {
    keyword: '',
    selectedTagIds: [],
    isOpen: false
  },
  treeEditor: null,
  deleteIntent: null,
  sectionMenuOpen: false,
  contextMenu: {
    open: false,
    x: 0,
    y: 0,
    targetKind: null,
    targetId: null
  },
  dragState: {
    activeKind: null,
    activeId: null,
    overKind: null,
    overId: null
  },
  noteTagComposer: { draft: '' },
  draftMarkdown: '',
  saveState: 'idle',
  lastSavedAt: null
};

const elements = {
  folderTree: {
    innerHTML: '',
    querySelector: () => null,
    querySelectorAll: () => []
  },
  secondaryNavToggle: {
    dataset: {},
    getBoundingClientRect: () => ({ right: 200, bottom: 40 })
  },
  contextMenu: {
    hidden: true,
    innerHTML: '',
    style: {}
  },
  sectionMenu: {
    hidden: true,
    innerHTML: '',
    style: {}
  }
};

const calls = [];
const controller = createNavigationController({
  state,
  elements,
  knowledgeApi: {},
  getActiveNotes: () => [],
  getRecycleNotes: () => [],
  getNoteById: () => null,
  noteMatchesSelectedTags: () => true,
  matchesSearch: () => true,
  matchesFolderSearch: () => true,
  renderAll: () => calls.push('renderAll'),
  renderStatus: () => calls.push('renderStatus'),
  refreshKnowledgeData: async () => calls.push('refreshKnowledgeData'),
  loadCurrentNoteSideData: async () => calls.push('loadCurrentNoteSideData'),
  clearNoteSideData: () => calls.push('clearNoteSideData'),
  persistDraft: async () => {
    calls.push('persistDraft');
    return { ok: true, changed: false };
  },
  syncLocalWorkspace: () => calls.push('syncLocalWorkspace'),
  saveCurrentEditorScrollPosition: () => calls.push('saveCurrentEditorScrollPosition'),
  flashStatus: (message) => calls.push(`flash:${message}`),
  escapeHtml: (value) => String(value)
});

assert.equal(typeof controller.renderFolders, 'function');
assert.equal(typeof controller.handleContextMenuAction, 'function');
assert.equal(typeof controller.selectNote, 'function');
assert.equal(typeof controller.createFolder, 'function');
assert.equal(typeof controller.commitDrop, 'function');

controller.renderFolders();
assert.match(elements.folderTree.innerHTML, /library-section/);

console.log('navigation-controller tests passed');
