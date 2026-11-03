import assert from 'node:assert/strict';

import {
  renderDeleteIntentRow,
  renderEmptyTreeItem,
  renderInlineEditorRow,
  renderNavigationSection,
  renderNoteNode,
  renderRecycleNoteNode
} from '../lib/navigation/tree-renderers.js';

const note = { id: 'note-1', title: 'Note <One>', sourceType: 'markdown-import' };

const sectionHtml = renderNavigationSection({
  key: 'materials',
  label: '资料',
  count: 2,
  children: '<div>child</div>',
  open: true,
  isDropTarget: true
});

assert.match(sectionHtml, /data-nav-section="materials"/);
assert.match(sectionHtml, /data-materials-section="true"/);
assert.match(sectionHtml, /data-drop-target="true"/);
assert.match(sectionHtml, /<div>child<\/div>/);

const noteHtml = renderNoteNode({
  note,
  level: 2,
  selected: true,
  isDragging: false,
  iconKind: 'markdown'
});

assert.match(noteHtml, /data-note-id="note-1"/);
assert.match(noteHtml, /data-selected="true"/);
assert.match(noteHtml, /Note &lt;One&gt;/);

const recycleHtml = renderRecycleNoteNode({ note, level: 1, iconKind: 'markdown' });
assert.match(recycleHtml, /data-recycle-note-id="note-1"/);

const inlineHtml = renderInlineEditorRow({ level: 1, mode: 'create-folder', value: 'Draft' });
assert.match(inlineHtml, /data-inline-editor-form/);
assert.match(inlineHtml, /输入目录名称/);
assert.match(inlineHtml, /library-inline-action-primary">保存/);

const deleteHtml = renderDeleteIntentRow({ level: 2, kind: 'note', targetId: 'note-1', name: 'Note <One>' });
assert.match(deleteHtml, /data-delete-confirm="note"/);
assert.match(deleteHtml, /Note &lt;One&gt;/);

assert.match(renderEmptyTreeItem('暂无目录'), /暂无目录/);

console.log('ok - navigation tree renderers preserve left tree hooks');
