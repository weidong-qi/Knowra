import assert from 'node:assert/strict';
import {
  buildTreeFromFlatFolders,
  collectFolderSubtreeIds,
  deleteFolder,
  deleteNote,
  flattenFolderTree,
  insertFolder,
  insertNote,
  moveFolder,
  moveNote,
  renameFolder,
  renameNote,
  resolveNoteVisualType
} from '../lib/tree-workspace.js';

function runTest(name, callback) {
  try {
    callback();
    console.log(`ok - ${name}`);
  } catch (error) {
    console.error(`not ok - ${name}`);
    throw error;
  }
}

const folders = [
  { id: 'root', parentId: null, name: 'STUDY' },
  { id: 'child-a', parentId: 'root', name: 'Inbox' },
  { id: 'child-b', parentId: 'root', name: 'Projects' },
  { id: 'grand-child', parentId: 'child-b', name: 'Archive' }
];

const notes = [
  { id: 'note-a', title: 'Alpha', folderId: 'child-b' },
  { id: 'note-b', title: 'Beta', folderId: 'grand-child' },
  { id: 'note-c', title: 'Gamma', folderId: null }
];

runTest('buildTreeFromFlatFolders nests child folders', () => {
  const tree = buildTreeFromFlatFolders(folders);
  assert.equal(tree.length, 1);
  assert.equal(tree[0].children.length, 2);
  assert.equal(tree[0].children[1].children[0].id, 'grand-child');
});

runTest('flattenFolderTree indexes every folder by id', () => {
  const tree = buildTreeFromFlatFolders(folders);
  const byId = flattenFolderTree(tree);
  assert.equal(byId.root.name, 'STUDY');
  assert.equal(byId['grand-child'].parentId, 'child-b');
});

runTest('insertFolder appends a folder below its parent', () => {
  const tree = buildTreeFromFlatFolders(folders);
  const nextTree = insertFolder(tree, { id: 'child-c', parentId: 'root', name: 'Notes' });
  assert.equal(nextTree[0].children.at(-1).id, 'child-c');
  assert.equal(tree[0].children.some((child) => child.id === 'child-c'), false);
});

runTest('renameFolder updates only the target folder name', () => {
  const tree = buildTreeFromFlatFolders(folders);
  const nextTree = renameFolder(tree, 'child-b', 'Projects 2');
  assert.equal(nextTree[0].children[1].name, 'Projects 2');
  assert.equal(tree[0].children[1].name, 'Projects');
});

runTest('collectFolderSubtreeIds returns the whole subtree', () => {
  const tree = buildTreeFromFlatFolders(folders);
  const subtree = collectFolderSubtreeIds(tree, 'child-b');
  assert.deepEqual([...subtree].sort(), ['child-b', 'grand-child']);
});

runTest('deleteFolder removes subtree and clears note folder references', () => {
  const tree = buildTreeFromFlatFolders(folders);
  const result = deleteFolder(tree, notes, 'child-b');
  assert.equal(result.tree[0].children.some((child) => child.id === 'child-b'), false);
  assert.equal(result.notes.find((note) => note.id === 'note-a').folderId, null);
  assert.equal(result.notes.find((note) => note.id === 'note-b').folderId, null);
  assert.equal(result.notes.find((note) => note.id === 'note-c').folderId, null);
});

runTest('insertNote adds a new note without mutating the source list', () => {
  const nextNotes = insertNote(notes, { id: 'note-d', title: 'Delta', folderId: 'root' });
  assert.equal(nextNotes.length, 4);
  assert.equal(notes.length, 3);
});

runTest('renameNote updates the note title', () => {
  const nextNotes = renameNote(notes, 'note-a', 'Alpha Updated');
  assert.equal(nextNotes.find((note) => note.id === 'note-a').title, 'Alpha Updated');
  assert.equal(notes.find((note) => note.id === 'note-a').title, 'Alpha');
});

runTest('deleteNote removes the target note only', () => {
  const nextNotes = deleteNote(notes, 'note-b');
  assert.equal(nextNotes.some((note) => note.id === 'note-b'), false);
  assert.equal(nextNotes.length, 2);
});

runTest('moveFolder re-parents a folder under another folder', () => {
  const tree = buildTreeFromFlatFolders(folders);
  const nextTree = moveFolder(tree, 'child-a', 'child-b');
  assert.equal(nextTree[0].children.some((child) => child.id === 'child-a'), false);
  const projectsFolder = nextTree[0].children.find((child) => child.id === 'child-b');
  assert.equal(projectsFolder.children.some((child) => child.id === 'child-a'), true);
});

runTest('moveFolder rejects moving a folder under its own descendant', () => {
  const tree = buildTreeFromFlatFolders(folders);
  assert.throws(() => moveFolder(tree, 'child-b', 'grand-child'), /descendant/i);
});

runTest('moveNote updates the note folder id', () => {
  const nextNotes = moveNote(notes, 'note-a', 'root');
  assert.equal(nextNotes.find((note) => note.id === 'note-a').folderId, 'root');
});

runTest('resolveNoteVisualType distinguishes markdown, pdf, and imported resources', () => {
  assert.equal(resolveNoteVisualType({ title: 'Project Log', sourceType: 'markdown-import' }), 'markdown');
  assert.equal(resolveNoteVisualType({ title: 'paper.pdf', sourceType: 'imported-file' }), 'pdf');
  assert.equal(resolveNoteVisualType({ title: 'slides.pptx', sourceType: 'imported-file' }), 'resource');
});
