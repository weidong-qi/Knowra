import { getVisibleNavigationNotes } from '../../../lib/navigation/visibility.js';
import {
  openFolderBranch as expandFolderBranch,
  resolveFolderSelection,
  toggleFolderOpen as toggleOpenFolderState
} from '../../../lib/navigation/selection.js';
import { getWorkDomainStatusMessage } from '../../../lib/status/messages.js';

export function createNavigationSelectionCommandController(deps, getController) {
  const {
    state,
    renderAll,
    loadCurrentNoteSideData,
    clearNoteSideData,
    persistDraft,
    flashStatus
  } = deps;
  let navigationIntentSequence = 0;

function beginNavigationIntent() {
  navigationIntentSequence += 1;
  return navigationIntentSequence;
}

function isNavigationIntentCurrent(intentId) {
  return intentId === navigationIntentSequence;
}

async function canLeaveCurrentNote() {
  const result = await persistDraft({ immediate: true });
  return result?.ok === true;
}

async function selectFolder(folderId) {
  const intentId = beginNavigationIntent();
  if (!await canLeaveCurrentNote() || !isNavigationIntentCurrent(intentId)) {
    return false;
  }
  const selection = resolveFolderSelection({
    folderId,
    selectedNoteId: state.selectedNoteId,
    visibleNotes: getVisibleNavigationNotes({
      notes: state.allNotes,
      foldersById: state.foldersById,
      selectedFolderId: folderId,
      search: state.search
    }),
    openNoteTabs: state.openNoteTabs
  });

  state.selectedFolderId = selection.selectedFolderId;
  state.selectedNoteId = selection.selectedNoteId;
  state.libraryIndex.selectedNoteId = selection.selectedNoteId;
  state.libraryIndex.tab = 'all';
  state.libraryIndex.page = 1;
  state.view.screen = 'index';
  state.openNoteTabs = selection.openNoteTabs;

  if (selection.draftMarkdown !== undefined) {
    state.draftMarkdown = selection.draftMarkdown;
  }
  if (selection.draftTitle !== undefined) {
    state.draftTitle = selection.draftTitle;
  }

  if (selection.shouldClearSideData) {
    clearNoteSideData();
  }

  if (selection.shouldLoadSideData) {
    await loadCurrentNoteSideData();
    if (!isNavigationIntentCurrent(intentId)) {
      return false;
    }
  }

  renderAll();
  flashStatus(`已切换到目录：${state.foldersById[folderId]?.name ?? ''}`);
  return true;
}

async function returnToLibraryIndex({ global = false } = {}) {
  const intentId = beginNavigationIntent();
  if (!await canLeaveCurrentNote() || !isNavigationIntentCurrent(intentId)) {
    return false;
  }

  state.view.screen = 'index';
  state.statusMessage = getWorkDomainStatusMessage('materials');
  if (global) {
    state.selectedFolderId = null;
    state.libraryIndex.tab = 'all';
    state.search.keyword = '';
    state.search.selectedTagIds = [];
    state.search.isOpen = false;
  }
  renderAll();
  return true;
}

function toggleFolderOpen(folderId) {
  state.openFolders = toggleOpenFolderState(state.openFolders, folderId);
  getController().renderFolders();
}

function openFolderBranch(folderId) {
  state.openFolders = expandFolderBranch({
    openFolders: state.openFolders,
    foldersById: state.foldersById,
    folderId
  });
}

  return {
    beginNavigationIntent,
    isNavigationIntentCurrent,
    canLeaveCurrentNote,
    selectFolder,
    returnToLibraryIndex,
    toggleFolderOpen,
    openFolderBranch
  };
}
