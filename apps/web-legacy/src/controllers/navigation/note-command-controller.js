import { insertNote as insertLocalNote } from '../../../lib/tree-workspace.js';
import {
  createLocalManualNoteInput,
  emptyLocalRecycleBin,
  moveLocalNoteToFolder,
  permanentlyDeleteLocalNote,
  renameLocalNote,
  restoreLocalNote,
  setLocalNoteFavorite,
  softDeleteLocalNote
} from '../../../lib/notes/state.js';
import { guardWorkspaceWrite } from '../../../lib/workspace-write-guard.js';
import { createNavigationNoteSelectionCommandController } from './note-selection-command-controller.js';

export function createNavigationNoteCommandController(deps, getController) {
  const {
    state,
    knowledgeApi,
    getNoteById,
    refreshKnowledgeData,
    syncLocalWorkspace
  } = deps;

async function runNoteMutation({
  apiMutation,
  localMutation,
  afterMutation
}) {
  if (!guardWorkspaceWrite({
    dataMode: state.dataMode,
    flashStatus: deps.flashStatus
  })) {
    return false;
  }
  const isApi = state.dataMode === 'api';
  const result = isApi
    ? await apiMutation()
    : localMutation();

  await afterMutation?.({ result, isApi });

  if (isApi) {
    await refreshKnowledgeData();
  } else {
    syncLocalWorkspace();
  }

  return result === undefined ? true : result;
}

async function createNote(folderId, title) {
  const intentId = getController().beginNavigationIntent();
  if (
    !await getController().canLeaveCurrentNote()
    || !getController().isNavigationIntentCurrent(intentId)
  ) {
    return false;
  }
  return runNoteMutation({
    apiMutation: () => knowledgeApi.createNote({
      title,
      rawMarkdown: '',
      folderId,
      spaceId: state.currentSpaceId,
      sourceType: 'manual',
      status: 'draft'
    }),
    localMutation: () => {
      const nextNote = createLocalManualNoteInput({
        title,
        folderId,
        spaceId: state.currentSpaceId
      });
      state.allNotes = insertLocalNote(state.allNotes, nextNote);
      return nextNote;
    },
    afterMutation: ({ result: created, isApi }) => {
      if (!getController().isNavigationIntentCurrent(intentId)) {
        return;
      }
      if (isApi) {
        state.allNotes = insertLocalNote(state.allNotes, {
          ...created,
          contentLoaded: true
        });
      }
      state.selectedNoteId = created.id;
      state.libraryIndex.selectedNoteId = created.id;
      state.view.screen = 'editor';
      state.selectedFolderId = folderId ?? null;
      if (folderId) {
        getController().openFolderBranch(folderId);
      }
    }
  });
}

async function renameNote(noteId, title) {
  return runNoteMutation({
    apiMutation: () => knowledgeApi.updateNote(noteId, { title }),
    localMutation: () => {
      state.allNotes = renameLocalNote(state.allNotes, noteId, title);
    }
  });
}

async function deleteNote(noteId) {
  if (
    state.selectedNoteId === noteId
    && !await getController().canLeaveCurrentNote()
  ) {
    return false;
  }
  return runNoteMutation({
    apiMutation: () => knowledgeApi.deleteNote(noteId),
    localMutation: () => {
      state.allNotes = softDeleteLocalNote(state.allNotes, noteId);
    },
    afterMutation: () => {
      if (state.selectedNoteId === noteId) {
        state.selectedNoteId = null;
      }
      state.libraryIndex.selectedNoteId = noteId;
      state.libraryIndex.tab = 'recycle';
      state.view.screen = 'index';
    }
  });
}

async function permanentlyDeleteNote(noteId) {
  return runNoteMutation({
    apiMutation: () => knowledgeApi.permanentlyDeleteNote(noteId),
    localMutation: () => {
      state.allNotes = permanentlyDeleteLocalNote(state.allNotes, noteId);
    },
    afterMutation: () => {
      if (state.selectedNoteId === noteId) {
        state.selectedNoteId = null;
      }
    }
  });
}

async function restoreNote(noteId) {
  return runNoteMutation({
    apiMutation: () => knowledgeApi.restoreNote(noteId),
    localMutation: () => {
      state.allNotes = restoreLocalNote(state.allNotes, noteId);
    },
    afterMutation: ({ isApi }) => {
      if (isApi && state.selectedNoteId === noteId) {
        state.selectedNoteId = null;
      }
    }
  });
}

async function emptyRecycleBin() {
  return runNoteMutation({
    apiMutation: () => knowledgeApi.emptyRecycleBin(state.currentSpaceId),
    localMutation: () => {
      state.allNotes = emptyLocalRecycleBin(state.allNotes);
    },
    afterMutation: ({ isApi }) => {
      const selectedNote = state.selectedNoteId
        ? getNoteById(state.selectedNoteId)
        : null;
      const shouldClearSelection = isApi
        ? selectedNote?.deleted
        : state.selectedNoteId && !selectedNote;
      if (shouldClearSelection) {
        state.selectedNoteId = null;
      }
    }
  });
}

async function setNoteFavorite(noteId, favorite) {
  return runNoteMutation({
    apiMutation: () => knowledgeApi.setNoteFavorite(noteId, favorite),
    localMutation: () => {
      state.allNotes = setLocalNoteFavorite(
        state.allNotes,
        noteId,
        favorite
      );
    }
  });
}

async function moveNote(noteId, nextFolderId) {
  return runNoteMutation({
    apiMutation: () => {
      const note = state.allNotes.find((item) => item.id === noteId);
      return knowledgeApi.updateNote(noteId, {
        title: note?.title,
        folderId: nextFolderId
      });
    },
    localMutation: () => {
      state.allNotes = moveLocalNoteToFolder(
        state.allNotes,
        noteId,
        nextFolderId
      );
    },
    afterMutation: () => {
      if (nextFolderId) {
        getController().openFolderBranch(nextFolderId);
      }
    }
  });
}

  return {
    createNote,
    renameNote,
    deleteNote,
    permanentlyDeleteNote,
    restoreNote,
    emptyRecycleBin,
    setNoteFavorite,
    moveNote,
    ...createNavigationNoteSelectionCommandController(deps, getController)
  };
}
