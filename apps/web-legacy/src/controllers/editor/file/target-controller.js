import { getSiblingNamesForFolder } from '../../../../lib/editor/file-menu.js';

export function createEditorFileTargetController(deps) {
  const {
    state,
    getCurrentNote
  } = deps;

  function getMenuTargetFolderId() {
    if (state.selectedFolderId) {
      return state.selectedFolderId;
    }

    return getCurrentNote()?.folderId ?? null;
  }

  function getSiblingNames(folderId) {
    return getSiblingNamesForFolder({
      folderId,
      foldersById: state.foldersById,
      folderTree: state.folderTree,
      notes: state.allNotes
    });
  }

  return {
    getMenuTargetFolderId,
    getSiblingNames
  };
}
