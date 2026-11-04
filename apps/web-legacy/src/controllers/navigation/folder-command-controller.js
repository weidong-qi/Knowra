import {
  deleteFolder as deleteLocalFolderTree,
  insertFolder as insertLocalFolder,
  moveFolder as moveLocalFolderTree,
  renameFolder as renameLocalFolderTree
} from '../../../lib/tree-workspace.js';
import { createLocalFolderInput } from '../../../lib/folders/state.js';
import { guardWorkspaceWrite } from '../../../lib/workspace-write-guard.js';

export function createNavigationFolderCommandController(deps, getController) {
  const {
    state,
    knowledgeApi,
    refreshKnowledgeData,
    syncLocalWorkspace
  } = deps;

async function createFolder(parentId, name) {
  if (!canWrite()) {
    return false;
  }
  if (state.dataMode === 'api') {
    const created = await knowledgeApi.createFolder({
      spaceId: state.currentSpaceId,
      parentId,
      name
    });

    if (parentId) {
      state.openFolders[parentId] = true;
    }
    state.selectedFolderId = created.id;
    await refreshKnowledgeData();
    return created;
  }

  const nextFolder = createLocalFolderInput({
    name,
    parentId,
    spaceId: state.currentSpaceId
  });
  state.folderTree = insertLocalFolder(state.folderTree, nextFolder);
  if (parentId) {
    state.openFolders[parentId] = true;
  }
  state.selectedFolderId = nextFolder.id;
  syncLocalWorkspace();
  return nextFolder;
}

async function renameFolder(folderId, name) {
  if (!canWrite()) {
    return false;
  }
  if (state.dataMode === 'api') {
    const folder = state.foldersById[folderId];
    await knowledgeApi.updateFolder(folderId, {
      name,
      parentId: folder?.parentId ?? null
    });
    await refreshKnowledgeData();
    return true;
  }

  state.folderTree = renameLocalFolderTree(state.folderTree, folderId, name);
  syncLocalWorkspace();
  return true;
}

async function deleteFolder(folderId) {
  if (!canWrite()) {
    return false;
  }
  if (state.dataMode === 'api') {
    const nextSelectedFolderId = state.foldersById[folderId]?.parentId ?? null;
    await knowledgeApi.deleteFolder(folderId);
    state.selectedFolderId = nextSelectedFolderId;
    await refreshKnowledgeData();
    return true;
  }

  const nextSelectedFolderId = state.foldersById[folderId]?.parentId ?? null;
  const result = deleteLocalFolderTree(state.folderTree, state.allNotes, folderId);
  state.folderTree = result.tree;
  state.allNotes = result.notes;
  state.selectedFolderId = nextSelectedFolderId;
  syncLocalWorkspace();
  return true;
}

async function moveFolder(folderId, nextParentId) {
  if (!canWrite()) {
    return false;
  }
  if (state.dataMode === 'api') {
    const folder = state.foldersById[folderId];
    await knowledgeApi.updateFolder(folderId, {
      name: folder?.name,
      parentId: nextParentId
    });
    if (nextParentId) {
      getController().openFolderBranch(nextParentId);
    }
    await refreshKnowledgeData();
    return true;
  }

  state.folderTree = moveLocalFolderTree(state.folderTree, folderId, nextParentId);
  if (nextParentId) {
    getController().openFolderBranch(nextParentId);
  }
  syncLocalWorkspace();
  return true;
}

function canWrite() {
  return guardWorkspaceWrite({
    dataMode: state.dataMode,
    flashStatus: deps.flashStatus
  });
}

  return {
    createFolder,
    renameFolder,
    deleteFolder,
    moveFolder
  };
}
