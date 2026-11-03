import assert from 'node:assert/strict';
import {
  applyEditorPanelMatchResult,
  createOpenedEditorPanelState
} from '../lib/editor/editor-panel-state.js';

const opened = createOpenedEditorPanelState(
  {
    query: 'alpha',
    replacement: 'beta',
    autoFocusInput: false
  },
  'find'
);

assert.deepEqual(opened, {
  open: true,
  mode: 'find',
  query: 'alpha',
  replacement: 'beta',
  matchIndex: -1,
  matchCount: 0,
  autoFocusInput: true
});

const selected = applyEditorPanelMatchResult(opened, {
  index: 1,
  count: 3
});

assert.equal(selected.matchIndex, 1);
assert.equal(selected.matchCount, 3);
assert.equal(
  selected.autoFocusInput,
  false,
  'after selecting a match, the panel must not steal focus back from the editor'
);

console.log('ok - editor panel focus behavior preserves editor selection after find');
