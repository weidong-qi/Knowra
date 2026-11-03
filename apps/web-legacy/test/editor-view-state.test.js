import assert from 'node:assert/strict';
import { resolveEditorRenderState } from '../lib/editor/view-state.js';
import { renderRichEditorHost } from '../lib/editor/view-renderers.js';

const editView = {
  mode: 'edit',
  showSourceEditor: false
};

assert.deepEqual(
  resolveEditorRenderState({
    note: null,
    effectiveView: editView,
    currentEditorNoteId: null,
    hasCurrentEditorHost: false
  }),
  {
    kind: 'empty',
    sourceOpen: false,
    viewMode: 'edit',
    shouldTeardownHost: true,
    shouldCloseTableDialog: true
  }
);

assert.deepEqual(
  resolveEditorRenderState({
    note: { id: 'deleted-note', deleted: true },
    effectiveView: editView,
    currentEditorNoteId: 'deleted-note',
    hasCurrentEditorHost: true
  }),
  {
    kind: 'recycle',
    sourceOpen: false,
    viewMode: 'recycle',
    shouldTeardownHost: true,
    shouldCloseTableDialog: true
  }
);

assert.deepEqual(
  resolveEditorRenderState({
    note: { id: 'note-1', deleted: false },
    effectiveView: editView,
    currentEditorNoteId: 'note-1',
    hasCurrentEditorHost: true
  }),
  {
    kind: 'reuse-rich-editor',
    sourceOpen: false,
    viewMode: 'edit',
    shouldTeardownHost: false,
    shouldCloseTableDialog: false
  }
);

assert.deepEqual(
  resolveEditorRenderState({
    note: { id: 'note-1', deleted: false },
    effectiveView: { mode: 'read', showSourceEditor: false },
    currentEditorNoteId: 'note-1',
    hasCurrentEditorHost: true
  }).kind,
  'preview'
);

assert.deepEqual(
  resolveEditorRenderState({
    note: { id: 'note-1', deleted: false },
    effectiveView: {
      mode: 'focus',
      contentMode: 'read',
      showSourceEditor: false
    },
    currentEditorNoteId: null,
    hasCurrentEditorHost: false
  }),
  {
    kind: 'preview',
    sourceOpen: false,
    viewMode: 'focus',
    shouldTeardownHost: true,
    shouldCloseTableDialog: true
  },
  'focus entered from read mode should keep the non-editable preview'
);

assert.deepEqual(
  resolveEditorRenderState({
    note: { id: 'note-1', deleted: false },
    effectiveView: { mode: 'edit', showSourceEditor: true },
    currentEditorNoteId: 'note-1',
    hasCurrentEditorHost: true
  }).kind,
  'source-preview'
);

assert.deepEqual(
  resolveEditorRenderState({
    note: { id: 'note-2', deleted: false },
    effectiveView: editView,
    currentEditorNoteId: 'note-1',
    hasCurrentEditorHost: true
  }).kind,
  'mount-rich-editor'
);

assert.deepEqual(
  resolveEditorRenderState({
    note: { id: 'note-1', deleted: false },
    effectiveView: editView,
    currentEditorNoteId: 'note-1',
    hasCurrentEditorHost: true,
    currentEditorMarkdown: '',
    draftMarkdown: '# Full body'
  }).kind,
  'mount-rich-editor',
  'a summary-mounted empty host must not be reused after the full body arrives'
);

assert.deepEqual(
  resolveEditorRenderState({
    note: { id: 'note-1', deleted: false },
    effectiveView: editView,
    currentEditorNoteId: 'note-1',
    hasCurrentEditorHost: true,
    currentEditorMarkdown: '# Full body',
    draftMarkdown: '# Full body'
  }).kind,
  'reuse-rich-editor',
  'a host may be reused only when its mounted markdown matches the current draft'
);

const richHostHtml = renderRichEditorHost();
assert.match(richHostHtml, /editor-pane-single/);
assert.match(richHostHtml, /id="editor-utility-panel" hidden/);
assert.match(richHostHtml, /id="editor-table-dialog" hidden/);
assert.match(richHostHtml, /class="milkdown-host" id="milkdown-editor"/);

console.log('ok - editor view state resolves render modes');
