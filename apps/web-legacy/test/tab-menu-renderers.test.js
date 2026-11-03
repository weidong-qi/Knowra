import assert from 'node:assert/strict';
import {
  NOTE_TAB_MENU_ITEMS,
  renderNoteTabMenuItems
} from '../lib/editor/tab-menu-renderers.js';

const html = renderNoteTabMenuItems();

assert.deepEqual(
  NOTE_TAB_MENU_ITEMS.map((item) => item.action ?? item.type),
  ['close', 'close-others', 'divider', 'copy-path']
);
assert.match(html, /data-tab-menu-action="close"[\s\S]*关闭/);
assert.match(html, /data-tab-menu-action="close-others"[\s\S]*关闭其他/);
assert.match(html, /note-tab-menu-divider/);
assert.match(html, /data-tab-menu-action="copy-path"[\s\S]*复制路径/);

console.log('ok - note tab menu renderers expose stable menu actions');
