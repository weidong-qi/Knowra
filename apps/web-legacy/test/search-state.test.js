import assert from 'node:assert/strict';

import {
  getSelectedSearchTags,
  getVisibleSearchTags,
  hasActiveSearchFilters,
  matchesSearch,
  noteMatchesKeyword,
  noteMatchesSelectedTags,
  toggleSearchTagId
} from '../lib/search/state.js';

const tags = [
  { id: 'tag-clip', name: 'CLIP' },
  { id: 'tag-memory', name: 'Memory' },
  { id: 'tag-other', name: 'Other' }
];

const search = { keyword: 'mem', selectedTagIds: ['tag-memory'], isOpen: false };

assert.equal(hasActiveSearchFilters(search), true);
assert.deepEqual(getSelectedSearchTags(tags, search), [{ id: 'tag-memory', name: 'Memory' }]);
assert.deepEqual(getVisibleSearchTags(tags, search).map((tag) => tag.id), ['tag-memory']);
assert.equal(matchesSearch('Long Memory', search), true);
assert.equal(matchesSearch('CLIP', search), false);
assert.equal(noteMatchesSelectedTags({ tagIds: ['tag-memory', 'tag-clip'] }, search), true);
assert.equal(noteMatchesSelectedTags({ tagIds: ['tag-clip'] }, search), false);
assert.equal(noteMatchesKeyword({ id: 'note-memory', title: 'Other', summary: 'Memory body' }, search), true);
assert.equal(noteMatchesKeyword(
  { id: 'note-server-match', title: 'Other', summary: '' },
  { ...search, matchingNoteIds: ['note-server-match'] }
), true);
assert.deepEqual(toggleSearchTagId(['tag-memory'], 'tag-memory'), []);
assert.deepEqual(toggleSearchTagId(['tag-memory'], 'tag-clip'), ['tag-memory', 'tag-clip']);

console.log('ok - search state helpers select tags and match notes');
