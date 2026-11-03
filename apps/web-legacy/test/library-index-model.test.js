import assert from 'node:assert/strict';
import {
  getEstimatedReadingMinutes,
  getLibraryTabCounts,
  paginateLibraryIndexNotes,
  selectLibraryIndexNotes
} from '../lib/library-index/model.js';
import {
  renderLibraryIndexFilters,
  renderLibraryIndexTabs
} from '../lib/library-index/filter-renderers.js';
import { renderLibraryPagination } from '../lib/library-index/pagination-renderers.js';

const notes = Array.from({ length: 7 }, (_, index) => ({
  id: `note-${index + 1}`,
  title: `资料 ${index + 1}`,
  rawMarkdown: index === 0 ? '知识管理 '.repeat(100) : '正文',
  sourceType: index % 2 === 0 ? 'manual' : 'markdown-import',
  status: index % 3 === 0 ? 'draft' : 'active',
  favorite: index === 0 || index === 4,
  deleted: index === 6,
  tagIds: index === 0 ? ['tag-1'] : [],
  createdAt: `2026-07-${String(index + 1).padStart(2, '0')}T08:00:00.000Z`,
  updatedAt: `2026-07-${String(index + 2).padStart(2, '0')}T08:00:00.000Z`
}));

function createState(overrides = {}) {
  return {
    allNotes: notes,
    tags: [{ id: 'tag-1', name: '知识管理' }],
    search: { keyword: '', selectedTagIds: [] },
    selectedFolderId: null,
    libraryIndex: {
      tab: 'all',
      filterMenu: null,
      filters: { type: 'all', status: 'all', time: 'updated-desc' },
      ...overrides.libraryIndex
    },
    ...overrides
  };
}

assert.deepEqual(getLibraryTabCounts(notes), {
  all: 6,
  recent: 5,
  favorites: 2,
  recycle: 1
});

const recent = selectLibraryIndexNotes(createState({
  libraryIndex: { tab: 'recent', filters: { type: 'all', status: 'all', time: 'updated-desc' } }
}));
assert.equal(recent.length, 5);
assert.deepEqual(recent.map((note) => note.id), ['note-6', 'note-5', 'note-4', 'note-3', 'note-2']);

const filtered = selectLibraryIndexNotes(createState({
  libraryIndex: {
    tab: 'all',
    filters: { type: 'manual', status: 'draft', time: 'created-asc' }
  }
}));
assert.deepEqual(filtered.map((note) => note.id), ['note-1']);

const searched = selectLibraryIndexNotes(createState({
  search: { keyword: '知识管理', selectedTagIds: ['tag-1'] }
}));
assert.deepEqual(searched.map((note) => note.id), ['note-1']);
const locallySearched = selectLibraryIndexNotes(createState({
  libraryIndex: { localKeyword: '资料 2' },
  search: { keyword: '', selectedTagIds: [] }
}));
assert.deepEqual(locallySearched.map((note) => note.id), ['note-2']);
assert.equal(getEstimatedReadingMinutes(notes[0]), 2);

const paginated = paginateLibraryIndexNotes(notes, { page: 2, pageSize: 5 });
assert.deepEqual(paginated.items.map((note) => note.id), ['note-6', 'note-7']);
assert.equal(paginated.page, 2);
assert.equal(paginated.totalPages, 2);
assert.equal(paginateLibraryIndexNotes(notes, { page: 99, pageSize: 10 }).page, 1);

const tabHtml = renderLibraryIndexTabs({ state: createState() });
assert.match(tabHtml, /data-index-tab="recent"/);
assert.doesNotMatch(tabHtml, /我创建的/);
assert.match(tabHtml, /id="library-index-tab-all"[\s\S]*role="tab"[\s\S]*aria-selected="true"[\s\S]*aria-controls="library-index-content"[\s\S]*tabindex="0"/);
assert.match(tabHtml, /id="library-index-tab-recent"[\s\S]*role="tab"[\s\S]*aria-selected="false"[\s\S]*tabindex="-1"/);

const paginationHtml = renderLibraryPagination({
  page: 2,
  pageSize: 5,
  totalItems: 7,
  totalPages: 2
});
assert.match(paginationHtml, /data-index-page="2"[\s\S]*aria-current="page"/);
const pageOneButton = paginationHtml.match(/data-index-page="1"([\s\S]*?)<\/button>/);
assert.ok(pageOneButton);
assert.doesNotMatch(pageOneButton[0], /aria-current="page"/);
assert.match(paginationHtml, /data-index-page-size="5"[\s\S]*aria-pressed="true"/);
assert.match(paginationHtml, /data-index-page-size="10"[\s\S]*aria-pressed="false"/);

const filterHtml = renderLibraryIndexFilters({
  state: createState({
    libraryIndex: {
      tab: 'all',
      filterMenu: 'status',
      filters: { type: 'all', status: 'draft', time: 'updated-desc' }
    }
  })
});
assert.match(filterHtml, /role="menu"[\s\S]*aria-label="状态筛选"/);
assert.match(filterHtml, /aria-checked="true"[\s\S]*data-filter-value="draft"/);

const closedFilterHtml = renderLibraryIndexFilters({ state: createState() });
assert.match(closedFilterHtml, /data-index-filter="type"[\s\S]*aria-controls="library-index-filter-menu-type"/);
assert.match(closedFilterHtml, /id="library-index-filter-menu-type"[\s\S]*hidden/);
assert.match(closedFilterHtml, /data-index-local-search[^>]*placeholder="在当前范围内筛选…"/);
assert.match(closedFilterHtml, /aria-label="在当前范围内筛选资料"/);

console.log('ok - library index filters, local search, recent scope and sorting');
