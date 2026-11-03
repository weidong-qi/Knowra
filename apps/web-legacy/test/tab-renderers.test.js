import assert from 'node:assert/strict';
import {
  renderEmptyNoteTabs,
  renderNoteTabs
} from '../lib/editor/tab-renderers.js';

assert.match(renderEmptyNoteTabs(), /note-tabs-empty/);
assert.match(renderEmptyNoteTabs(), /暂无打开的资料/);

const notes = [
  { id: 'note-1', title: 'Alpha <Draft>', folderId: 'folder-a' },
  { id: 'note-2', title: 'Beta', folderId: null }
];

const html = renderNoteTabs({
  notes,
  selectedNoteId: 'note-1',
  saveState: 'pending',
  tabDragState: {
    activeId: 'note-2',
    overId: 'note-1'
  },
  foldersById: new Map([['folder-a', { id: 'folder-a', name: 'A & B' }]]),
  buildNoteTabPath(note, foldersById) {
    const folder = foldersById.get(note.folderId);
    return folder ? `${folder.name} / ${note.title}` : note.title;
  }
});

assert.match(html, /data-tab-note-id="note-1"/);
assert.match(html, /data-active="true"/);
assert.match(html, /data-dirty="true"/);
assert.match(html, /data-drop-target="true"/);
assert.match(html, /title="A &amp; B \/ Alpha &lt;Draft&gt;"/);
assert.match(html, /Alpha &lt;Draft&gt;/);
assert.match(html, /<span class="note-tab-dirty" aria-hidden="true">●<\/span>/);
assert.match(html, /data-tab-note-id="note-2"/);
assert.match(html, /data-dragging="true"/);
assert.match(html, /data-dirty="false"/);
assert.match(html, /data-tab-close="note-2"/);
assert.match(html, /aria-label="关闭标签页"/);

console.log('ok - note tab renderers produce stable tab markup');
