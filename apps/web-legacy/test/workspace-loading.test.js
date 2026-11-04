import assert from 'node:assert/strict';
import {
  createInitialWorkspaceScript,
  createBackendSnapshot,
  mergeWorkspaceSnapshots,
  selectInitialWorkspaceSource,
  selectLoadRecovery
} from '../lib/workspace-loading.js';
import { recoveryVectors } from '../../../packages/web-core/test/workspace-vectors.js';

function runTest(name, callback) {
  try {
    callback();
    console.log(`ok - ${name}`);
  } catch (error) {
    console.error(`not ok - ${name}`);
    throw error;
  }
}

runTest('selectLoadRecovery prefers backend when backend is available', () => {
  assert.equal(selectLoadRecovery(recoveryVectors[0].input), recoveryVectors[0].expected);
});

runTest('selectLoadRecovery prefers cache over mock when backend is unavailable', () => {
  assert.equal(
    selectLoadRecovery(recoveryVectors[1].input),
    recoveryVectors[1].expected
  );
});

runTest('selectLoadRecovery falls back to mock only when nothing else exists', () => {
  assert.equal(selectLoadRecovery(recoveryVectors[2].input), recoveryVectors[2].expected);
});

runTest('selectInitialWorkspaceSource uses cached backend data during initial refresh', () => {
  assert.equal(
    selectInitialWorkspaceSource({ cachedSnapshot: { currentSpaceId: 'space-1', folderTree: [] } }),
    'cache'
  );
});

runTest('selectInitialWorkspaceSource keeps loading state when no cache exists', () => {
  assert.equal(selectInitialWorkspaceSource({ cachedSnapshot: null }), 'loading');
});

runTest('createBackendSnapshot keeps the backend tree payload needed for recovery', () => {
  const snapshot = createBackendSnapshot({
    spaces: [{ id: 'space-1' }],
    currentSpaceId: 'space-1',
    folderTree: [{ id: 'folder-1', children: [] }],
    tags: [{ id: 'tag-1' }],
    allNotes: [{ id: 'note-1' }],
    openFolders: { 'folder-1': true },
    openNoteTabs: ['note-1', 'note-2'],
    selectedFolderId: 'folder-1',
    selectedNoteId: 'note-1'
  });

  assert.equal(snapshot.currentSpaceId, 'space-1');
  assert.equal(snapshot.folderTree[0].id, 'folder-1');
  assert.equal(snapshot.allNotes[0].id, 'note-1');
  assert.deepEqual(snapshot.openNoteTabs, ['note-1', 'note-2']);
});

runTest('mergeWorkspaceSnapshots keeps live backend data but restores cached tab state', () => {
  const merged = mergeWorkspaceSnapshots(
    {
      currentSpaceId: 'space-1',
      folderTree: [{ id: 'folder-new', children: [] }],
      allNotes: [{ id: 'note-1' }, { id: 'note-2' }],
      openFolders: {},
      openNoteTabs: [],
      selectedFolderId: null,
      selectedNoteId: 'note-1'
    },
    {
      currentSpaceId: 'space-1',
      folderTree: [{ id: 'folder-old', children: [] }],
      allNotes: [{ id: 'stale-note' }],
      openFolders: { 'folder-new': true },
      openNoteTabs: ['note-1', 'note-2'],
      selectedFolderId: 'folder-new',
      selectedNoteId: 'note-2'
    }
  );

  assert.equal(merged.folderTree[0].id, 'folder-new');
  assert.equal(merged.allNotes[1].id, 'note-2');
  assert.deepEqual(merged.openNoteTabs, ['note-1', 'note-2']);
  assert.equal(merged.selectedNoteId, 'note-2');
  assert.equal(merged.selectedFolderId, 'folder-new');
});

runTest('createInitialWorkspaceScript safely embeds a backend snapshot', () => {
  const script = createInitialWorkspaceScript({
    currentSpaceId: 'space-1',
    folderTree: [{ id: 'folder-1', name: '</script><div>', children: [] }],
    allNotes: [],
    tags: [],
    spaces: []
  });

  assert.match(script, /window\.__STUDY_INITIAL_WORKSPACE__/);
  assert.doesNotMatch(script, /<\/script><div>/i);
  assert.match(script, /\\u003c\/script>/i);
});
