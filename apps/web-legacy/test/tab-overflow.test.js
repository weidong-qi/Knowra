import assert from 'node:assert/strict';
import {
  partitionTabsForOverflow,
  resolveTabCapacity
} from '../lib/editor/tab-overflow.js';

const notes = ['a', 'b', 'c', 'd'].map((id) => ({ id, title: id.toUpperCase() }));

assert.equal(resolveTabCapacity({
  containerWidth: 500,
  minimumTabWidth: 100,
  overflowControlWidth: 40,
  tabCount: 4
}), 4);

assert.equal(resolveTabCapacity({
  containerWidth: 260,
  minimumTabWidth: 100,
  overflowControlWidth: 40,
  tabCount: 4
}), 2);

assert.deepEqual(partitionTabsForOverflow(notes, 'd', 2), {
  visibleNotes: [notes[0], notes[3]],
  overflowNotes: [notes[1], notes[2]]
});

assert.deepEqual(partitionTabsForOverflow(notes, 'a', 4), {
  visibleNotes: notes,
  overflowNotes: []
});

console.log('ok - tab overflow keeps the active note visible without widening the workspace');
