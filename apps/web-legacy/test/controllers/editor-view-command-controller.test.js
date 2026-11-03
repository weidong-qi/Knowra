import assert from 'node:assert/strict';
import { createEditorViewCommandController } from '../../src/controllers/editor/commands/view-command-controller.js';

const state = {
  view: {
    mode: 'read',
    modeBeforeFocus: null,
    showLeftSidebar: true,
    showRightSidebar: true,
    showSourceEditor: true
  }
};
let renderCount = 0;
let closeCount = 0;
let focusCount = 0;
const previousDocument = globalThis.document;
globalThis.document = {
  querySelector(selector) {
    assert.equal(selector, '[data-status-action="toggle-focus"]');
    return { focus: () => { focusCount += 1; } };
  }
};

const controller = createEditorViewCommandController({
  state,
  getCurrentNote: () => ({ id: 'note-1' }),
  renderAll: () => { renderCount += 1; },
  flashStatus: () => {}
}, () => ({}), {
  closeEditorMenuBar: () => { closeCount += 1; }
});

await controller.handleViewMenuAction('toggle-focus');
assert.equal(state.view.mode, 'focus');
assert.equal(state.view.modeBeforeFocus, 'read');
assert.equal(state.view.showSourceEditor, true);
assert.equal(state.view.showLeftSidebar, true);
assert.equal(state.view.showRightSidebar, true);
assert.equal(focusCount, 1);

await controller.handleViewMenuAction('toggle-focus');
assert.equal(state.view.mode, 'read');
assert.equal(state.view.modeBeforeFocus, null);
assert.equal(state.view.showSourceEditor, true);
assert.equal(renderCount, 2);
assert.equal(closeCount, 2);
assert.equal(focusCount, 2);

await controller.handleViewMenuAction('toggle-focus');
await controller.handleViewMenuAction('toggle-source-editor');
assert.equal(state.view.mode, 'focus');
assert.equal(state.view.showSourceEditor, false);

state.view.mode = 'read';
state.view.modeBeforeFocus = null;
await controller.handleViewMenuAction('toggle-focus');
assert.equal(state.view.mode, 'focus');
assert.equal(state.view.modeBeforeFocus, 'read');

await controller.handleViewMenuAction('toggle-source-editor');
assert.equal(state.view.mode, 'focus');
assert.equal(state.view.modeBeforeFocus, 'edit');
assert.equal(state.view.showSourceEditor, true);

globalThis.document = previousDocument;

console.log('ok - editor view command controller restores focus, content mode and source layout preferences');
