import assert from 'node:assert/strict';
import {
  renderPreviewPane,
  renderSourceEditorPane,
  renderSourceEditorView
} from '../lib/editor/preview-renderers.js';

const headings = [
  { id: 'intro', level: 2, title: '<Intro>' },
  { id: 'next"part', level: 3, title: 'Next' }
];

const previewHtml = '<p>Rendered</p>';
const preview = renderPreviewPane({ headings, previewHtml });

assert.match(preview, /class="preview-pane preview-frame"/);
assert.match(preview, /data-preview-toc/);
assert.match(preview, /href="#intro"[\s\S]*&lt;Intro&gt;/);
assert.match(preview, /href="#next&quot;part"/);
assert.match(preview, /data-preview-content><p>Rendered<\/p>/);

const emptyPreview = renderPreviewPane({ headings: [], previewHtml });
assert.doesNotMatch(emptyPreview, /data-preview-toc/);

const sourcePane = renderSourceEditorPane({ markdown: '<raw>' });
assert.match(sourcePane, /aria-label="Markdown 源码编辑器"/);
assert.match(sourcePane, /&lt;raw&gt;/);
assert.match(sourcePane, /data-source-save/);

const sourceView = renderSourceEditorView({ markdown: '"raw"' });
assert.match(sourceView, /aria-label="Markdown source editor"/);
assert.match(sourceView, /&quot;raw&quot;/);

console.log('ok - preview renderers build preview and source editor panes');
