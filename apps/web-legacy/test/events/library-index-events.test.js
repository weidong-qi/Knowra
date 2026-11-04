import assert from 'node:assert/strict';
import { bindLibraryIndexEvents } from '../../lib/events/library-index-events.js';
import { createRecorderElement } from '../_support/recorder-elements.js';

function makeClosest(entries) {
  const map = new Map(entries);
  return (selector) => map.get(selector) ?? null;
}

function createHarness() {
  const tabButtons = ['all', 'recent', 'favorites', 'recycle'].map((key) => {
    const button = {
      dataset: { indexTab: key },
      focusCount: 0,
      focus() { button.focusCount += 1; }
    };
    button.closest = makeClosest([['[data-index-tab]', button]]);
    return button;
  });
  const elements = {
    libraryIndexView: createRecorderElement(),
    libraryIndexInspector: createRecorderElement(),
    libraryIndexDirectoryReopen: {
      focusCount: 0,
      focus() { elements.libraryIndexDirectoryReopen.focusCount += 1; }
    },
    libraryIndexDirectoryToggle: {
      focusCount: 0,
      focus() { elements.libraryIndexDirectoryToggle.focusCount += 1; }
    },
    editorAsideToggle: {
      focusCount: 0,
      focus() { elements.editorAsideToggle.focusCount += 1; }
    },
    editorAsideReopen: {
      focusCount: 0,
      focus() { elements.editorAsideReopen.focusCount += 1; }
    },
    workspaceShell: createRecorderElement()
  };
  let renderedLocalSearchInput = null;
  let renderedInspectorReopenButton = null;
  elements.libraryIndexView.querySelectorAll = (selector) => (
    selector === '[data-index-tab]' ? tabButtons : []
  );
  elements.libraryIndexView.querySelector = (selector) => (
    selector === '[data-index-local-search]' ? renderedLocalSearchInput : null
  );
  elements.libraryIndexInspector.querySelector = (selector) => (
    selector === '[data-index-inspector-open]' ? renderedInspectorReopenButton : null
  );
  const state = {
    selectedFolderId: 'folder-1',
    search: { keyword: 'query', selectedTagIds: ['tag-1'], isOpen: true },
    libraryIndex: {
      tab: 'recent',
      page: 2,
      pageSize: 10,
      selectedNoteId: 'note-old',
      inspectorOpen: true,
      directoryOpen: true,
      filterMenu: 'type',
      filters: { type: 'markdown-import', status: 'draft', time: 'created-asc' }
    },
    view: { screen: 'index', showLeftSidebar: true, showRightSidebar: true }
  };
  const calls = {
    renderedIndex: 0,
    renderedAll: 0,
    cleared: 0,
    opened: [],
    openedAttachments: [],
    fileMenuActions: [],
    returns: []
  };
  const deps = {
    selectNote: async (id, options) => { calls.opened.push({ id, options }); },
    renderLibraryIndex: () => { calls.renderedIndex += 1; },
    renderAll: () => { calls.renderedAll += 1; },
    clearSearchFilters: () => { calls.cleared += 1; },
    openAttachment: (id) => { calls.openedAttachments.push(id); },
    restoreNote: async () => {},
    handleFileMenuAction: (action) => { calls.fileMenuActions.push(action); },
    returnToLibraryIndex: async (options) => {
      calls.returns.push(options);
      return true;
    },
    flashStatus: () => {}
  };
  bindLibraryIndexEvents({ state, elements, deps });
  return {
    elements,
    state,
    calls,
    tabButtons,
    setRenderedLocalSearchInput: (input) => { renderedLocalSearchInput = input; },
    setRenderedInspectorReopenButton: (button) => { renderedInspectorReopenButton = button; }
  };
}

{
  const { elements, state, calls } = createHarness();
  const option = { dataset: { filterKind: 'type', filterValue: 'manual' } };
  option.closest = makeClosest([['[data-index-filter-option]', option]]);

  elements.libraryIndexView.dispatch('click', option);

  assert.equal(state.libraryIndex.filters.type, 'manual');
  assert.equal(state.libraryIndex.filterMenu, null);
  assert.equal(state.libraryIndex.selectedNoteId, null);
  assert.equal(state.libraryIndex.page, 1);
  assert.equal(calls.renderedIndex, 1);
}

{
  const { elements, state, calls, setRenderedLocalSearchInput } = createHarness();
  const nextInput = {
    value: '本地筛选',
    focusCount: 0,
    selection: null,
    focus() { nextInput.focusCount += 1; },
    setSelectionRange(start, end) { nextInput.selection = [start, end]; }
  };
  setRenderedLocalSearchInput(nextInput);
  const input = { value: '本地筛选', dataset: {} };
  input.closest = makeClosest([['[data-index-local-search]', input]]);

  elements.libraryIndexView.dispatch('input', input);

  assert.equal(state.libraryIndex.localKeyword, '本地筛选');
  assert.equal(state.search.keyword, 'query');
  assert.equal(state.search.isOpen, true);
  assert.equal(state.libraryIndex.page, 1);
  assert.equal(state.libraryIndex.selectedNoteId, null);
  assert.equal(calls.renderedAll, 1);
  assert.equal(nextInput.focusCount, 1);
  assert.deepEqual(nextInput.selection, [4, 4]);
}

{
  const { elements, state, calls } = createHarness();
  const pageSizeButton = { dataset: { indexPageSize: '5' } };
  pageSizeButton.closest = makeClosest([['[data-index-page-size]', pageSizeButton]]);

  elements.libraryIndexView.dispatch('click', pageSizeButton);

  assert.equal(state.libraryIndex.pageSize, 5);
  assert.equal(state.libraryIndex.page, 1);
  assert.equal(calls.renderedIndex, 1);
}

{
  const { elements, state, calls } = createHarness();
  const pageButton = { dataset: { indexPage: '3' } };
  pageButton.closest = makeClosest([['[data-index-page]', pageButton]]);

  elements.libraryIndexView.dispatch('click', pageButton);

  assert.equal(state.libraryIndex.page, 3);
  assert.equal(calls.renderedIndex, 1);
}

{
  const { elements, state, calls } = createHarness();
  const clearButton = { dataset: {} };
  clearButton.closest = makeClosest([['[data-index-clear]', clearButton]]);

  elements.libraryIndexView.dispatch('click', clearButton);

  assert.equal(state.libraryIndex.tab, 'all');
  assert.equal(state.selectedFolderId, null);
  assert.deepEqual(state.libraryIndex.filters, {
    type: 'all',
    status: 'all',
    time: 'updated-desc'
  });
  assert.equal(calls.cleared, 1);
  assert.equal(calls.renderedIndex, 1);
}

for (const [key, expectedTab, expectedFocusIndex] of [
  ['ArrowRight', 'favorites', 2],
  ['ArrowDown', 'favorites', 2],
  ['ArrowLeft', 'all', 0],
  ['ArrowUp', 'all', 0],
  ['Home', 'all', 0],
  ['End', 'recycle', 3]
]) {
  const { elements, state, calls, tabButtons } = createHarness();
  const currentTab = tabButtons[1];
  let prevented = false;

  elements.libraryIndexView.dispatch('keydown', currentTab, {
    key,
    preventDefault: () => { prevented = true; }
  });

  assert.equal(state.libraryIndex.tab, expectedTab, `${key} should select ${expectedTab}`);
  assert.equal(state.libraryIndex.page, 1);
  assert.equal(state.selectedFolderId, null);
  assert.equal(calls.renderedAll, 1);
  assert.equal(prevented, true);
  assert.equal(tabButtons[expectedFocusIndex].focusCount, 1);
}

{
  const { elements, state, tabButtons } = createHarness();
  state.libraryIndex.tab = 'all';
  let prevented = false;

  elements.libraryIndexView.dispatch('keydown', tabButtons[0], {
    key: 'ArrowLeft',
    preventDefault: () => { prevented = true; }
  });

  assert.equal(state.libraryIndex.tab, 'recycle');
  assert.equal(prevented, true);
  assert.equal(tabButtons[3].focusCount, 1);
}

{
  const { elements, calls } = createHarness();
  const row = { dataset: { indexNoteSelect: 'note-42' } };
  row.closest = makeClosest([['[data-index-note-select]', row]]);
  let prevented = false;

  elements.libraryIndexView.dispatch('dblclick', row, {
    preventDefault: () => { prevented = true; }
  });

  assert.equal(prevented, true);
  assert.deepEqual(calls.opened, [{
    id: 'note-42',
    options: { syncFolder: true, ensureTab: true }
  }]);
}

{
  const { elements, state, calls, setRenderedInspectorReopenButton } = createHarness();
  const closeButton = { dataset: {} };
  const reopenButton = {
    focusCount: 0,
    focus() { reopenButton.focusCount += 1; }
  };
  setRenderedInspectorReopenButton(reopenButton);
  closeButton.closest = makeClosest([['[data-index-inspector-close]', closeButton]]);

  elements.libraryIndexView.dispatch('click', closeButton);

  assert.equal(state.libraryIndex.inspectorOpen, false);
  assert.equal(calls.renderedIndex, 1);
  assert.equal(reopenButton.focusCount, 1);
}

{
  const { elements, state, calls } = createHarness();
  state.libraryIndex.inspectorOpen = false;
  const reopenButton = { dataset: {} };
  reopenButton.closest = makeClosest([['[data-index-inspector-open]', reopenButton]]);

  elements.libraryIndexView.dispatch('click', reopenButton);

  assert.equal(state.libraryIndex.inspectorOpen, true);
  assert.equal(calls.renderedIndex, 1);
}

{
  const { elements, calls } = createHarness();
  const attachmentButton = { dataset: { attachmentOpen: 'attachment-a' } };
  attachmentButton.closest = makeClosest([['[data-attachment-open]', attachmentButton]]);

  elements.libraryIndexView.dispatch('click', attachmentButton);

  assert.deepEqual(calls.openedAttachments, ['attachment-a']);
}

{
  const { elements, state, calls } = createHarness();
  state.view.screen = 'editor';
  const homeButton = { dataset: { libraryHome: 'global' } };
  homeButton.closest = makeClosest([['[data-library-home]', homeButton]]);

  elements.workspaceShell.dispatch('click', homeButton);

  assert.deepEqual(calls.returns, [{ global: true }]);
  assert.equal(state.view.screen, 'editor');
  assert.equal(calls.renderedAll, 0);
}

{
  const { elements, state, calls } = createHarness();
  const directoryToggle = { dataset: {} };
  directoryToggle.closest = makeClosest([['[data-index-directory-toggle]', directoryToggle]]);

  elements.workspaceShell.dispatch('click', directoryToggle);

  assert.equal(state.libraryIndex.directoryOpen, false);
  assert.equal(calls.renderedAll, 1);
  assert.equal(elements.libraryIndexDirectoryReopen.focusCount, 1);
}

{
  const { elements, state, calls } = createHarness();
  state.view.screen = 'editor';
  const directoryToggle = { dataset: {} };
  directoryToggle.closest = makeClosest([['[data-index-directory-toggle]', directoryToggle]]);

  elements.workspaceShell.dispatch('click', directoryToggle);

  assert.equal(state.view.showLeftSidebar, false);
  assert.equal(state.libraryIndex.directoryOpen, true, 'editor toggles must not overwrite the index preference');
  assert.equal(calls.renderedAll, 1);
  assert.equal(elements.libraryIndexDirectoryReopen.focusCount, 1);

  elements.workspaceShell.dispatch('click', directoryToggle);

  assert.equal(state.view.showLeftSidebar, true);
  assert.equal(calls.renderedAll, 2);
  assert.equal(elements.libraryIndexDirectoryToggle.focusCount, 1);
}

{
  const { elements, calls } = createHarness();
  const createFolderButton = { dataset: {} };
  createFolderButton.closest = makeClosest([['[data-index-directory-create]', createFolderButton]]);

  elements.workspaceShell.dispatch('click', createFolderButton);

  assert.deepEqual(calls.fileMenuActions, ['new-folder']);
}

{
  const { elements, state, calls } = createHarness();
  state.view.screen = 'editor';
  state.view.showRightSidebar = true;
  const closeButton = { dataset: {} };
  closeButton.closest = makeClosest([['[data-editor-aside-toggle]', closeButton]]);

  elements.workspaceShell.dispatch('click', closeButton);

  assert.equal(state.view.showRightSidebar, false);
  assert.equal(calls.renderedAll, 1);
  assert.equal(elements.editorAsideReopen.focusCount, 1);
  assert.equal(elements.editorAsideToggle.focusCount, 0);
}

{
  const { elements, state, calls } = createHarness();
  state.view.screen = 'editor';
  state.view.showRightSidebar = false;
  const reopenButton = { dataset: {} };
  reopenButton.closest = makeClosest([['[data-editor-aside-toggle]', reopenButton]]);

  elements.workspaceShell.dispatch('click', reopenButton);

  assert.equal(state.view.showRightSidebar, true);
  assert.equal(calls.renderedAll, 1);
  assert.equal(elements.editorAsideToggle.focusCount, 1);
  assert.equal(elements.editorAsideReopen.focusCount, 0);
}

console.log('ok - library index events apply filters, clear state and open on double click');
