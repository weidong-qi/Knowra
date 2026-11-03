import assert from 'node:assert/strict';
import {
  getDirectNotesForFolder,
  getSearchResultNotes,
  getVisibleNavigationNotes,
  isFolderWithinSelection,
  matchesFolderSearch
} from '../lib/navigation/visibility.js';

function runTest(name, callback) {
  try {
    callback();
    console.log(`ok - ${name}`);
  } catch (error) {
    console.error(`not ok - ${name}`);
    throw error;
  }
}

const foldersById = {
  root: { id: 'root', parentId: null, name: 'Root' },
  child: { id: 'child', parentId: 'root', name: 'Child' },
  other: { id: 'other', parentId: null, name: 'Other' }
};

const folderTree = [
  {
    id: 'root',
    parentId: null,
    name: 'Root',
    children: [
      { id: 'child', parentId: 'root', name: 'Child', children: [] }
    ]
  },
  { id: 'other', parentId: null, name: 'Other', children: [] }
];

const notes = [
  { id: 'root-note', title: 'Root Guide', folderId: 'root', updatedAt: '2026-01-01T00:00:00.000Z' },
  { id: 'child-note', title: 'Child Topic', folderId: 'child', updatedAt: '2026-01-03T00:00:00.000Z' },
  { id: 'other-note', title: 'Other Topic', folderId: 'other', updatedAt: '2026-01-02T00:00:00.000Z' },
  { id: 'deleted-note', title: 'Deleted Topic', folderId: 'child', deleted: true }
];

runTest('isFolderWithinSelection accepts descendants of the selected folder', () => {
  assert.equal(isFolderWithinSelection({ foldersById, selectedFolderId: 'root', folderId: 'child' }), true);
  assert.equal(isFolderWithinSelection({ foldersById, selectedFolderId: 'child', folderId: 'root' }), false);
});

runTest('getDirectNotesForFolder returns active notes in the requested folder', () => {
  assert.deepEqual(
    getDirectNotesForFolder(notes, 'child').map((note) => note.id),
    ['child-note']
  );
});

runTest('getVisibleNavigationNotes limits notes to selected folder descendants without active filters', () => {
  const visible = getVisibleNavigationNotes({
    notes,
    foldersById,
    selectedFolderId: 'root',
    search: { keyword: '', selectedTagIds: [] }
  });

  assert.deepEqual(visible.map((note) => note.id), ['root-note', 'child-note']);
});

runTest('getVisibleNavigationNotes ignores selected folder when search filters are active', () => {
  const visible = getVisibleNavigationNotes({
    notes,
    foldersById,
    selectedFolderId: 'root',
    search: { keyword: 'other', selectedTagIds: [] }
  });

  assert.deepEqual(visible.map((note) => note.id), ['other-note']);
});

runTest('getVisibleNavigationNotes uses backend full-text match ids for compact summaries', () => {
  const visible = getVisibleNavigationNotes({
    notes,
    foldersById,
    selectedFolderId: null,
    search: {
      keyword: 'body-only-keyword',
      selectedTagIds: [],
      matchingNoteIds: ['child-note']
    }
  });

  assert.deepEqual(visible.map((note) => note.id), ['child-note']);
});

runTest('getSearchResultNotes sorts visible notes by updated time descending', () => {
  const visible = getSearchResultNotes({
    notes,
    foldersById,
    selectedFolderId: null,
    search: { keyword: '', selectedTagIds: [] }
  });

  assert.deepEqual(visible.map((note) => note.id), ['child-note', 'other-note', 'root-note']);
});

runTest('matchesFolderSearch includes folders with matching descendants', () => {
  assert.equal(
    matchesFolderSearch({
      folder: folderTree[0],
      notes,
      search: { keyword: 'child', selectedTagIds: [] }
    }),
    true
  );
  assert.equal(
    matchesFolderSearch({
      folder: folderTree[1],
      notes,
      search: { keyword: 'child', selectedTagIds: [] }
    }),
    false
  );
});
