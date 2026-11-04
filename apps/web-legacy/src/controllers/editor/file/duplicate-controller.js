import { ensureOpenTab } from '../../../../lib/editor/tab-workspace.js';
import {
  createDuplicateTitle,
  createLocalDuplicateNoteInput
} from '../../../../lib/editor/file-menu.js';
import { insertNote as insertLocalNote } from '../../../../lib/tree-workspace.js';
import { guardWorkspaceWrite } from '../../../../lib/workspace-write-guard.js';

export function createNoteDuplicateController(deps, fileTarget, getController) {
  const {
    state,
    knowledgeApi,
    getCurrentNote,
    refreshKnowledgeData,
    syncLocalWorkspace,
    flashStatus
  } = deps;

  async function duplicateCurrentNote(note) {
    if (!note) {
      return;
    }

    if (!guardWorkspaceWrite({ dataMode: state.dataMode, flashStatus })) {
      return false;
    }
    const saveResult = await getController().persistDraft({ immediate: true });
    if (!saveResult?.ok) {
      return false;
    }
    const refreshedNote = getCurrentNote() ?? note;
    const nextTitle = createDuplicateTitle(
      fileTarget.getSiblingNames(refreshedNote.folderId ?? null),
      refreshedNote.title
    );

    if (state.dataMode === 'api') {
      const created = await knowledgeApi.createNote({
        title: nextTitle,
        rawMarkdown: state.draftMarkdown || refreshedNote.rawMarkdown,
        folderId: refreshedNote.folderId ?? null,
        spaceId: state.currentSpaceId,
        sourceType: refreshedNote.sourceType ?? 'manual',
        status: refreshedNote.status ?? 'draft'
      });

      state.allNotes = insertLocalNote(state.allNotes, {
        ...created,
        contentLoaded: true
      });
      state.selectedNoteId = created.id;
      state.openNoteTabs = ensureOpenTab(state.openNoteTabs, created.id);
      await refreshKnowledgeData();
      flashStatus(`已另存为：${nextTitle}`);
      return true;
    }

    const nextNote = createLocalDuplicateNoteInput({
      note: refreshedNote,
      title: nextTitle,
      markdown: state.draftMarkdown || refreshedNote.rawMarkdown
    });

    state.allNotes = insertLocalNote(state.allNotes, nextNote);
    state.selectedNoteId = nextNote.id;
    state.openNoteTabs = ensureOpenTab(state.openNoteTabs, nextNote.id);
    syncLocalWorkspace();
    flashStatus(`已另存为：${nextTitle}`);
    return true;
  }

  return {
    duplicateCurrentNote
  };
}
