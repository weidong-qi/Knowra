import assert from 'node:assert/strict';
import { renderEditorDocumentHead } from '../lib/editor/document-head-renderer.js';
import {
  renderLibraryIndexContent,
  renderLibraryIndexInspector,
  renderLibraryIndexScope
} from '../lib/library-index/renderers.js';

const scopeHtml = renderLibraryIndexScope({
  notes: [
    { updatedAt: '2026-07-17T11:00:00' },
    { updatedAt: '2026-07-16T10:00:00' }
  ],
  state: {
    selectedFolderId: 'folder-test',
    foldersById: {
      'folder-test': { id: 'folder-test', name: '研究方法', parentId: null },
      'folder-child': { id: 'folder-child', name: '阅读', parentId: 'folder-test' }
    },
    libraryIndex: { tab: 'all' }
  }
});

assert.match(scopeHtml, /<span class="scope-label">浏览范围<\/span>/);
assert.match(scopeHtml, /<strong title="研究方法">研究方法<\/strong>/);
assert.doesNotMatch(scopeHtml, /文件夹 2/);
assert.match(scopeHtml, /<span class="scope-label">最近更新<\/span>[\s\S]*<time>2026\.07\.17 11:00<\/time>/);

const html = renderEditorDocumentHead({
  note: {
    id: 'note-a',
    title: 'Saved title',
    folderId: 'folder-test',
    status: 'draft',
    tagIds: [],
    createdAt: '2026-07-17T10:00:00.000Z',
    updatedAt: '2026-07-17T11:00:00.000Z'
  },
  state: {
    draftTitle: 'Editable title',
    tags: [],
    foldersById: {
      'folder-test': { id: 'folder-test', name: 'test', parentId: null }
    },
    allNotes: [{ id: 'note-a', deleted: false, updatedAt: '2026-07-17T11:00:00.000Z' }]
  }
});

assert.match(html, /data-document-title-input/);
assert.match(html, /value="Editable title"/);
assert.doesNotMatch(html, /<h1>Saved title<\/h1>/);
assert.match(html, /class="document-breadcrumb" aria-label="资料路径">[\s\S]*资料库[\s\S]*test[\s\S]*aria-current="page"[\s\S]*Editable title/);
assert.doesNotMatch(html, /资料库　\/　资料/);
assert.doesNotMatch(html, /class="document-id"|>001</);
assert.match(html, /class="document-title-row">[\s\S]*class="document-title"[\s\S]*class="document-title-input"/);

const inspectorHtml = renderLibraryIndexInspector({
  note: {
    id: 'note-a',
    title: 'Current title',
    folderId: null,
    status: 'draft',
    sourceType: 'pdf-import',
    tagIds: ['tag-a'],
    internalLinks: ['note-b'],
    rawMarkdown: '# Current title\n\n## Details',
    createdAt: '2026-07-17T10:00:00.000Z',
    updatedAt: '2026-07-17T11:00:00.000Z',
    deleted: false,
    favorite: false
  },
  state: {
    libraryIndex: { inspectorOpen: true },
    tags: [{ id: 'tag-a', name: '方法' }],
    foldersById: {},
    allNotes: [
      { id: 'note-a', deleted: false, updatedAt: '2026-07-17T11:00:00.000Z' },
      { id: 'note-b', title: 'Linked note', deleted: false, updatedAt: '2026-07-17T11:00:00.000Z' }
    ],
    selectedNoteId: 'note-a',
    attachments: [{ id: 'attachment-a', fileName: 'diagram.png', mimeType: 'image/png' }]
  }
});

const emptyInspectorHtml = renderLibraryIndexInspector({
  note: null,
  state: {
    libraryIndex: { inspectorOpen: true },
    tags: [],
    foldersById: {},
    allNotes: [],
    selectedNoteId: null,
    attachments: []
  }
});

const closedInspectorHtml = renderLibraryIndexInspector({
  note: null,
  state: {
    libraryIndex: { inspectorOpen: false },
    tags: [],
    foldersById: {},
    allNotes: [],
    selectedNoteId: null,
    attachments: []
  }
});

assert.match(inspectorHtml, /class="inspector-head panel-head"/);
assert.match(inspectorHtml, /class="panel-close"[^>]*aria-expanded="true"[^>]*aria-controls="library-index-inspector"[^>]*aria-label="收起详情"[\s\S]*class="semantic-icon panel-close-icon"[\s\S]*data-icon="navigationChevron"/);
assert.match(emptyInspectorHtml, /class="panel-close"[^>]*aria-expanded="true"[^>]*aria-controls="library-index-inspector"[^>]*aria-label="收起详情"[\s\S]*class="semantic-icon panel-close-icon"[\s\S]*data-icon="navigationChevron"/);
assert.match(closedInspectorHtml, /class="reopen-panel"[^>]*data-index-inspector-open[^>]*aria-expanded="false"[^>]*aria-controls="library-index-inspector"[^>]*aria-label="展开详情"/);
assert.match(inspectorHtml, /class="index-inspector-content"/);
assert.match(emptyInspectorHtml, /class="index-inspector-content"/);
assert.doesNotMatch(inspectorHtml, />›</);
assert.doesNotMatch(emptyInspectorHtml, />›</);
assert.match(inspectorHtml, /class="panel-head-title"[\s\S]*资料详情/);
assert.match(inspectorHtml, /class="semantic-icon inspector-head-icon"[\s\S]*data-icon="sectionFile"[\s\S]*remix\/file-text-line\.svg/);
assert.match(inspectorHtml, /class="inspector-open-button"[^>]*data-index-open="note-a"/);
assert.match(inspectorHtml, /class="semantic-icon inspector-open-icon"[\s\S]*data-icon="inspectorOpen"[\s\S]*remix\/external-link-line\.svg/);
assert.match(inspectorHtml, /<span>打开<\/span>/);
assert.match(inspectorHtml, /<dt>类型<\/dt><dd>PDF 导入<\/dd>/);
assert.match(inspectorHtml, /<div class="inspector-tag-wrap tag-row"><span>方法<\/span><\/div>/);
assert.match(inspectorHtml, /class="relation-link"[^>]*data-index-open="note-b"[^>]*aria-label="打开关联资料：Linked note"/);
assert.match(inspectorHtml, /data-attachment-open="attachment-a"[^>]*aria-label="打开附件：diagram\.png"/);
assert.match(inspectorHtml, /<b>关联笔记<\/b><\/span><span><small>1<\/small>/);
assert.match(inspectorHtml, /<b>内容大纲<\/b><\/span><span><small>2<\/small>/);
assert.match(inspectorHtml, /<b>附件<\/b><\/span><span><small>1<\/small>/);
assert.doesNotMatch(inspectorHtml, /<svg class="inspector-open-icon"/);
assert.doesNotMatch(inspectorHtml, /primary-button inspector-action/);
assert.doesNotMatch(inspectorHtml, /MARKDOWN DOCUMENT/);
assert.doesNotMatch(inspectorHtml, /<dt>标题<\/dt>/);

const indexHtml = renderLibraryIndexContent({
  notes: [{
    id: 'note-a',
    title: 'Current title',
    status: 'draft',
    sourceType: 'manual',
    tagIds: ['tag-a'],
    rawMarkdown: '# Current title',
    updatedAt: '2026-07-17T11:00:00.000Z',
    deleted: false
  }],
  pagination: { page: 1, pageSize: 10, totalItems: 1, totalPages: 1, startIndex: 0 },
  state: {
    libraryIndex: { selectedNoteId: 'note-a' },
    tags: [{ id: 'tag-a', name: '方法' }]
  }
});

assert.match(indexHtml, /class="entry-archive" role="img" aria-label="资料类型图标"/);
assert.match(indexHtml, /class="semantic-icon entry-book-cover"[\s\S]*data-icon="noteManual"[\s\S]*remix\/edit-2-line\.svg/);
assert.doesNotMatch(indexHtml, /ARCHIVE|entry-archive-number/);
assert.match(indexHtml, /class="entry-list index-list-card"/);
assert.match(indexHtml, /class="entry-source-type">手动笔记<\/span>/);
assert.doesNotMatch(indexHtml, /entry-reading/);
assert.match(indexHtml, /data-selected="true"/);
assert.match(indexHtml, /<div class="tag-row"><span>方法<\/span><span class="entry-source-type">手动笔记<\/span><\/div>/);
assert.match(indexHtml, /aria-label="打开资料：Current title"/);
assert.match(indexHtml, /class="semantic-icon entry-action-icon"[\s\S]*data-icon="inspectorOpen"[\s\S]*remix\/external-link-line\.svg/);

console.log('ok - editor document head and inspector render their separated title entry points');
