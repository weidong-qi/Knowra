import { validateSiblingName } from '../tree-name-validation.js';

function getChildFolders({ parentId, foldersById, folderTree }) {
  return parentId
    ? foldersById[parentId]?.children ?? []
    : folderTree;
}

function getSiblingNotes({ folderId, notes }) {
  return (notes ?? []).filter((note) => note.folderId === folderId);
}

export function validateTreeEditorName({
  editor,
  candidateName,
  foldersById = {},
  folderTree = [],
  notes = []
}) {
  if (!editor) {
    return;
  }

  if (editor.mode === 'create-folder' || editor.mode === 'create-note') {
    const parentId = editor.parentId ?? null;
    validateSiblingName({
      candidateName,
      siblingFolders: getChildFolders({ parentId, foldersById, folderTree }),
      siblingNotes: getSiblingNotes({ folderId: parentId, notes })
    });
    return;
  }

  if (editor.mode === 'rename-folder') {
    const folder = foldersById[editor.targetId];
    const parentId = folder?.parentId ?? null;
    validateSiblingName({
      candidateName,
      siblingFolders: getChildFolders({ parentId, foldersById, folderTree }),
      siblingNotes: getSiblingNotes({ folderId: parentId, notes }),
      currentFolderId: editor.targetId
    });
    return;
  }

  if (editor.mode === 'rename-note') {
    const note = notes.find((item) => item.id === editor.targetId);
    const folderId = note?.folderId ?? null;
    validateSiblingName({
      candidateName,
      siblingFolders: getChildFolders({ parentId: folderId, foldersById, folderTree }),
      siblingNotes: getSiblingNotes({ folderId, notes }),
      currentNoteId: editor.targetId
    });
  }
}
