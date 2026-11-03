import { validateTreeEditorName as validateNavigationTreeEditorName } from '../../../lib/navigation/tree-editor.js';
import { guardWorkspaceWrite } from '../../../lib/workspace-write-guard.js';

export function createNavigationTreeEditorCommandController(deps, getController) {
  const {
    state,
    elements,
    flashStatus
  } = deps;

function startTreeEditor({ mode, parentId = null, targetId = null, value = '' }) {
  if (!guardWorkspaceWrite({ dataMode: state.dataMode, flashStatus })) {
    return false;
  }
  state.treeEditor = {
    mode,
    parentId,
    targetId,
    value
  };
  getController().clearDeleteIntent({ rerender: false });
  getController().closeContextMenu();
  getController().renderFolders();
  return true;
}

function cancelTreeEditor() {
  if (!state.treeEditor) {
    return;
  }
  state.treeEditor = null;
  getController().renderFolders();
}

async function submitTreeEditor() {
  if (!state.treeEditor) {
    return;
  }

  const trimmedValue = state.treeEditor.value.trim();
  if (!trimmedValue) {
    flashStatus('请输入名称');
    focusInlineEditor();
    return;
  }

  const editor = state.treeEditor;

  try {
    validateTreeEditorName(editor, trimmedValue);
    state.treeEditor = null;

    switch (editor.mode) {
      case 'create-folder': {
        const result = await getController().createFolder(editor.parentId, trimmedValue);
        if (result === false) return;
        flashStatus(`目录已创建：${trimmedValue}`);
        return;
      }
      case 'rename-folder': {
        const result = await getController().renameFolder(editor.targetId, trimmedValue);
        if (result === false) return;
        flashStatus(`目录已重命名：${trimmedValue}`);
        return;
      }
      case 'create-note': {
        const result = await getController().createNote(editor.parentId, trimmedValue);
        if (result === false) return;
        flashStatus(`文件已创建：${trimmedValue}`);
        return;
      }
      case 'rename-note': {
        const result = await getController().renameNote(editor.targetId, trimmedValue);
        if (result === false) return;
        flashStatus(`文件已重命名：${trimmedValue}`);
        return;
      }
      default:
        return;
    }
  } catch (error) {
    flashStatus(error.message || '操作失败');
    state.treeEditor = editor;
    getController().renderFolders();
  }
}

async function commitDelete(kind, targetId) {
  getController().clearDeleteIntent({ rerender: false });

  try {
    if (kind === 'folder') {
      const deleted = await getController().deleteFolder(targetId);
      if (deleted === false) return;
      flashStatus('目录已删除');
    } else if (kind === 'note') {
      const deleted = await getController().deleteNote(targetId);
      if (deleted === false) return;
      flashStatus('文件已删除');
    }
  } catch (error) {
    flashStatus(error.message || '删除失败');
  }
}

function validateTreeEditorName(editor, candidateName) {
  validateNavigationTreeEditorName({
    editor,
    candidateName,
    foldersById: state.foldersById,
    folderTree: state.folderTree,
    notes: state.allNotes
  });
}

function focusInlineEditor() {
  if (!state.treeEditor) {
    return;
  }

  window.requestAnimationFrame(() => {
    const input = elements.folderTree?.querySelector('[data-inline-editor-input]');
    if (!input) {
      return;
    }
    input.focus();
    input.select();
  });
}

  return {
    startTreeEditor,
    cancelTreeEditor,
    submitTreeEditor,
    commitDelete,
    validateTreeEditorName,
    focusInlineEditor
  };
}
