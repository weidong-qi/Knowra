import assert from 'node:assert/strict';
import {
  closeOtherTabs,
  closeTab,
  ensureOpenTab,
  reorderTabs
} from '../lib/editor/tab-workspace.js';

function runTest(name, callback) {
  try {
    callback();
    console.log(`ok - ${name}`);
  } catch (error) {
    console.error(`not ok - ${name}`);
    throw error;
  }
}

runTest('ensureOpenTab appends a missing note id only once', () => {
  assert.deepEqual(ensureOpenTab(['note-a'], 'note-b'), ['note-a', 'note-b']);
  assert.deepEqual(ensureOpenTab(['note-a', 'note-b'], 'note-b'), ['note-a', 'note-b']);
});

runTest('closeTab selects the right neighbor when the active tab closes', () => {
  const result = closeTab(['note-a', 'note-b', 'note-c'], 'note-b', 'note-b');
  assert.deepEqual(result.openTabs, ['note-a', 'note-c']);
  assert.equal(result.nextActiveId, 'note-c');
});

runTest('closeTab keeps the current active tab when closing an inactive tab', () => {
  const result = closeTab(['note-a', 'note-b', 'note-c'], 'note-a', 'note-c');
  assert.deepEqual(result.openTabs, ['note-b', 'note-c']);
  assert.equal(result.nextActiveId, 'note-c');
});

runTest('closeOtherTabs keeps only the requested tab open', () => {
  const result = closeOtherTabs(['note-a', 'note-b', 'note-c'], 'note-b');
  assert.deepEqual(result.openTabs, ['note-b']);
  assert.equal(result.nextActiveId, 'note-b');
});

runTest('reorderTabs moves the dragged tab before the target tab', () => {
  assert.deepEqual(
    reorderTabs(['note-a', 'note-b', 'note-c'], 'note-c', 'note-a'),
    ['note-c', 'note-a', 'note-b']
  );
});

runTest('reorderTabs leaves the order unchanged for invalid drags', () => {
  assert.deepEqual(
    reorderTabs(['note-a', 'note-b'], 'note-a', 'note-a'),
    ['note-a', 'note-b']
  );
  assert.deepEqual(
    reorderTabs(['note-a', 'note-b'], 'note-x', 'note-b'),
    ['note-a', 'note-b']
  );
});
