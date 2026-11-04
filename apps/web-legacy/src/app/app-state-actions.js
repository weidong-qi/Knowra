import { resolveNavigationSelection } from '../../lib/navigation/selection.js';
import { flattenFolderTree } from '../../lib/tree-workspace.js';
import { replaceNoteInCollection } from '../../lib/workspace-normalization.js';

export function createAppStateActions({
  state,
  getVisibleNotes,
  clearNoteSideData,
  loadLocalNoteSideData,
  persistBackendCache,
  renderAll,
  renderStatus
}) {
  function getCurrentNote() {
    if (!state.selectedNoteId) {
      return null;
    }

    return state.allNotes.find((note) => note.id === state.selectedNoteId) ?? null;
  }

  function getNoteById(noteId) {
    if (!noteId) {
      return null;
    }

    return state.allNotes.find((note) => note.id === noteId) ?? null;
  }

  function getActiveNotes() {
    return state.allNotes.filter((note) => !note.deleted);
  }

  function getRecycleNotes() {
    return state.allNotes
      .filter((note) => note.deleted)
      .sort((left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime());
  }

  function reconcileSelection() {
    const validSelectedFolderId = state.selectedFolderId && !state.foldersById[state.selectedFolderId]
      ? null
      : state.selectedFolderId;
    const selection = resolveNavigationSelection({
      selectedFolderId: state.selectedFolderId,
      foldersById: state.foldersById,
      activeNotes: getActiveNotes(),
      visibleNotes: getVisibleNotes({ selectedFolderId: validSelectedFolderId }),
      selectedNoteId: state.selectedNoteId,
      openNoteTabs: state.openNoteTabs
    });

    state.selectedFolderId = selection.selectedFolderId;
    state.selectedNoteId = selection.selectedNoteId;
    state.openNoteTabs = selection.openNoteTabs;
    state.draftMarkdown = selection.draftMarkdown;
    state.draftTitle = selection.draftTitle;
    state.saveState = selection.saveState;
    state.lastSavedAt = selection.lastSavedAt;

    if (selection.noteTagDraft !== undefined) {
      state.noteTagComposer.draft = selection.noteTagDraft;
    }

    if (selection.shouldClearSideData) {
      state.selectedNoteId = null;
      clearNoteSideData();
    }
  }

  function syncLocalWorkspace() {
    state.foldersById = flattenFolderTree(state.folderTree);
    reconcileSelection();
    loadLocalNoteSideData(state.selectedNoteId);
    renderAll();
  }

  function replaceNoteInState(updatedNote) {
    const nextNotes = replaceNoteInCollection(state.allNotes, updatedNote);
    if (nextNotes === state.allNotes) {
      return;
    }

    state.allNotes = nextNotes;

    reconcileSelection();
    persistBackendCache();
    renderAll();
  }

  function flashStatus(message) {
    state.statusMessage = message;
    renderStatus();
  }

  return {
    reconcileSelection,
    syncLocalWorkspace,
    getCurrentNote,
    getNoteById,
    getActiveNotes,
    getRecycleNotes,
    replaceNoteInState,
    flashStatus
  };
}
