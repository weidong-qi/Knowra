import assert from 'node:assert/strict';
import {
  resolveEditorPanelKeyboardAction,
  resolveMatchNavigationIndex
} from '../lib/editor/find-navigation.js';

assert.equal(
  resolveMatchNavigationIndex({ currentIndex: -1, matchCount: 3, direction: 'next' }),
  0,
  'a fresh forward search should land on the first match'
);
assert.equal(
  resolveMatchNavigationIndex({ currentIndex: 1, matchCount: 3, direction: 'next' }),
  2,
  'forward search should advance to the next match'
);
assert.equal(
  resolveMatchNavigationIndex({ currentIndex: 0, matchCount: 3, direction: 'previous' }),
  2,
  'backward search should wrap to the last match'
);
assert.equal(
  resolveMatchNavigationIndex({ currentIndex: 2, matchCount: 3, direction: 'previous' }),
  1,
  'backward search should move to the previous match'
);

assert.equal(
  resolveEditorPanelKeyboardAction({ key: 'F3', shiftKey: false, altKey: false, ctrlKey: false, metaKey: false }),
  'next',
  'F3 should find the next match'
);
assert.equal(
  resolveEditorPanelKeyboardAction({ key: 'F3', shiftKey: true, altKey: false, ctrlKey: false, metaKey: false }),
  'previous',
  'Shift+F3 should find the previous match'
);
assert.equal(
  resolveEditorPanelKeyboardAction({ key: 'F3', shiftKey: false, altKey: false, ctrlKey: true, metaKey: false }),
  null,
  'Ctrl+F3 should be ignored'
);
assert.equal(
  resolveEditorPanelKeyboardAction({ key: 'F3', shiftKey: false, altKey: true, ctrlKey: false, metaKey: false }),
  null,
  'Alt+F3 should be ignored'
);
assert.equal(
  resolveEditorPanelKeyboardAction({ key: 'ArrowDown', shiftKey: false, altKey: false, ctrlKey: false, metaKey: false }),
  null,
  'ArrowDown should be ignored (no conflict with cursor movement)'
);
assert.equal(
  resolveEditorPanelKeyboardAction({ key: 'ArrowUp', shiftKey: false, altKey: false, ctrlKey: false, metaKey: false }),
  null,
  'ArrowUp should be ignored (no conflict with cursor movement)'
);
assert.equal(
  resolveEditorPanelKeyboardAction({ key: 'Enter', shiftKey: false, altKey: false, ctrlKey: false, metaKey: false }),
  null,
  'plain Enter should be ignored (no conflict with new line)'
);
assert.equal(
  resolveEditorPanelKeyboardAction({ key: 'Escape', shiftKey: false, altKey: false, ctrlKey: false, metaKey: false }),
  null,
  'other keys should be ignored'
);

console.log('ok - editor find behavior resolves navigation direction correctly');
