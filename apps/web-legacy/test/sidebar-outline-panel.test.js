import assert from 'node:assert/strict';
import { renderOutlineTab } from '../lib/sidebar/outline-panel.js';

const html = renderOutlineTab({
  noteId: 'note-1',
  headings: [
    { id: 'intro', index: 0, level: 1, title: '<Intro>' },
    { id: 'deep', index: 1, level: 3, title: 'Deep Dive' }
  ]
});

assert.match(html, /DOCUMENT MAP/);
assert.match(html, /<strong>2 个标题<\/strong>/);
assert.match(html, /data-outline-id="intro"/);
assert.match(html, /data-outline-index="1"/);
assert.match(html, /data-level="3"/);
assert.match(html, /data-outline-toggle-id="intro"/);
assert.match(html, /data-outline-note-id="note-1"/);
assert.match(html, /class="outline-toggle-glyph"[\s\S]*class="semantic-icon outline-toggle-icon"[\s\S]*data-icon="disclosureChevron"[\s\S]*remix\/arrow-down-s-line\.svg/);
assert.match(html, /<span class="outline-item-level">H3<\/span>/);
assert.match(html, /&lt;Intro&gt;/);

const collapsedHtml = renderOutlineTab({
  noteId: 'note-1',
  collapsedHeadingIds: { intro: true },
  headings: [
    { id: 'intro', index: 0, level: 1, title: 'Intro' },
    { id: 'child', index: 1, level: 2, title: 'Child' },
    { id: 'sibling', index: 2, level: 1, title: 'Sibling' }
  ]
});

assert.match(collapsedHtml, /data-collapsed="true"/);
assert.doesNotMatch(collapsedHtml, /data-outline-id="child"/);
assert.match(collapsedHtml, /data-outline-id="sibling"/);

assert.match(
  renderOutlineTab({ headings: [] }),
  /当前笔记还没有标题/,
  'outline panel should show an empty state when no headings exist'
);

console.log('ok - sidebar outline panel renders hierarchy and collapsible heading links');
