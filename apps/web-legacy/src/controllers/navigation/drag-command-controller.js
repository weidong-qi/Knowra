import {
  canDropOnTarget as canDropOnNavigationTarget,
  resolveDropTarget as resolveNavigationDropTarget
} from '../../../lib/navigation/drag-drop.js';

export function createNavigationDragCommandController(deps, getController) {
  const {
    state,
    elements,
    flashStatus
  } = deps;

async function commitDrop(dropTarget) {
  const { activeKind, activeId } = state.dragState;
  if (!activeKind || !activeId) {
    return;
  }

  resetDragState({ rerender: false });

  try {
    if (activeKind === 'folder') {
      const moved = await getController().moveFolder(activeId, dropTarget.kind === 'materials' ? null : dropTarget.id);
      if (moved === false) return;
      flashStatus('目录位置已更新');
    } else if (activeKind === 'note') {
      const moved = await getController().moveNote(activeId, dropTarget.kind === 'materials' ? null : dropTarget.id);
      if (moved === false) return;
      flashStatus('文件位置已更新');
    }
  } catch (error) {
    flashStatus(error.message || '移动失败');
  }
}

function resetDragState({ rerender = true } = {}) {
  state.dragState = {
    activeKind: null,
    activeId: null,
    overKind: null,
    overId: null
  };

  if (rerender) {
    getController().renderFolders();
    return;
  }

  syncDragIndicators();
}

function syncDragIndicators() {
  const folderTree = elements.folderTree;
  if (!folderTree) {
    return;
  }

  folderTree.querySelectorAll('[data-drag-kind][data-drag-id]').forEach((node) => {
    const isDragging = (
      state.dragState.activeKind === node.dataset.dragKind
      && state.dragState.activeId === node.dataset.dragId
    );
    node.dataset.dragging = isDragging ? 'true' : 'false';
  });

  folderTree.querySelectorAll('[data-drop-target]').forEach((node) => {
    const folderId = node.dataset.folderId ?? null;
    const isRootTarget = node.dataset.materialsSection === 'true';
    const isDropTarget = (
      (isRootTarget && state.dragState.overKind === 'materials')
      || (folderId && state.dragState.overKind === 'folder' && state.dragState.overId === folderId)
    );
    node.dataset.dropTarget = isDropTarget ? 'true' : 'false';
  });
}

function resolveDropTarget(target) {
  return resolveNavigationDropTarget(target);
}

function canDropOnTarget(dragState, dropTarget) {
  return canDropOnNavigationTarget({
    dragState,
    dropTarget,
    foldersById: state.foldersById,
    notes: state.allNotes
  });
}

function isRootDropActive() {
  return state.dragState.overKind === 'materials';
}

  return {
    commitDrop,
    resetDragState,
    syncDragIndicators,
    resolveDropTarget,
    canDropOnTarget,
    isRootDropActive
  };
}
