import assert from 'node:assert/strict';

import {
  clearWorkspaceCache,
  readInitialWorkspaceSnapshot,
  readWorkspaceCache,
  writeWorkspaceCache
} from '../lib/workspace-cache.js';

function createStorage() {
  const values = new Map();
  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, value);
    }
  };
}

const snapshot = {
  folderTree: [],
  allNotes: [],
  tags: [],
  spaces: []
};

const storage = createStorage();
writeWorkspaceCache(storage, 'workspace-cache', snapshot);
assert.deepEqual(
  readWorkspaceCache(storage, 'workspace-cache'),
  snapshot,
  'workspace cache should round-trip valid snapshots'
);

const invalidStorage = createStorage();
invalidStorage.setItem('workspace-cache', JSON.stringify({ folderTree: [] }));
assert.equal(
  readWorkspaceCache(invalidStorage, 'workspace-cache'),
  null,
  'workspace cache should reject incomplete snapshots'
);

const malformedStorage = createStorage();
malformedStorage.setItem('workspace-cache', '{bad json');
assert.equal(
  readWorkspaceCache(malformedStorage, 'workspace-cache'),
  null,
  'workspace cache should ignore malformed JSON'
);

const corruptTreeStorage = createStorage();
corruptTreeStorage.setItem('workspace-cache', JSON.stringify({ folderTree: [null], allNotes: [] }));
assert.equal(
  readWorkspaceCache(corruptTreeStorage, 'workspace-cache'),
  null,
  'workspace cache should reject snapshots with invalid folder nodes'
);

const corruptNoteStorage = createStorage();
corruptNoteStorage.setItem('workspace-cache', JSON.stringify({
  folderTree: [],
  allNotes: [{ id: 'note-1', tagIds: {}, internalLinks: [] }]
}));
assert.equal(
  readWorkspaceCache(corruptNoteStorage, 'workspace-cache'),
  null,
  'workspace cache should reject snapshots with invalid note array fields'
);

assert.deepEqual(
  readInitialWorkspaceSnapshot({ __STUDY_INITIAL_WORKSPACE__: snapshot }),
  snapshot,
  'initial workspace snapshot should read valid bootstrapped data'
);
assert.equal(
  readInitialWorkspaceSnapshot({ __STUDY_INITIAL_WORKSPACE__: { allNotes: [] } }),
  null,
  'initial workspace snapshot should reject incomplete bootstrapped data'
);

const removableStorage = {
  value: 'cached',
  getItem() {
    return this.value;
  },
  removeItem(key) {
    assert.equal(key, 'workspace-cache');
    this.value = null;
  }
};
clearWorkspaceCache(removableStorage, 'workspace-cache');
assert.equal(
  removableStorage.getItem('workspace-cache'),
  null,
  'workspace cache should be removable when a startup snapshot breaks rendering'
);

console.log('ok - workspace cache helpers read and write valid snapshots');
