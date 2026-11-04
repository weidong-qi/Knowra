import assert from 'node:assert/strict';

import { createEditorShortcutCommandController } from '../../src/controllers/editor/commands/shortcut-controller.js';

function makeElement(matcher) {
  return {
    closest(selector) {
      return matcher(selector);
    }
  };
}

const controller = createEditorShortcutCommandController({
  state: { view: { showSourceEditor: false } },
  editorRuntime: {
    currentEditorHost: {
      async run() {},
      async focus() {}
    }
  },
  getCurrentNote: () => ({ id: 'note-1' })
});

const editorSurface = makeElement((selector) => (selector === '#editor-content' ? {} : null));
assert.equal(
  controller.shouldHandleEditorShortcut({ target: { parentElement: editorSurface } }),
  true,
  'shortcut controller should accept text-node-like targets inside the editor'
);

const panelSurface = makeElement((selector) => (selector === '#editor-utility-panel' ? {} : null));
assert.equal(
  controller.shouldHandleEditorShortcut({ target: { parentElement: panelSurface } }),
  false,
  'shortcut controller should ignore text-node-like targets inside the utility panel'
);

const codeMirrorSurface = makeElement((selector) => (
  selector === '.milkdown-code-block .cm-editor' || selector === '#editor-content'
    ? {}
    : null
));
assert.equal(
  controller.shouldHandleEditorShortcut({ target: { parentElement: codeMirrorSurface } }),
  false,
  'CodeMirror should own shortcuts while the official Milkdown code block is focused'
);

console.log('ok - editor shortcut controller accepts text-node-like targets safely');
