import assert from 'node:assert/strict';
import { bindEditorContentEvents } from '../../lib/events/editor-content-events.js';
import { createRecorderElement } from '../_support/recorder-elements.js';

function makeTarget(selector, value) {
  const target = {
    value,
    closest(candidate) {
      return candidate === selector ? target : null;
    }
  };
  return target;
}

const editorContent = createRecorderElement();
const editorContextMenu = createRecorderElement();
const state = {
  view: { showSourceEditor: true },
  draftMarkdown: '旧正文'
};
const calls = {
  autosave: 0,
  preview: 0,
  sidebarNotes: [],
  persistOptions: []
};
const currentNote = { id: 'note-1' };

bindEditorContentEvents({
  state,
  elements: { editorContent, editorContextMenu },
  deps: {
    getCurrentEditorHost: () => null,
    getCurrentNote: () => currentNote,
    openEditorContextMenu: () => {},
    focusAnnotationFromMarker: () => {},
    handleEditorContextMenuAction: () => {},
    scheduleAutosave: () => { calls.autosave += 1; },
    syncSourcePreview: () => { calls.preview += 1; },
    persistDraft: (options) => { calls.persistOptions.push(options); },
    renderSidebar: (note) => { calls.sidebarNotes.push(note); }
  }
});

editorContent.dispatch(
  'input',
  makeTarget('[data-source-editor-input]', '# 新正文\n[链接](https://example.com)')
);

assert.equal(state.draftMarkdown, '# 新正文\n[链接](https://example.com)');
assert.equal(calls.autosave, 1);
assert.equal(calls.preview, 1);
assert.deepEqual(calls.sidebarNotes, [currentNote]);

editorContent.dispatch('click', makeTarget('[data-source-save]'));
assert.deepEqual(calls.persistOptions, [{ immediate: true }]);

console.log('ok - source editor input synchronizes preview and manual save persists immediately');
