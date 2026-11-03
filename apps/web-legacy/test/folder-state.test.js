import assert from 'node:assert/strict';
import { createLocalFolderInput } from '../lib/folders/state.js';

function runTest(name, callback) {
  try {
    callback();
    console.log(`ok - ${name}`);
  } catch (error) {
    console.error(`not ok - ${name}`);
    throw error;
  }
}

runTest('createLocalFolderInput builds the local folder payload', () => {
  assert.deepEqual(createLocalFolderInput({
    id: 'folder-new',
    name: 'New Folder',
    parentId: 'root',
    spaceId: 'space-1'
  }), {
    id: 'folder-new',
    name: 'New Folder',
    parentId: 'root',
    spaceId: 'space-1'
  });
});
