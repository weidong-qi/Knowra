import assert from 'node:assert/strict';
import { renderInfoTab, renderNoteTagComposer } from '../lib/sidebar/info-panel.js';

const note = {
  id: 'note-1',
  title: '<笔记>',
  folderId: 'folder-1',
  tagIds: ['tag-1'],
  rawMarkdown: '# 标题\n\n正文',
  updatedAt: '2026-06-24T08:00:00.000Z',
  createdAt: '2026-06-23T08:00:00.000Z',
  favorite: true
};

const tags = [
  { id: 'tag-1', name: '<已选>', color: '#ffcc00' },
  { id: 'tag-2', name: 'JavaScript', color: '#3c68ff' },
  { id: 'tag-3', name: 'Journal', color: '#33aa66' }
];

const html = renderInfoTab({
  note,
  markdown: note.rawMarkdown,
  folderPath: 'Root / <Folder>',
  tags,
  tagComposer: { draft: 'java', isExpanded: true },
  linkedNotes: [{ id: 'linked-1', title: '<关联>', summary: '<摘要>' }],
  attachments: [{ id: 'attachment-1', fileName: '<附件>.md', mimeType: 'text/markdown' }],
  formatDate: (value) => `date:${value.slice(0, 10)}`
});

assert.match(html, /&lt;笔记&gt;/);
assert.match(html, /Root \/ &lt;Folder&gt;/);
assert.match(html, /<dt>字数<\/dt><dd>4<\/dd>/);
assert.match(html, /<h3>资料信息<\/h3>/);
assert.match(html, /<h3>标签<\/h3>/);
assert.match(html, /date:2026-06-24/);
assert.match(html, /已收藏/);
assert.match(html, /data-note-tag-remove="tag-1"/);
assert.match(html, /value="java"/);
assert.match(html, /data-note-tag-add="tag-2"/);
assert.match(html, /data-note-tag-create/);
assert.match(html, /&lt;关联&gt;[\s\S]*&lt;摘要&gt;/);
assert.match(html, /data-attachment-id="attachment-1"/);
assert.match(html, /data-attachment-open="attachment-1"/);
assert.match(html, /未引用/);

const collapsedComposer = renderNoteTagComposer({
  note,
  tags,
  tagComposer: { draft: '', isExpanded: false }
});

assert.match(collapsedComposer, /收起|添加标签/);
assert.doesNotMatch(collapsedComposer, /data-note-tag-input/);

console.log('ok - sidebar info panel renders note metadata and tag composer');
