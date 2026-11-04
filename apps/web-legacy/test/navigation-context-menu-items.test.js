import assert from 'node:assert/strict';
import { getContextMenuItems } from '../lib/navigation/context-menu.js';

function runTest(name, callback) {
  try {
    callback();
    console.log(`ok - ${name}`);
  } catch (error) {
    console.error(`not ok - ${name}`);
    throw error;
  }
}

runTest('getContextMenuItems returns root creation actions for materials', () => {
  assert.deepEqual(
    getContextMenuItems({ targetKind: 'materials' }).map((item) => item.action ?? item.type),
    ['create-folder-root', 'create-note-root']
  );
});

runTest('getContextMenuItems returns folder creation rename and delete actions', () => {
  assert.deepEqual(
    getContextMenuItems({ targetKind: 'folder' }).map((item) => item.action ?? item.type),
    ['create-folder-child', 'create-note-child', 'divider', 'rename-folder', 'delete-folder']
  );
});

runTest('getContextMenuItems returns active note favorite rename and delete actions', () => {
  const items = getContextMenuItems({
    targetKind: 'note',
    targetId: 'note-a',
    notes: [{ id: 'note-a', favorite: false, deleted: false }]
  });

  assert.deepEqual(items.map((item) => item.action ?? item.type), [
    'favorite-note',
    'divider',
    'rename-note',
    'delete-note'
  ]);
  assert.equal(items[0].label, '收藏笔记');
});

runTest('getContextMenuItems labels favorite notes as unfavorite', () => {
  const items = getContextMenuItems({
    targetKind: 'note',
    targetId: 'note-a',
    notes: [{ id: 'note-a', favorite: true, deleted: false }]
  });

  assert.equal(items[0].label, '取消收藏');
});

runTest('getContextMenuItems returns restore and permanent delete for deleted notes', () => {
  assert.deepEqual(
    getContextMenuItems({
      targetKind: 'note',
      targetId: 'note-a',
      notes: [{ id: 'note-a', deleted: true }]
    }).map((item) => item.action ?? item.type),
    ['restore-note', 'divider', 'permanently-delete-note']
  );
});

runTest('getContextMenuItems hides recycle section action when recycle bin is empty', () => {
  assert.deepEqual(
    getContextMenuItems({ targetKind: 'recycle-section', recycleNotes: [] }),
    []
  );
});

runTest('getContextMenuItems returns empty recycle bin action when deleted notes exist', () => {
  assert.deepEqual(
    getContextMenuItems({
      targetKind: 'recycle-section',
      recycleNotes: [{ id: 'note-deleted' }]
    }).map((item) => item.action),
    ['empty-recycle-bin']
  );
});

runTest('getContextMenuItems returns attachment jump/open/copy actions for referenced attachments', () => {
  assert.deepEqual(
    getContextMenuItems({
      targetKind: 'attachment',
      targetId: 'attachment-a',
      attachments: [{ id: 'attachment-a' }],
      markdown: '![diagram](/api/storage/attachments/attachment-a/content)'
    }).map((item) => item.action ?? item.type),
    ['jump-to-attachment-reference', 'remove-attachment-from-note', 'insert-attachment-at-cursor', 'divider', 'rename-attachment', 'open-attachment', 'copy-attachment-link']
  );
});

runTest('getContextMenuItems omits jump action for unreferenced attachments', () => {
  assert.deepEqual(
    getContextMenuItems({
      targetKind: 'attachment',
      targetId: 'attachment-a',
      attachments: [{ id: 'attachment-a' }],
      markdown: ''
    }).map((item) => item.action ?? item.type),
    ['insert-attachment-at-cursor', 'divider', 'rename-attachment', 'open-attachment', 'copy-attachment-link', 'divider', 'delete-attachment']
  );
});
