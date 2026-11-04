import assert from 'node:assert/strict';

import { buildMockWorkspaceState } from '../lib/mock-workspace.js';

const state = buildMockWorkspaceState({
  folders: [{ id: 'folder-1', parentId: null, name: 'Folder' }],
  notes: [
    {
      id: 'note-1',
      folderId: 'folder-1',
      title: 'Note',
      tagIds: ['tag-1'],
      internalLinks: ['note-2']
    }
  ],
  tags: [{ id: 'tag-1', name: 'Tag' }]
});

assert.deepEqual(state.spaces, [{ id: 'space-local-preview', name: '本地演示空间' }]);
assert.equal(state.currentSpaceId, 'space-local-preview');
assert.equal(state.folderTree[0].id, 'folder-1');
assert.equal(state.folderTree[0].spaceId, 'space-local-preview');
assert.equal(state.allNotes[0].spaceId, 'space-local-preview');
assert.deepEqual(state.allNotes[0].tagIds, ['tag-1']);
assert.notEqual(state.allNotes[0].tagIds, state.allNotes[0].internalLinks);
assert.deepEqual(state.openFolders, { 'folder-1': true });
assert.deepEqual(state.tags, [{ id: 'tag-1', name: 'Tag' }]);

console.log('ok - mock workspace builder creates local preview state');
