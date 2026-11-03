import {
  createLocalDraftNote,
  resolveDraftSaveState
} from '../../../lib/editor/draft-state.js';
import { replaceNoteInCollection } from '../../../lib/workspace-normalization.js';
import { guardWorkspaceWrite } from '../../../lib/workspace-write-guard.js';

export function createEditorDraftController(deps, getController) {
  const {
    state,
    editorRuntime,
    knowledgeApi,
    autosaveDelayMs,
    getCurrentNote,
    renderTabs,
    renderFolders,
    renderSidebar,
    renderStatus,
    persistBackendCache,
    flashStatus
  } = deps;
  let activePersistence = null;

function scheduleAutosave() {
  if (!getCurrentNote()) {
    return;
  }

  state.saveState = 'pending';
  renderTabs();
  getController().renderEditorSaveIndicator();
  renderStatus();

  if (editorRuntime.autosaveTimer) {
    clearTimeout(editorRuntime.autosaveTimer);
  }

  editorRuntime.autosaveTimer = setTimeout(() => {
    editorRuntime.autosaveTimer = null;
    void persistDraft();
  }, autosaveDelayMs);
}

async function persistDraft({ immediate = false } = {}) {
  if (activePersistence) {
    await activePersistence;
    return persistDraft({ immediate });
  }

  activePersistence = performDraftPersistence({ immediate });
  try {
    return await activePersistence;
  } finally {
    activePersistence = null;
  }
}

async function performDraftPersistence({ immediate }) {
  const note = getCurrentNote();
  if (!note) {
    return { ok: true, changed: false, reason: 'no-note' };
  }

  if (editorRuntime.autosaveTimer) {
    clearTimeout(editorRuntime.autosaveTimer);
    editorRuntime.autosaveTimer = null;
  }

  const draftSave = resolveDraftSaveState({
    note,
    markdown: state.draftMarkdown,
    title: state.draftTitle
  });
  if (!draftSave.changed) {
    state.saveState = 'saved';
    getController().renderEditorSaveIndicator();
    renderStatus();
    return { ok: true, changed: false, reason: 'unchanged' };
  }

  if (!guardWorkspaceWrite({
    dataMode: state.dataMode,
    flashStatus
  })) {
    state.saveState = 'error';
    getController().renderEditorSaveIndicator();
    renderStatus();
    return { ok: false, changed: true, reason: 'read-only' };
  }

  state.saveState = 'saving';
  getController().renderEditorSaveIndicator();
  renderStatus();

  try {
    let updatedNote;

    if (state.dataMode === 'api') {
      updatedNote = await knowledgeApi.updateNote(note.id, {
        title: draftSave.nextTitle,
        rawMarkdown: draftSave.nextMarkdown
      });
    } else {
      updatedNote = createLocalDraftNote({
        note,
        title: draftSave.nextTitle,
        markdown: draftSave.nextMarkdown
      });
    }

    state.allNotes = replaceNoteInCollection(state.allNotes, updatedNote, {
      title: draftSave.nextTitle,
      rawMarkdown: draftSave.nextMarkdown
    });
    state.draftTitle = draftSave.nextTitle;
    state.saveState = 'saved';
    state.lastSavedAt = updatedNote.updatedAt ?? new Date().toISOString();

    renderFolders();
    renderTabs();
    renderSidebar(getCurrentNote());
    getController().renderEditorSaveIndicator();
    renderStatus();
    persistBackendCache();

    if (immediate) {
      flashStatus('已保存当前笔记');
    }
    return { ok: true, changed: true, note: updatedNote };
  } catch (error) {
    state.saveState = 'error';
    getController().renderEditorSaveIndicator();
    renderStatus();
    flashStatus(error.message || '保存失败');
    return { ok: false, changed: true, error };
  }
}

  return {
    scheduleAutosave,
    persistDraft
  };
}
