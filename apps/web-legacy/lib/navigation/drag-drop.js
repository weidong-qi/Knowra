import { closestFromEventTarget } from '../dom/event-target.js';

export function resolveDropTarget(target) {
  const folderButton = closestFromEventTarget(target, '[data-folder-id]');
  if (folderButton?.dataset.folderId) {
    return { kind: 'folder', id: folderButton.dataset.folderId };
  }

  const materialsSection = closestFromEventTarget(target, '[data-materials-section]');
  if (materialsSection) {
    return { kind: 'materials', id: null };
  }

  return null;
}

export function canDropOnTarget({
  dragState = {},
  dropTarget = null,
  foldersById = {},
  notes = []
} = {}) {
  if (!dragState.activeKind || !dragState.activeId || !dropTarget) {
    return false;
  }

  if (dragState.activeKind === 'folder') {
    return canDropFolderOnTarget({ folderId: dragState.activeId, dropTarget, foldersById });
  }

  if (dragState.activeKind === 'note') {
    return canDropNoteOnTarget({ noteId: dragState.activeId, dropTarget, notes });
  }

  return false;
}

function canDropFolderOnTarget({ folderId, dropTarget, foldersById }) {
  if (dropTarget.kind === 'materials') {
    return Boolean(foldersById[folderId]?.parentId);
  }

  if (dropTarget.kind !== 'folder' || dropTarget.id === folderId) {
    return false;
  }

  if (isDescendantFolder({ foldersById, ancestorId: folderId, folderId: dropTarget.id })) {
    return false;
  }

  return foldersById[folderId]?.parentId !== dropTarget.id;
}

function canDropNoteOnTarget({ noteId, dropTarget, notes }) {
  const note = notes.find((item) => item.id === noteId);
  if (!note) {
    return false;
  }

  if (dropTarget.kind === 'materials') {
    return note.folderId !== null;
  }

  return dropTarget.kind === 'folder' && note.folderId !== dropTarget.id;
}

function isDescendantFolder({ foldersById, ancestorId, folderId }) {
  let cursor = foldersById[folderId] ?? null;
  while (cursor) {
    if (cursor.id === ancestorId) {
      return true;
    }
    cursor = cursor.parentId ? foldersById[cursor.parentId] : null;
  }

  return false;
}
