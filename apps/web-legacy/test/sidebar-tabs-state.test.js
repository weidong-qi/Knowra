import assert from 'node:assert/strict';
import {
  ASIDE_TABS,
  resolveAsideContentKey
} from '../lib/sidebar/tabs.js';

assert.deepEqual(
  ASIDE_TABS.map((tab) => tab.key),
  ['info', 'outline', 'concepts', 'ai']
);

assert.equal(resolveAsideContentKey({ note: null, activeTab: 'info' }), 'empty');
assert.equal(resolveAsideContentKey({ note: { id: 'note-1' }, activeTab: 'outline' }), 'outline');
assert.equal(resolveAsideContentKey({ note: { id: 'note-1' }, activeTab: 'concepts' }), 'concepts');
assert.equal(resolveAsideContentKey({ note: { id: 'note-1' }, activeTab: 'ai' }), 'ai');
assert.equal(resolveAsideContentKey({ note: { id: 'note-1' }, activeTab: 'unknown' }), 'info');

console.log('ok - sidebar tab state resolves stable content keys');
