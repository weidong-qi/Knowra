import assert from 'node:assert/strict';
import {
  getEditorShortcutLabel,
  resolveEditorShortcutAction
} from '../lib/editor/shortcut-actions.js';

assert.equal(getEditorShortcutLabel('bold'), 'Ctrl+B');
assert.equal(getEditorShortcutLabel('code'), 'Ctrl+E');
assert.equal(getEditorShortcutLabel('paragraph'), 'Ctrl+0');
assert.equal(getEditorShortcutLabel('heading-6'), '');
assert.equal(getEditorShortcutLabel('ordered'), 'Ctrl+Shift+{');
assert.equal(getEditorShortcutLabel('bullet'), 'Ctrl+Shift+}');
assert.equal(getEditorShortcutLabel('highlight'), 'Ctrl+Shift+H');
assert.equal(getEditorShortcutLabel('outdent'), 'Shift+Tab');
assert.equal(getEditorShortcutLabel('missing'), '');

assert.equal(
  resolveEditorShortcutAction({ key: 'Tab' }),
  'indent',
  'Tab should trigger indent inside the editor surface'
);
assert.equal(
  resolveEditorShortcutAction({ key: 'Tab', shiftKey: true }),
  'outdent',
  'Shift+Tab should trigger outdent inside the editor surface'
);
assert.equal(
  resolveEditorShortcutAction({ key: '0', ctrlKey: true }),
  'paragraph',
  'Ctrl+0 should reset the current block to H0/paragraph'
);

assert.equal(
  resolveEditorShortcutAction({ key: 'b', ctrlKey: true }),
  'bold',
  'Ctrl+B should trigger bold'
);
assert.equal(
  resolveEditorShortcutAction({ key: 'e', ctrlKey: true }),
  'code',
  'Ctrl+E should trigger inline code'
);
assert.equal(
  resolveEditorShortcutAction({ key: 'E', metaKey: true }),
  'code',
  'Cmd+E should trigger inline code on mac-style modifier handling'
);
assert.equal(
  resolveEditorShortcutAction({ key: '4', ctrlKey: true }),
  'heading-4',
  'Ctrl+4 should trigger H4'
);
assert.equal(
  resolveEditorShortcutAction({ key: '6', metaKey: true }),
  null,
  'H5 and H6 shortcuts should be removed from the supported heading hierarchy'
);
assert.equal(
  resolveEditorShortcutAction({ key: '{', ctrlKey: true, shiftKey: true }),
  'ordered',
  'Ctrl+Shift+{ should trigger ordered list'
);
assert.equal(
  resolveEditorShortcutAction({ key: '}', ctrlKey: true, shiftKey: true }),
  'bullet',
  'Ctrl+Shift+} should trigger bullet list'
);
assert.equal(
  resolveEditorShortcutAction({ key: 'h', ctrlKey: true, shiftKey: true }),
  'highlight',
  'Ctrl+Shift+H should trigger highlight'
);
assert.equal(
  resolveEditorShortcutAction({ code: 'KeyH', ctrlKey: true, shiftKey: true }),
  'highlight',
  'Ctrl+Shift+H physical key should also reach the highlight shortcut path'
);
assert.equal(
  resolveEditorShortcutAction({ code: 'BracketLeft', ctrlKey: true, shiftKey: true }),
  'ordered',
  'Ctrl+Shift+[ physical key should also reach the ordered-list shortcut path'
);
assert.equal(
  resolveEditorShortcutAction({ code: 'BracketRight', ctrlKey: true, shiftKey: true }),
  'bullet',
  'Ctrl+Shift+] physical key should also reach the bullet-list shortcut path'
);
assert.equal(
  resolveEditorShortcutAction({ key: '7', ctrlKey: true, shiftKey: true }),
  null,
  'legacy ordered-list shortcut should no longer be used'
);
assert.equal(
  resolveEditorShortcutAction({ key: '8', ctrlKey: true, shiftKey: true }),
  null,
  'legacy bullet-list shortcut should no longer be used'
);
assert.equal(
  resolveEditorShortcutAction({ key: 'b', ctrlKey: true, altKey: true }),
  null,
  'Alt-modified shortcuts should be ignored'
);
assert.equal(
  resolveEditorShortcutAction({ key: 'v', ctrlKey: true }),
  null,
  'native clipboard shortcuts should not be overridden here'
);
assert.equal(
  resolveEditorShortcutAction({ key: 'Tab', isComposing: true }),
  null,
  'IME composition should suppress editor shortcuts so candidate confirmation is not hijacked'
);
assert.equal(
  resolveEditorShortcutAction({ key: 'b', ctrlKey: true, keyCode: 229 }),
  null,
  'legacy IME keyCode 229 should also suppress editor shortcuts'
);

console.log('ok - editor shortcut actions resolve expected defaults');
