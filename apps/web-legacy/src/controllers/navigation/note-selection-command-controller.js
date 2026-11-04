import { ensureOpenTab } from '../../../lib/editor/tab-workspace.js';
import { stripLegacyGeneratedTitle } from '../../../lib/notes/legacy-title.js';
import { ensureNoteDetailLoaded } from './note-detail-loader.js';

export function createNavigationNoteSelectionCommandController(deps, getController) {
  const {
    state,
    knowledgeApi,
    loadCurrentNoteSideData,
    renderAll,
    saveCurrentEditorScrollPosition,
    flashStatus
  } = deps;

  async function selectNote(noteId, { syncFolder = false, ensureTab = true } = {}) {
    const intentId = getController().beginNavigationIntent();
    let note = state.allNotes.find((item) => item.id === noteId);
    if (!note) {
      return false;
    }

    if (
      !await getController().canLeaveCurrentNote()
      || !getController().isNavigationIntentCurrent(intentId)
    ) {
      return false;
    }

    try {
      note = await ensureNoteDetailLoaded({
        state,
        knowledgeApi,
        note,
        shouldApply: () => getController().isNavigationIntentCurrent(intentId)
      });
    } catch (error) {
      if (getController().isNavigationIntentCurrent(intentId)) {
        flashStatus(error.message || '资料正文加载失败');
      }
      return false;
    }

    if (!note || !getController().isNavigationIntentCurrent(intentId)) {
      return false;
    }

    applyNoteSelection({ state, note, ensureTab });
    if (syncFolder && note.folderId) {
      state.selectedFolderId = note.folderId;
      getController().openFolderBranch(note.folderId);
    }

    await loadCurrentNoteSideData();
    if (!getController().isNavigationIntentCurrent(intentId)) {
      return false;
    }

    saveCurrentEditorScrollPosition();
    renderAll();
    flashStatus(`已切换到：${note.title}`);
    return true;
  }

  return { selectNote };
}

function applyNoteSelection({ state, note, ensureTab }) {
  state.selectedNoteId = note.id;
  state.libraryIndex.selectedNoteId = note.id;
  state.view.screen = 'editor';
  state.noteTagComposer.draft = '';
  if (ensureTab) {
    state.openNoteTabs = ensureOpenTab(state.openNoteTabs, note.id);
  }
  state.draftMarkdown = stripLegacyGeneratedTitle({
    markdown: note.rawMarkdown,
    title: note.title,
    sourceType: note.sourceType
  });
  state.draftTitle = note.title;
  state.saveState = 'saved';
  state.lastSavedAt = note.updatedAt ?? null;
}
