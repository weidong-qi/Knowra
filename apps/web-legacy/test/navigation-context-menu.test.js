import assert from 'node:assert/strict';
import { resolveContextMenuTarget } from '../lib/navigation/context-menu.js';

function runTest(name, callback) {
  try {
    callback();
    console.log(`ok - ${name}`);
  } catch (error) {
    console.error(`not ok - ${name}`);
    throw error;
  }
}

function targetWithClosest(matches) {
  return {
    closest(selector) {
      return matches[selector] ?? null;
    }
  };
}

runTest('resolveContextMenuTarget returns null for unrelated targets', () => {
  assert.equal(resolveContextMenuTarget(targetWithClosest({})), null);
});

runTest('resolveContextMenuTarget prefers active notes over other matching targets', () => {
  const target = targetWithClosest({
    '[data-note-id]': { dataset: { noteId: 'note-active' } },
    '[data-recycle-note-id]': { dataset: { recycleNoteId: 'note-deleted' } },
    '[data-folder-id]': { dataset: { folderId: 'folder-a' } }
  });

  assert.deepEqual(resolveContextMenuTarget(target), {
    kind: 'note',
    id: 'note-active',
    selectFolderId: null
  });
});

runTest('resolveContextMenuTarget maps recycle notes to note context targets', () => {
  const target = targetWithClosest({
    '[data-recycle-note-id]': { dataset: { recycleNoteId: 'note-deleted' } }
  });

  assert.deepEqual(resolveContextMenuTarget(target), {
    kind: 'note',
    id: 'note-deleted',
    selectFolderId: null
  });
});

runTest('resolveContextMenuTarget resolves recycle section targets', () => {
  const target = targetWithClosest({
    '[data-recycle-section]': { dataset: { recycleSection: 'true' } }
  });

  assert.deepEqual(resolveContextMenuTarget(target), {
    kind: 'recycle-section',
    id: 'recycle',
    selectFolderId: null
  });
});

runTest('resolveContextMenuTarget resolves folder targets and exposes selection id', () => {
  const target = targetWithClosest({
    '[data-folder-id]': { dataset: { folderId: 'folder-a' } }
  });

  assert.deepEqual(resolveContextMenuTarget(target), {
    kind: 'folder',
    id: 'folder-a',
    selectFolderId: 'folder-a'
  });
});

runTest('resolveContextMenuTarget resolves materials section targets', () => {
  const target = targetWithClosest({
    '[data-materials-section]': { dataset: { materialsSection: 'true' } }
  });

  assert.deepEqual(resolveContextMenuTarget(target), {
    kind: 'materials',
    id: null,
    selectFolderId: null
  });
});
