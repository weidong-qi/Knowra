import assert from 'node:assert/strict';
import {
  AUTOSAVE_DELAY_MS,
  BACKEND_CACHE_KEY,
  SEARCH_DEBOUNCE_DELAY_MS,
  SCROLL_POSITIONS_KEY,
  createInitialAppState,
  createRailItems
} from '../../src/app/app-state.js';

const state = createInitialAppState();

assert.equal(BACKEND_CACHE_KEY, 'study-accelerator.backend-workspace-cache');
assert.equal(AUTOSAVE_DELAY_MS, 700);
assert.equal(SEARCH_DEBOUNCE_DELAY_MS, 180);
assert.equal(SCROLL_POSITIONS_KEY, 'study-accelerator.editor-scroll-positions');
assert.equal(state.dataMode, 'loading');
assert.equal(state.statusMessage, '正在加载资料工作台...');
assert.deepEqual(state.search, {
  keyword: '',
  selectedTagIds: [],
  matchingNoteIds: null,
  isOpen: false
});
assert.deepEqual(state.view, {
  screen: 'home',
  mode: 'edit',
  modeBeforeFocus: null,
  showLeftSidebar: true,
  showRightSidebar: true,
  showSourceEditor: false
});
assert.deepEqual(state.libraryIndex, {
  tab: 'all',
  page: 1,
  pageSize: 10,
  selectedNoteId: null,
  inspectorOpen: true,
  directoryOpen: true,
  localKeyword: '',
  filterMenu: null,
  filters: {
    type: 'all',
    status: 'all',
    time: 'updated-desc'
  }
});
assert.deepEqual(state.outlineCollapsedHeadingIdsByNote, {});
assert.deepEqual(createRailItems().map((item) => item.key), [
  'materials',
  'knowledge',
  'training',
  'learning'
]);

assert.notEqual(createInitialAppState(), createInitialAppState());
assert.notEqual(createInitialAppState().search, createInitialAppState().search);

console.log('app-state tests passed');
