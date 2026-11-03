import assert from 'node:assert/strict';
import {
  createLocalImportedNoteInput,
  createLocalManualNoteInput,
  emptyLocalRecycleBin,
  moveLocalNoteToFolder,
  permanentlyDeleteLocalNote,
  renameLocalNote,
  restoreLocalNote,
  setLocalNoteFavorite,
  softDeleteLocalNote
} from '../lib/notes/state.js';

function runTest(name, callback) {
  try {
    callback();
    console.log(`ok - ${name}`);
  } catch (error) {
    console.error(`not ok - ${name}`);
    throw error;
  }
}

const notes = [
  { id: 'note-1', title: 'Alpha', folderId: 'folder-a', favorite: false },
  { id: 'note-2', title: 'Beta', folderId: null, deleted: true, favorite: true },
  { id: 'note-3', title: 'Gamma', folderId: 'folder-b', deleted: false }
];

const timestamp = '2026-06-25T00:00:00.000Z';

runTest('createLocalManualNoteInput builds the local manual note payload', () => {
  assert.deepEqual(createLocalManualNoteInput({
    id: 'note-new',
    title: 'New Note',
    folderId: 'root',
    spaceId: 'space-1',
    updatedAt: timestamp
  }), {
    id: 'note-new',
    title: 'New Note',
    rawMarkdown: '',
    folderId: 'root',
    spaceId: 'space-1',
    favorite: false,
    status: 'draft',
    sourceType: 'manual',
    tagIds: [],
    internalLinks: [],
    updatedAt: timestamp
  });
});

runTest('createLocalImportedNoteInput builds the local markdown import payload', () => {
  assert.deepEqual(createLocalImportedNoteInput({
    item: {
      id: 'note-import-a',
      title: 'Imported',
      rawMarkdown: '# Imported',
      sourceType: 'markdown-import'
    },
    folderId: 'root',
    spaceId: 'space-1',
    updatedAt: timestamp
  }), {
    id: 'note-import-a',
    title: 'Imported',
    rawMarkdown: '# Imported',
    folderId: 'root',
    spaceId: 'space-1',
    favorite: false,
    status: 'draft',
    sourceType: 'markdown-import',
    tagIds: [],
    internalLinks: [],
    updatedAt: timestamp
  });
});

runTest('renameLocalNote updates title and timestamp without mutating other notes', () => {
  const result = renameLocalNote(notes, 'note-1', 'Alpha Updated', timestamp);

  assert.equal(result.find((note) => note.id === 'note-1').title, 'Alpha Updated');
  assert.equal(result.find((note) => note.id === 'note-1').updatedAt, timestamp);
  assert.equal(result.find((note) => note.id === 'note-2').title, 'Beta');
  assert.equal(notes.find((note) => note.id === 'note-1').title, 'Alpha');
});

runTest('softDeleteLocalNote marks a note deleted', () => {
  const result = softDeleteLocalNote(notes, 'note-1', timestamp);

  assert.equal(result.find((note) => note.id === 'note-1').deleted, true);
  assert.equal(result.find((note) => note.id === 'note-1').updatedAt, timestamp);
});

runTest('permanentlyDeleteLocalNote removes a note from the collection', () => {
  const result = permanentlyDeleteLocalNote(notes, 'note-2');

  assert.deepEqual(result.map((note) => note.id), ['note-1', 'note-3']);
});

runTest('restoreLocalNote marks a note active', () => {
  const result = restoreLocalNote(notes, 'note-2', timestamp);

  assert.equal(result.find((note) => note.id === 'note-2').deleted, false);
  assert.equal(result.find((note) => note.id === 'note-2').updatedAt, timestamp);
});

runTest('emptyLocalRecycleBin removes deleted notes', () => {
  const result = emptyLocalRecycleBin(notes);

  assert.deepEqual(result.map((note) => note.id), ['note-1', 'note-3']);
});

runTest('setLocalNoteFavorite stores favorite as a boolean', () => {
  const result = setLocalNoteFavorite(notes, 'note-1', 1, timestamp);

  assert.equal(result.find((note) => note.id === 'note-1').favorite, true);
  assert.equal(result.find((note) => note.id === 'note-1').updatedAt, timestamp);
});

runTest('moveLocalNoteToFolder updates folder and timestamp', () => {
  const result = moveLocalNoteToFolder(notes, 'note-1', 'folder-c', timestamp);

  assert.equal(result.find((note) => note.id === 'note-1').folderId, 'folder-c');
  assert.equal(result.find((note) => note.id === 'note-1').updatedAt, timestamp);
});
