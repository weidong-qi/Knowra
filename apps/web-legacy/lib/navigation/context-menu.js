import { closestFromEventTarget } from '../dom/event-target.js';
import { isAttachmentReferencedInMarkdown } from '../sidebar/attachments.js';

export function resolveContextMenuTarget(target) {
  const noteButton = closestFromEventTarget(target, '[data-note-id]');
  if (noteButton?.dataset.noteId) {
    return { kind: 'note', id: noteButton.dataset.noteId, selectFolderId: null };
  }

  const recycleNoteButton = closestFromEventTarget(target, '[data-recycle-note-id]');
  if (recycleNoteButton?.dataset.recycleNoteId) {
    return { kind: 'note', id: recycleNoteButton.dataset.recycleNoteId, selectFolderId: null };
  }

  const recycleSection = closestFromEventTarget(target, '[data-recycle-section]');
  if (recycleSection) {
    return { kind: 'recycle-section', id: 'recycle', selectFolderId: null };
  }

  const folderButton = closestFromEventTarget(target, '[data-folder-id]');
  if (folderButton?.dataset.folderId) {
    return {
      kind: 'folder',
      id: folderButton.dataset.folderId,
      selectFolderId: folderButton.dataset.folderId
    };
  }

  const materialsSection = closestFromEventTarget(target, '[data-materials-section]');
  if (materialsSection) {
    return { kind: 'materials', id: null, selectFolderId: null };
  }

  return null;
}

export function getContextMenuItems({
  targetKind = null,
  targetId = null,
  notes = [],
  recycleNotes = [],
  attachments = [],
  markdown = ''
} = {}) {
  switch (targetKind) {
    case 'materials':
      return [
        { action: 'create-folder-root', label: '新建目录' },
        { action: 'create-note-root', label: '新建文件' }
      ];
    case 'folder':
      return [
        { action: 'create-folder-child', label: '新建子目录' },
        { action: 'create-note-child', label: '新建文件' },
        { type: 'divider' },
        { action: 'rename-folder', label: '重命名' },
        { action: 'delete-folder', label: '删除' }
      ];
    case 'note':
      return getNoteMenuItems(notes.find((note) => note.id === targetId));
    case 'attachment':
      return getAttachmentMenuItems(attachments.find((attachment) => attachment.id === targetId), markdown);
    case 'recycle-section':
      return recycleNotes.length > 0
        ? [{ action: 'empty-recycle-bin', label: '清空回收站' }]
        : [];
    default:
      return [];
  }
}

function getAttachmentMenuItems(attachment, markdown) {
  if (!attachment) {
    return [];
  }

  const referenced = isAttachmentReferencedInMarkdown(attachment, markdown);
  const items = [];

  if (referenced) {
    items.push({ action: 'jump-to-attachment-reference', label: '跳转到正文' });
    items.push({ action: 'remove-attachment-from-note', label: '从当前笔记移除' });
  }

  items.push({ action: 'insert-attachment-at-cursor', label: '插入到当前光标' });
  items.push({ type: 'divider' });
  items.push({ action: 'rename-attachment', label: '重命名' });
  items.push({ action: 'open-attachment', label: '打开附件' });
  items.push({ action: 'copy-attachment-link', label: '复制附件链接' });
  if (!referenced) {
    items.push({ type: 'divider' });
    items.push({ action: 'delete-attachment', label: '删除附件' });
  }
  return items;
}

function getNoteMenuItems(note) {
  if (!note) {
    return [];
  }

  if (note.deleted) {
    return [
      { action: 'restore-note', label: '恢复笔记' },
      { type: 'divider' },
      { action: 'permanently-delete-note', label: '彻底删除' }
    ];
  }

  return [
    {
      action: 'favorite-note',
      label: note.favorite ? '取消收藏' : '收藏笔记'
    },
    { type: 'divider' },
    { action: 'rename-note', label: '重命名' },
    { action: 'delete-note', label: '删除' }
  ];
}
