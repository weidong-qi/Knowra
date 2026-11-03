import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderHtml } from '../src/server/shell-html.js';
import {
  renderNoteTabs,
  renderTabOverflowMenu
} from '../lib/editor/tab-renderers.js';
import {
  partitionTabsForOverflow,
  resolveTabCapacity
} from '../lib/editor/tab-overflow.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const editorCss = fs.readFileSync(
  path.resolve(__dirname, '../styles/components/knowra-inkgrid-editor.css'),
  'utf8'
);
const shellHtml = renderHtml();

const notes = Array.from({ length: 9 }, (_, index) => ({
  id: `note-${index + 1}`,
  title: index === 8
    ? '这是一个用于验证文档标签长标题省略行为的资料名称'
    : `资料 ${index + 1}`,
  folderId: null
}));

const capacity = resolveTabCapacity({
  containerWidth: 560,
  minimumTabWidth: 112,
  overflowControlWidth: 35,
  tabCount: notes.length
});
assert.equal(capacity, 4, 'nine tabs should reserve a stable overflow control');

const partitioned = partitionTabsForOverflow(notes, 'note-9', capacity);
assert.equal(partitioned.visibleNotes.length, 4);
assert.equal(partitioned.overflowNotes.length, 5);
assert.equal(partitioned.visibleNotes.at(-1)?.id, 'note-9', 'the active tab must remain visible');

const tabMarkup = renderNoteTabs({
  notes: partitioned.visibleNotes,
  selectedNoteId: 'note-9',
  saveState: 'pending',
  tabDragState: { activeId: 'note-1', overId: 'note-9' },
  foldersById: {},
  buildNoteTabPath: (note) => `资料 / ${note.title}`
});
const overflowMarkup = renderTabOverflowMenu({
  notes: partitioned.overflowNotes,
  selectedNoteId: 'note-9',
  foldersById: {},
  buildNoteTabPath: (note) => `资料 / ${note.title}`
});

assert.equal((tabMarkup.match(/class="note-tab"/g) ?? []).length, 4);
assert.equal((overflowMarkup.match(/data-tab-overflow-note-id=/g) ?? []).length, 5);
assert.match(tabMarkup, /class="note-tab-select"[\s\S]*role="tab"/);
assert.match(tabMarkup, /aria-selected="true"/);
assert.equal((tabMarkup.match(/id="note-tab-[^"]+"/g) ?? []).length, 4);
assert.equal((tabMarkup.match(/aria-controls="editor-scroll-region"/g) ?? []).length, 4);
assert.match(tabMarkup, /data-icon="noteMarkdown"/);
assert.match(tabMarkup, /class="note-tab-close"/);
assert.match(tabMarkup, /data-dirty="true"/);
assert.match(tabMarkup, /这是一个用于验证文档标签长标题省略行为的资料名称/);
assert.match(overflowMarkup, /role="menuitemradio"/);
assert.match(overflowMarkup, /aria-checked="false"/);

assert.match(shellHtml, /id="note-tabs" role="tablist" aria-label="已打开的资料"/);
assert.match(shellHtml, /id="note-tab-overflow-toggle-host"/);
assert.match(shellHtml, /id="note-tab-overflow-menu" role="menu"/);
assert.match(shellHtml, /id="editor-scroll-region" role="tabpanel"/);
assert.match(editorCss, /\.document-tabs \.note-tab\s*\{[^}]*min-width:\s*var\(--document-tab-min-width\)/);
assert.match(editorCss, /\.document-tabs\s*\{[^}]*z-index:\s*60/);
assert.match(editorCss, /\.kb-workspace\[data-editor-layout='protected'\][\s\S]*?inset:\s*var\(--document-tab-height\) 0 0 auto/);
assert.match(editorCss, /\.document-tabs \.note-tab-select\s*\{[^}]*min-width:\s*0/);
assert.match(editorCss, /\.document-tabs \.note-tab-label\s*\{[^}]*text-overflow:\s*ellipsis/);
assert.match(editorCss, /\.document-tabs \.note-tab-close\s*\{[^}]*opacity:\s*0/);
assert.match(editorCss, /\.document-tabs \.note-tab:hover \.note-tab-close/);
assert.match(editorCss, /\.note-tab-overflow-menu\s*\{[^}]*width:\s*var\(--rail-width\)/);
assert.match(editorCss, /\.kb-workspace:has\(\.note-tab-overflow-menu:not\(\[hidden\]\)\) \.editor-inspector\s*\{[^}]*pointer-events:\s*none/);
assert.match(editorCss, /\.note-tab-menu-item:hover\s*\{[^}]*background:\s*var\(--blue\)/);

console.log('ok - M4-02 document tabs preserve nine-tab overflow and InkGrid contracts');
