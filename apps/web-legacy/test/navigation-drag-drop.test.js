import assert from 'node:assert/strict';
import {
  canDropOnTarget,
  resolveDropTarget
} from '../lib/navigation/drag-drop.js';

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

const foldersById = {
  root: { id: 'root', parentId: null },
  child: { id: 'child', parentId: 'root' },
  leaf: { id: 'leaf', parentId: 'child' },
  other: { id: 'other', parentId: null }
};

const notes = [
  { id: 'note-a', folderId: 'child' },
  { id: 'note-root', folderId: null }
];

runTest('resolveDropTarget prefers folder targets over section targets', () => {
  const target = targetWithClosest({
    '[data-folder-id]': { dataset: { folderId: 'child' } },
    '[data-materials-section]': { dataset: { materialsSection: 'true' } }
  });

  assert.deepEqual(resolveDropTarget(target), { kind: 'folder', id: 'child' });
});

runTest('resolveDropTarget resolves root materials section', () => {
  const target = targetWithClosest({
    '[data-materials-section]': { dataset: { materialsSection: 'true' } }
  });

  assert.deepEqual(resolveDropTarget(target), { kind: 'materials', id: null });
});

runTest('canDropOnTarget rejects invalid or unchanged folder moves', () => {
  assert.equal(
    canDropOnTarget({
      dragState: { activeKind: 'folder', activeId: 'child' },
      dropTarget: { kind: 'folder', id: 'child' },
      foldersById,
      notes
    }),
    false
  );
  assert.equal(
    canDropOnTarget({
      dragState: { activeKind: 'folder', activeId: 'child' },
      dropTarget: { kind: 'folder', id: 'leaf' },
      foldersById,
      notes
    }),
    false
  );
  assert.equal(
    canDropOnTarget({
      dragState: { activeKind: 'folder', activeId: 'child' },
      dropTarget: { kind: 'folder', id: 'root' },
      foldersById,
      notes
    }),
    false
  );
});

runTest('canDropOnTarget allows folder moves to a different parent or root', () => {
  assert.equal(
    canDropOnTarget({
      dragState: { activeKind: 'folder', activeId: 'child' },
      dropTarget: { kind: 'folder', id: 'other' },
      foldersById,
      notes
    }),
    true
  );
  assert.equal(
    canDropOnTarget({
      dragState: { activeKind: 'folder', activeId: 'child' },
      dropTarget: { kind: 'materials', id: null },
      foldersById,
      notes
    }),
    true
  );
});

runTest('canDropOnTarget allows note moves only when the target folder changes', () => {
  assert.equal(
    canDropOnTarget({
      dragState: { activeKind: 'note', activeId: 'note-a' },
      dropTarget: { kind: 'folder', id: 'other' },
      foldersById,
      notes
    }),
    true
  );
  assert.equal(
    canDropOnTarget({
      dragState: { activeKind: 'note', activeId: 'note-a' },
      dropTarget: { kind: 'folder', id: 'child' },
      foldersById,
      notes
    }),
    false
  );
  assert.equal(
    canDropOnTarget({
      dragState: { activeKind: 'note', activeId: 'note-root' },
      dropTarget: { kind: 'materials', id: null },
      foldersById,
      notes
    }),
    false
  );
});
