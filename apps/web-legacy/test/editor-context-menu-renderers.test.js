import assert from 'node:assert/strict';
import {
  EDITOR_CONTEXT_FORMAT_ACTIONS,
  EDITOR_CONTEXT_INSERT_ITEMS,
  EDITOR_CONTEXT_PARAGRAPH_ITEMS,
  EDITOR_CONTEXT_PRIMARY_ACTIONS,
  editorContextActionMeta
} from '../lib/editor/context-menu-model.js';
import { renderEditorContextIconSvg } from '../lib/editor/context-menu-icons.js';
import {
  renderEditorContextMenuItem,
  renderEditorContextMenuMarkup
} from '../lib/editor/context-menu-renderers.js';

const shortcutLabel = (action) => (action === 'bold' ? 'Ctrl+B' : '');
const html = renderEditorContextMenuMarkup({ getShortcutLabel: shortcutLabel });

assert.deepEqual(EDITOR_CONTEXT_PRIMARY_ACTIONS, ['cut', 'copy', 'paste', 'delete']);
assert.ok(EDITOR_CONTEXT_FORMAT_ACTIONS.includes('code'));
assert.ok(!EDITOR_CONTEXT_FORMAT_ACTIONS.includes('codeblock'));
assert.ok(EDITOR_CONTEXT_INSERT_ITEMS.includes('table'));
assert.ok(EDITOR_CONTEXT_INSERT_ITEMS.includes('image'));
assert.ok(EDITOR_CONTEXT_INSERT_ITEMS.includes('codeblock'));
assert.equal(editorContextActionMeta['heading-4'].label, 'H4');
assert.equal(editorContextActionMeta['heading-5'], undefined);
assert.deepEqual(EDITOR_CONTEXT_PARAGRAPH_ITEMS, ['paragraph', 'heading-1', 'heading-2', 'heading-3', 'heading-4']);
assert.equal(editorContextActionMeta.code.label, '行内代码');
assert.match(html, /editor-context-action-row-primary[\s\S]*data-editor-context-action="cut"/);
assert.match(html, /data-editor-context-action="bold"/);
assert.match(html, /data-editor-context-action="code"/);
assert.match(renderEditorContextMenuItem('bold', shortcutLabel), /data-editor-context-action="bold"[\s\S]*Ctrl\+B/);
assert.match(html, /<span>标题<\/span>[\s\S]*data-editor-context-action="heading-4"/);
assert.doesNotMatch(html, /data-editor-context-action="heading-[56]"/);
assert.match(html, /<span>插入<\/span>[\s\S]*data-editor-context-action="image"/);
assert.match(html, /<span>插入<\/span>[\s\S]*data-editor-context-action="codeblock"/);
assert.match(renderEditorContextIconSvg('cut'), /class="semantic-icon editor-context-glyph"[\s\S]*data-icon="editorCut"[\s\S]*remix\/scissors-2-line\.svg/);

console.log('ok - editor context menu renderers build menu markup and icons');
