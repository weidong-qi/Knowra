import assert from 'node:assert/strict';

import { createSearchController } from '../../src/controllers/search-controller.js';

function createSearchShellElements() {
  const control = { dataset: {} };
  const input = { value: '' };
  const chipTrack = { innerHTML: '' };
  const clearButton = { hidden: true };
  const panelHost = { innerHTML: '<div class="search-panel">stale</div>' };
  const nodes = new Map([
    ['.top-bar-search-control', control],
    ['[data-search-input]', input],
    ['[data-search-chip-track]', chipTrack],
    ['[data-search-clear]', clearButton],
    ['.search-panel-host', panelHost]
  ]);
  const globalSearchShell = {
    dataset: {},
    querySelector(selector) {
      return nodes.get(selector) ?? null;
    }
  };

  return { globalSearchShell, panelHost, chipTrack, clearButton };
}

function createController(search, elements) {
  const state = {
    search,
    tags: [{ id: 'tag-paper', name: '论文' }],
    allNotes: [],
    foldersById: {},
    selectedFolderId: null,
    dataMode: 'local',
    libraryIndex: null,
    currentSpaceId: null
  };

  return createSearchController({
    state,
    elements,
    knowledgeApi: {},
    searchDebounceDelayMs: 0,
    getActiveNotes: () => [],
    flashStatus: () => {},
    reconcileSelection: () => {},
    renderAll: () => {}
  });
}

const elements = createSearchShellElements();
const controller = createController({
  keyword: '知识点',
  selectedTagIds: ['tag-paper'],
  matchingNoteIds: null,
  isOpen: false
}, elements);

controller.renderSearchShell();

assert.equal(elements.globalSearchShell.dataset.open, 'false');
assert.equal(elements.panelHost.innerHTML, '', 'closed search must not leave a panel over the active workspace');
assert.match(elements.chipTrack.innerHTML, /论文/);
assert.equal(elements.clearButton.hidden, false, 'retained filters should still expose the clear action');

console.log('ok - closed search keeps chips but removes the dropdown panel');
