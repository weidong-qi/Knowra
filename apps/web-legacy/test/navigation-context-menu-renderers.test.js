import assert from 'node:assert/strict';
import { renderContextMenuItems } from '../lib/navigation/context-menu-renderers.js';

function runTest(name, callback) {
  try {
    callback();
    console.log(`ok - ${name}`);
  } catch (error) {
    console.error(`not ok - ${name}`);
    throw error;
  }
}

runTest('renderContextMenuItems renders action buttons and dividers', () => {
  const html = renderContextMenuItems([
    { action: 'rename-note', label: '重命名' },
    { type: 'divider' },
    { action: 'delete-note', label: '删除' }
  ]);

  assert.match(html, /data-context-action="rename-note"/);
  assert.match(html, /class="library-context-divider"/);
  assert.match(html, /data-context-action="delete-note"/);
});

runTest('renderContextMenuItems escapes labels and actions', () => {
  const html = renderContextMenuItems([
    { action: 'x" autofocus="true', label: '<删除&>' }
  ]);

  assert.match(html, /data-context-action="x&quot; autofocus=&quot;true"/);
  assert.match(html, /&lt;删除&amp;&gt;/);
  assert.doesNotMatch(html, /<删除&>/);
});

runTest('renderContextMenuItems ignores malformed entries', () => {
  const html = renderContextMenuItems([
    null,
    {},
    { type: 'divider' },
    { action: 'create-note-root', label: '新建文件' }
  ]);

  assert.match(html, /library-context-divider/);
  assert.match(html, /data-context-action="create-note-root"/);
  assert.doesNotMatch(html, /data-context-action="undefined"/);
});
