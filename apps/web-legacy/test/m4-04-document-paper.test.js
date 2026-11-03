import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { renderEditorDocumentHead } from '../lib/editor/document-head-renderer.js';
import { renderRichEditorHost } from '../lib/editor/view-renderers.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const readStyle = (name) => fs.readFileSync(
  path.resolve(__dirname, `../styles/components/${name}`),
  'utf8'
);

const tokens = readStyle('knowra-theme-tokens.css');
const editor = readStyle('knowra-inkgrid-editor-paper.css');
const html = renderEditorDocumentHead({
  note: {
    id: 'note-m4-04',
    title: '原始标题',
    folderId: 'folder-child',
    sourceType: 'markdown-import',
    status: 'draft',
    tagIds: ['tag-a', 'tag-b'],
    createdAt: '2026-08-01T10:00:00.000Z',
    updatedAt: '2026-08-10T11:30:00.000Z'
  },
  state: {
    draftTitle: '可编辑的长中文资料标题',
    tags: [
      { id: 'tag-a', name: '多模态' },
      { id: 'tag-b', name: '注意力机制' }
    ],
    foldersById: {
      'folder-root': { id: 'folder-root', name: '研究资料', parentId: null },
      'folder-child': { id: 'folder-child', name: '长路径目录', parentId: 'folder-root' }
    }
  }
});

assert.match(html, /<nav class="document-breadcrumb" aria-label="资料路径">/);
assert.match(html, /<ol class="breadcrumb">[\s\S]*资料库[\s\S]*研究资料[\s\S]*长路径目录[\s\S]*aria-current="page"[\s\S]*可编辑的长中文资料标题/);
assert.match(html, /class="document-status" data-document-status="draft"[\s\S]*待整理/);
assert.match(html, /<time datetime="2026-08-01T10:00:00\.000Z">/);
assert.match(html, /<time datetime="2026-08-10T11:30:00\.000Z">/);
assert.match(html, /class="document-title-kicker"[\s\S]*data-icon="sectionFile"[\s\S]*MD 导入[\s\S]*知识资料/);
assert.match(html, /data-document-title-input[\s\S]*value="可编辑的长中文资料标题"/);
assert.match(html, /class="document-tag-label">标签<[\s\S]*class="tag-row"><span>多模态<\/span><span>注意力机制<\/span>/);

assert.match(tokens, /--ink-editor-max-w:\s*760px;/, 'the formal reading measure should be 760px');
assert.match(editor, /\.document-head\s*\{[^}]*width:\s*min\(calc\(100% - var\(--space-16\)\), var\(--editor-max-width\)\)[^}]*margin-inline:\s*auto/, 'the document head should share the centered reading measure');
assert.match(editor, /\.editor-shell\s*\{[^}]*background-image:\s*radial-gradient\(var\(--ink-dot-grid\)/, 'the editor scroll surface should use the InkGrid paper grid');
assert.match(editor, /\.milkdown-host \.ProseMirror\s*\{[^}]*max-width:\s*var\(--editor-max-width\)[^}]*margin-inline:\s*auto/, 'Milkdown should keep its host and use the centered reading measure');
assert.match(editor, /\.preview-rendered\s*\{[^}]*max-width:\s*var\(--editor-max-width\)[^}]*margin-inline:\s*auto/, 'preview content should share the same reading measure');
assert.match(renderRichEditorHost(), /class="milkdown-host" id="milkdown-editor"/, 'the existing Milkdown host contract must remain unchanged');

console.log('ok - M4-04 document head and editor paper preserve the formal editing host');
