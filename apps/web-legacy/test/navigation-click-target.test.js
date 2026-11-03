import assert from 'node:assert/strict';
import { resolveClickTarget } from '../lib/navigation/click-target.js';

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

runTest('resolveClickTarget resolves navigation section toggles first', () => {
  const target = targetWithClosest({
    '[data-nav-section]': { dataset: { navSection: 'materials' } },
    '[data-note-id]': { dataset: { noteId: 'note-a' } }
  });

  assert.deepEqual(resolveClickTarget(target), {
    type: 'toggle-section',
    sectionKey: 'materials'
  });
});

runTest('resolveClickTarget resolves folder chevron toggles before folder selection', () => {
  const target = targetWithClosest({
    '[data-folder-toggle]': { dataset: { folderToggle: 'folder-a' } },
    '[data-folder-id]': { dataset: { folderId: 'folder-a' } }
  });

  assert.deepEqual(resolveClickTarget(target), {
    type: 'toggle-folder',
    folderId: 'folder-a'
  });
});

runTest('resolveClickTarget resolves folder selection', () => {
  const target = targetWithClosest({
    '[data-folder-id]': { dataset: { folderId: 'folder-a' } }
  });

  assert.deepEqual(resolveClickTarget(target), {
    type: 'select-folder',
    folderId: 'folder-a'
  });
});

runTest('resolveClickTarget resolves note selection', () => {
  const target = targetWithClosest({
    '[data-note-id]': { dataset: { noteId: 'note-a' } }
  });

  assert.deepEqual(resolveClickTarget(target), {
    type: 'select-note',
    noteId: 'note-a'
  });
});

runTest('resolveClickTarget ignores unrelated clicks', () => {
  assert.equal(resolveClickTarget(targetWithClosest({})), null);
});
