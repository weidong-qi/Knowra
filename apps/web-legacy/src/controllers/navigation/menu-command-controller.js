export function createNavigationMenuCommandController(deps, getController) {
  const {
    state,
    getNoteById,
    flashStatus,
    jumpToAttachmentReference,
    openAttachment,
    copyAttachmentLink,
    deleteAttachment,
    insertAttachmentAtCursor,
    removeAttachmentFromCurrentNote,
    startAttachmentRename
  } = deps;

async function handleContextMenuAction(action) {
  const { targetId } = state.contextMenu;
  closeContextMenu();
  clearDeleteIntent();

  switch (action) {
    case 'create-folder-root':
      getController().startTreeEditor({ mode: 'create-folder', parentId: null, value: '' });
      return;
    case 'create-note-root':
      getController().startTreeEditor({ mode: 'create-note', parentId: null, value: '' });
      return;
    case 'create-folder-child':
      getController().startTreeEditor({ mode: 'create-folder', parentId: targetId, value: '' });
      getController().openFolderBranch(targetId);
      return;
    case 'create-note-child':
      getController().startTreeEditor({ mode: 'create-note', parentId: targetId, value: '' });
      getController().openFolderBranch(targetId);
      return;
    case 'rename-folder': {
      const folder = state.foldersById[targetId];
      if (!folder) {
        return;
      }
      getController().startTreeEditor({ mode: 'rename-folder', targetId: folder.id, value: folder.name });
      return;
    }
    case 'rename-note': {
      const note = getNoteById(targetId);
      if (!note || note.deleted) {
        return;
      }
      getController().startTreeEditor({ mode: 'rename-note', targetId: note.id, value: note.title });
      return;
    }
    case 'favorite-note': {
      const note = getNoteById(targetId);
      if (!note || note.deleted) {
        return;
      }
      const nextFavorite = !note.favorite;
      const updated = await getController().setNoteFavorite(note.id, nextFavorite);
      if (updated === false) return;
      flashStatus(nextFavorite ? '已收藏笔记' : '已取消收藏');
      return;
    }
    case 'restore-note': {
      const note = getNoteById(targetId);
      if (!note || !note.deleted) {
        return;
      }
      const restored = await getController().restoreNote(note.id);
      if (restored === false) return;
      flashStatus('笔记已恢复');
      return;
    }
    case 'permanently-delete-note': {
      const note = getNoteById(targetId);
      if (!note || !note.deleted) {
        return;
      }
      const deleted = await getController().permanentlyDeleteNote(note.id);
      if (deleted === false) return;
      flashStatus('笔记已彻底删除');
      return;
    }
    case 'empty-recycle-bin': {
      const emptied = await getController().emptyRecycleBin();
      if (emptied === false) return;
      flashStatus('回收站已清空');
      return;
    }
    case 'jump-to-attachment-reference': {
      jumpToAttachmentReference?.(targetId);
      return;
    }
    case 'open-attachment': {
      openAttachment?.(targetId);
      return;
    }
    case 'rename-attachment': {
      startAttachmentRename?.(targetId);
      return;
    }
    case 'copy-attachment-link': {
      await copyAttachmentLink?.(targetId);
      return;
    }
    case 'insert-attachment-at-cursor': {
      const attachment = state.attachments.find((item) => item?.id === targetId) ?? null;
      if (!attachment) {
        flashStatus('当前附件不存在或已失效');
        return;
      }
      await insertAttachmentAtCursor?.(attachment);
      return;
    }
    case 'remove-attachment-from-note': {
      const attachment = state.attachments.find((item) => item?.id === targetId) ?? null;
      if (!attachment) {
        flashStatus('当前附件不存在或已失效');
        return;
      }
      await removeAttachmentFromCurrentNote?.(attachment);
      return;
    }
    case 'delete-attachment': {
      await deleteAttachment?.(targetId);
      return;
    }
    case 'delete-folder': {
      const folder = state.foldersById[targetId];
      if (!folder) {
        return;
      }
      state.deleteIntent = { kind: 'folder', targetId: folder.id };
      getController().renderFolders();
      return;
    }
    case 'delete-note': {
      const note = getNoteById(targetId);
      if (!note || note.deleted) {
        return;
      }
      state.deleteIntent = { kind: 'note', targetId: note.id };
      getController().renderFolders();
      return;
    }
    default:
      break;
  }
}

function openContextMenu({ x, y, targetKind, targetId }) {
  closeSectionMenu();
  getController().cancelTreeEditor();
  state.contextMenu = {
    open: true,
    x,
    y,
    targetKind,
    targetId
  };
  getController().renderContextMenu();
}

function closeContextMenu() {
  if (!state.contextMenu.open) {
    return;
  }
  state.contextMenu = {
    open: false,
    x: 0,
    y: 0,
    targetKind: null,
    targetId: null
  };
  getController().renderContextMenu();
}

function closeSectionMenu() {
  if (!state.sectionMenuOpen) {
    return;
  }
  state.sectionMenuOpen = false;
  getController().renderSectionMenu();
  getController().renderHeaderToggle();
}

function clearDeleteIntent({ rerender = true } = {}) {
  if (!state.deleteIntent) {
    return;
  }
  state.deleteIntent = null;
  if (rerender) {
    getController().renderFolders();
  }
}

  return {
    handleContextMenuAction,
    openContextMenu,
    closeContextMenu,
    closeSectionMenu,
    clearDeleteIntent
  };
}
