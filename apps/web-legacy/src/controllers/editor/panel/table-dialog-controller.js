import {
  normalizeTableDialogValue,
  renderTableInsertDialogMarkup
} from '../../../../lib/editor/table-dialog-renderers.js';

export function createEditorTableDialogController(deps, getController) {
  const {
    state,
    editorRuntime,
    getCurrentNote,
    flashStatus
  } = deps;

  function openTableInsertDialog({ rows = '4', cols = '3' } = {}) {
    state.editorTableDialog.open = true;
    state.editorTableDialog.rows = String(rows);
    state.editorTableDialog.cols = String(cols);
    state.editorTableDialog.autoFocusInput = true;
    getController().closeEditorMenuBar();
    getController().closeEditorContextMenu();
    renderTableInsertDialog();
  }

  function closeTableInsertDialog() {
    if (!state.editorTableDialog.open) {
      return;
    }

    state.editorTableDialog.open = false;
    state.editorTableDialog.autoFocusInput = false;
    renderTableInsertDialog();
  }

  async function submitTableInsertDialog() {
    if (!editorRuntime.currentEditorHost) {
      flashStatus('编辑器尚未就绪');
      return;
    }

    const row = normalizeTableDialogValue(state.editorTableDialog.rows, 4);
    const col = normalizeTableDialogValue(state.editorTableDialog.cols, 3);
    state.editorTableDialog.rows = String(row);
    state.editorTableDialog.cols = String(col);

    await editorRuntime.currentEditorHost.run('table', { row, col });
    closeTableInsertDialog();
    await editorRuntime.currentEditorHost.focus();
  }

  function renderTableInsertDialog() {
    const dialog = document.getElementById('editor-table-dialog');
    if (!dialog) {
      return;
    }

    const note = getCurrentNote();
    if (!state.editorTableDialog.open || !note || state.view.showSourceEditor) {
      dialog.hidden = true;
      dialog.innerHTML = '';
      return;
    }

    dialog.hidden = false;
    dialog.innerHTML = renderTableInsertDialogMarkup(state.editorTableDialog);

    if (state.editorTableDialog.autoFocusInput) {
      window.requestAnimationFrame(() => {
        const input = dialog.querySelector('[data-table-dialog-field="cols"]');
        input?.focus();
        input?.select();
        state.editorTableDialog.autoFocusInput = false;
      });
    }
  }

  return {
    openTableInsertDialog,
    closeTableInsertDialog,
    submitTableInsertDialog,
    renderTableInsertDialog
  };
}
