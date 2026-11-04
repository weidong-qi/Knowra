import assert from 'node:assert/strict';
import { createEditorRuntime } from '../../src/app/editor-runtime.js';

const runtime = createEditorRuntime();

assert.deepEqual(runtime, {
  autosaveTimer: null,
  currentEditorHost: null,
  currentEditorNoteId: null,
  currentEditorMarkdown: null,
  pendingEditorNoteId: null,
  pendingEditorMarkdown: null,
  editorMountToken: 0
});

assert.notEqual(createEditorRuntime(), createEditorRuntime());

console.log('editor-runtime tests passed');
