import assert from 'node:assert/strict';

import {
  captureScrollPosition,
  getSavedScrollTop,
  readScrollPositions,
  writeScrollPositions
} from '../lib/editor/scroll-positions.js';

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

const positions = {};
captureScrollPosition(positions, 'note-1', 120);
captureScrollPosition(positions, 'note-2', 0);
captureScrollPosition(positions, null, 90);

assert.deepEqual(
  positions,
  { 'note-1': 120 },
  'captureScrollPosition should store only positive scroll offsets for a note'
);
assert.equal(getSavedScrollTop(positions, 'note-1'), 120);
assert.equal(getSavedScrollTop(positions, 'note-unknown'), null);

const storage = createStorage();
writeScrollPositions(storage, 'scroll-cache', positions);
assert.deepEqual(
  readScrollPositions(storage, 'scroll-cache'),
  { 'note-1': 120 },
  'scroll positions should round-trip through storage'
);

const badStorage = createStorage();
badStorage.setItem('scroll-cache', '{bad');
assert.deepEqual(readScrollPositions(badStorage, 'scroll-cache'), {});

console.log('ok - editor scroll position helpers persist note offsets');
