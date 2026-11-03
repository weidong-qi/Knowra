import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { bindSearchEvents } from '../../lib/events/search-events.js';
import { createRecorderElement } from '../_support/recorder-elements.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ─── 源模式断言（compile-time contract）──────────────────────────

const binderSource = fs.readFileSync(
  path.resolve(__dirname, '../../lib/events/search-events.js'),
  'utf8'
);

assert.match(
  binderSource,
  /export function bindSearchEvents/,
  'search-events.js should export bindSearchEvents'
);
assert.match(
  binderSource,
  /globalSearchShell\?\.addEventListener\('click'/,
  'search binder should listen to globalSearchShell click'
);
assert.match(
  binderSource,
  /globalSearchShell\?\.addEventListener\('input'/,
  'search binder should listen to globalSearchShell input'
);
assert.match(
  binderSource,
  /globalSearchShell\?\.addEventListener\('keydown'/,
  'search binder should listen to globalSearchShell keydown'
);
assert.match(
  binderSource,
  /secondaryNavToggle\?\.addEventListener\('click'/,
  'search binder should listen to secondaryNavToggle click'
);
assert.match(
  binderSource,
  /markdownImportInput\?\.addEventListener\('change'/,
  'search binder should listen to markdownImportInput change'
);

// ─── Handler-recorder 断言（behavioral）──────────────────────────

function runTest(name, callback) {
  try {
    callback();
    console.log(`ok - ${name}`);
  } catch (error) {
    console.error(`not ok - ${name}`);
    throw error;
  }
}

function makeClosest(map) {
  return (selector) => {
    for (const [key, value] of map.entries()) {
      if (selector === key) return value;
    }
    return null;
  };
}

function makeState() {
  return {
    search: { keyword: '', selectedTagIds: [], isOpen: false },
    sectionMenuOpen: false
  };
}

function makeDeps() {
  return {
    toggleSearchTagFilter: () => {},
    focusSearchInput: () => {},
    renderSearchShell: () => {},
    clearSearchFilters: () => {},
    getSearchResultNotes: () => [],
    selectNote: async () => {},
    closeContextMenu: () => {},
    renderFolders: () => {},
    reconcileSelection: () => {},
    renderAll: () => {},
    importMarkdownFiles: async () => {},
    flashStatus: () => {}
  };
}

runTest('shell click on chip remove toggles tag and re-focuses input', () => {
  const elements = {
    globalSearchShell: createRecorderElement(),
    secondaryNavToggle: createRecorderElement(),
    markdownImportInput: createRecorderElement()
  };
  const state = makeState();
  let toggled = null;
  let focused = 0;
  const deps = makeDeps();
  deps.toggleSearchTagFilter = (id) => { toggled = id; };
  deps.focusSearchInput = () => { focused += 1; };

  bindSearchEvents({ state, elements, deps });

  const target = { dataset: {} };
  target.closest = makeClosest(new Map([
    ['[data-search-chip-remove]', { dataset: { searchChipRemove: 'tag-7' } }]
  ]));

  elements.globalSearchShell.dispatch('click', target);

  assert.equal(toggled, 'tag-7');
  assert.equal(focused, 1);
});

runTest('shell click on note result closes shell and selects note', () => {
  const elements = {
    globalSearchShell: createRecorderElement(),
    secondaryNavToggle: createRecorderElement(),
    markdownImportInput: createRecorderElement()
  };
  const state = makeState();
  state.search.isOpen = true;
  let selectedId = null;
  const deps = makeDeps();
  deps.selectNote = async (id) => { selectedId = id; };

  bindSearchEvents({ state, elements, deps });

  const target = { dataset: {} };
  target.closest = makeClosest(new Map([
    ['[data-search-note-id]', { dataset: { searchNoteId: 'note-42' } }]
  ]));

  elements.globalSearchShell.dispatch('click', target);

  assert.equal(state.search.isOpen, false);
  assert.equal(selectedId, 'note-42');
});

runTest('shell click on note result also works from a text-node-like target', () => {
  const elements = {
    globalSearchShell: createRecorderElement(),
    secondaryNavToggle: createRecorderElement(),
    markdownImportInput: createRecorderElement()
  };
  const state = makeState();
  let selectedId = null;
  const deps = makeDeps();
  deps.selectNote = async (id) => { selectedId = id; };

  bindSearchEvents({ state, elements, deps });

  const noteButton = { dataset: { searchNoteId: 'note-text' } };
  noteButton.closest = makeClosest(new Map([
    ['[data-search-note-id]', noteButton]
  ]));

  elements.globalSearchShell.dispatch('click', { parentElement: noteButton });

  assert.equal(selectedId, 'note-text');
});

runTest('shell input updates keyword and re-renders', () => {
  const elements = {
    globalSearchShell: createRecorderElement(),
    secondaryNavToggle: createRecorderElement(),
    markdownImportInput: createRecorderElement()
  };
  const state = makeState();
  let reconciled = 0;
  let renderedAll = 0;
  const deps = makeDeps();
  deps.reconcileSelection = () => { reconciled += 1; };
  deps.renderAll = () => { renderedAll += 1; };

  bindSearchEvents({ state, elements, deps });

  const input = { value: '  Hello World  ' };
  const target = { dataset: {} };
  target.closest = makeClosest(new Map([['[data-search-input]', input]]));

  elements.globalSearchShell.dispatch('input', target);

  assert.equal(state.search.keyword, 'hello world');
  assert.equal(state.search.isOpen, true);
  assert.equal(reconciled, 1);
  assert.equal(renderedAll, 1);
});

runTest('shell keydown Escape closes shell and re-renders search shell only', () => {
  const elements = {
    globalSearchShell: createRecorderElement(),
    secondaryNavToggle: createRecorderElement(),
    markdownImportInput: createRecorderElement()
  };
  const state = makeState();
  state.search.isOpen = true;
  let rendered = 0;
  const deps = makeDeps();
  deps.renderSearchShell = () => { rendered += 1; };

  bindSearchEvents({ state, elements, deps });

  const input = { value: '' };
  const target = { dataset: {} };
  target.closest = makeClosest(new Map([['[data-search-input]', input]]));

  let prevented = false;
  elements.globalSearchShell.listeners.get('keydown')({
    target,
    key: 'Escape',
    preventDefault: () => { prevented = true; }
  });

  assert.equal(prevented, true);
  assert.equal(state.search.isOpen, false);
  assert.equal(rendered, 1);
});

runTest('shell keydown Enter with results selects first result', () => {
  const elements = {
    globalSearchShell: createRecorderElement(),
    secondaryNavToggle: createRecorderElement(),
    markdownImportInput: createRecorderElement()
  };
  const state = makeState();
  let selectedId = null;
  const deps = makeDeps();
  deps.getSearchResultNotes = () => [{ id: 'note-9' }];
  deps.selectNote = async (id) => { selectedId = id; };

  bindSearchEvents({ state, elements, deps });

  const input = { value: 'match' };
  const target = { dataset: {} };
  target.closest = makeClosest(new Map([['[data-search-input]', input]]));

  let prevented = false;
  elements.globalSearchShell.listeners.get('keydown')({
    target,
    key: 'Enter',
    preventDefault: () => { prevented = true; }
  });

  assert.equal(prevented, true);
  assert.equal(state.search.isOpen, false);
  assert.equal(selectedId, 'note-9');
});

runTest('shell keydown Enter without results is a no-op', () => {
  const elements = {
    globalSearchShell: createRecorderElement(),
    secondaryNavToggle: createRecorderElement(),
    markdownImportInput: createRecorderElement()
  };
  const state = makeState();
  let selectedId = null;
  const deps = makeDeps();
  deps.getSearchResultNotes = () => [];
  deps.selectNote = async (id) => { selectedId = id; };

  bindSearchEvents({ state, elements, deps });

  const input = { value: 'no-match' };
  const target = { dataset: {} };
  target.closest = makeClosest(new Map([['[data-search-input]', input]]));

  let prevented = false;
  elements.globalSearchShell.listeners.get('keydown')({
    target,
    key: 'Enter',
    preventDefault: () => { prevented = true; }
  });

  assert.equal(prevented, false);
  assert.equal(selectedId, null);
});

runTest('shell keydown Enter is ignored during IME composition', () => {
  const elements = {
    globalSearchShell: createRecorderElement(),
    secondaryNavToggle: createRecorderElement(),
    markdownImportInput: createRecorderElement()
  };
  const state = makeState();
  let selectedId = null;
  const deps = makeDeps();
  deps.getSearchResultNotes = () => [{ id: 'note-ime' }];
  deps.selectNote = async (id) => { selectedId = id; };

  bindSearchEvents({ state, elements, deps });

  const input = { value: 'zhong' };
  const target = { dataset: {} };
  target.closest = makeClosest(new Map([['[data-search-input]', input]]));

  let prevented = false;
  elements.globalSearchShell.listeners.get('keydown')({
    target,
    key: 'Enter',
    isComposing: true,
    preventDefault: () => { prevented = true; }
  });

  assert.equal(prevented, false);
  assert.equal(selectedId, null);
});

runTest('secondary nav toggle flips sectionMenuOpen and closes context menu', () => {
  const elements = {
    globalSearchShell: createRecorderElement(),
    secondaryNavToggle: createRecorderElement(),
    markdownImportInput: createRecorderElement()
  };
  const state = makeState();
  let closedMenu = 0;
  let renderedFolders = 0;
  const deps = makeDeps();
  deps.closeContextMenu = () => { closedMenu += 1; };
  deps.renderFolders = () => { renderedFolders += 1; };

  bindSearchEvents({ state, elements, deps });

  const target = { dataset: {} };
  let stopped = false;
  elements.secondaryNavToggle.listeners.get('click')({
    target,
    stopPropagation: () => { stopped = true; }
  });

  assert.equal(stopped, true);
  assert.equal(state.sectionMenuOpen, true);
  assert.equal(closedMenu, 1);
  assert.equal(renderedFolders, 1);
});

runTest('markdown import with files calls importMarkdownFiles and resets value', () => {
  const elements = {
    globalSearchShell: createRecorderElement(),
    secondaryNavToggle: createRecorderElement(),
    markdownImportInput: createRecorderElement()
  };
  const state = makeState();
  const imported = [];
  const deps = makeDeps();
  deps.importMarkdownFiles = async (files) => { imported.push(...files); };

  bindSearchEvents({ state, elements, deps });

  const target = {
    files: [{ name: 'a.md' }, { name: 'b.md' }],
    value: 'dirty'
  };

  return elements.markdownImportInput.listeners.get('change')({ target })
    .then(() => {
      assert.deepEqual(imported.map((f) => f.name), ['a.md', 'b.md']);
      assert.equal(target.value, '');
    });
});

runTest('markdown import failure flashes status message', () => {
  const elements = {
    globalSearchShell: createRecorderElement(),
    secondaryNavToggle: createRecorderElement(),
    markdownImportInput: createRecorderElement()
  };
  const state = makeState();
  let flashed = '';
  const deps = makeDeps();
  deps.importMarkdownFiles = async () => { throw new Error('boom'); };
  deps.flashStatus = (msg) => { flashed = msg; };

  bindSearchEvents({ state, elements, deps });

  const target = { files: [{ name: 'bad.md' }], value: 'x' };

  return elements.markdownImportInput.listeners.get('change')({ target })
    .then(() => {
      assert.equal(flashed, 'boom');
    });
});

runTest('missing globalSearchShell element is gracefully ignored', () => {
  const elements = {
    globalSearchShell: null,
    secondaryNavToggle: createRecorderElement(),
    markdownImportInput: createRecorderElement()
  };
  const state = makeState();
  const deps = makeDeps();

  // 不应抛错。
  bindSearchEvents({ state, elements, deps });
});
