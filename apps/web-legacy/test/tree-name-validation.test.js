import assert from 'node:assert/strict';
import { validateSiblingName } from '../lib/tree-name-validation.js';

function runTest(name, callback) {
  try {
    callback();
    console.log(`ok - ${name}`);
  } catch (error) {
    console.error(`not ok - ${name}`);
    throw error;
  }
}

runTest('validateSiblingName rejects duplicate note and folder names after trimming', () => {
  assert.throws(() => {
    validateSiblingName({
      candidateName: ' Test ',
      siblingFolders: [{ id: 'folder-a', name: 'Test' }],
      siblingNotes: []
    });
  }, /same name already exists/i);
});

runTest('validateSiblingName allows names that differ only by letter case', () => {
  assert.doesNotThrow(() => {
    validateSiblingName({
      candidateName: 'Test',
      siblingFolders: [],
      siblingNotes: [{ id: 'note-a', title: 'test' }]
    });
  });
});

runTest('validateSiblingName ignores the current item when renaming', () => {
  assert.doesNotThrow(() => {
    validateSiblingName({
      candidateName: 'Test',
      siblingFolders: [{ id: 'folder-a', name: 'Test' }],
      siblingNotes: [],
      currentFolderId: 'folder-a'
    });
  });
});

runTest('validateSiblingName ignores deleted sibling notes in recycle bin', () => {
  assert.doesNotThrow(() => {
    validateSiblingName({
      candidateName: 'Test',
      siblingFolders: [],
      siblingNotes: [{ id: 'note-deleted', title: 'Test', deleted: true }]
    });
  });
});
