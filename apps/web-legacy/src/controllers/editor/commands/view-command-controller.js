export function createEditorViewCommandController(deps, getController, menuState) {
  const {
    state,
    getCurrentNote,
    renderAll,
    flashStatus
  } = deps;

  function enterFocusMode() {
    if (state.view.mode === 'focus') {
      return;
    }

    state.view.modeBeforeFocus = ['read', 'edit'].includes(state.view.mode)
      ? state.view.mode
      : 'edit';
    state.view.mode = 'focus';
  }

  function exitFocusMode() {
    state.view.mode = ['read', 'edit'].includes(state.view.modeBeforeFocus)
      ? state.view.modeBeforeFocus
      : 'edit';
    state.view.modeBeforeFocus = null;
  }

  function restoreFocusToggleFocus() {
    globalThis.document
      ?.querySelector?.('[data-status-action="toggle-focus"]')
      ?.focus?.();
  }

  function renderFocusModeChange() {
    renderAll();
    restoreFocusToggleFocus();
  }

  async function handleViewMenuAction(action) {
    menuState.closeEditorMenuBar();

    switch (action) {
      case 'mode-read':
        state.view.mode = 'read';
        state.view.modeBeforeFocus = null;
        state.view.showSourceEditor = false;
        renderAll();
        return;
      case 'mode-edit':
        state.view.mode = 'edit';
        state.view.modeBeforeFocus = null;
        state.view.showSourceEditor = false;
        renderAll();
        return;
      case 'mode-focus':
        enterFocusMode();
        renderFocusModeChange();
        return;
      case 'toggle-focus':
        if (state.view.mode === 'focus') {
          exitFocusMode();
        } else {
          enterFocusMode();
        }
        renderFocusModeChange();
        return;
      case 'toggle-left-sidebar':
        state.view.showLeftSidebar = !state.view.showLeftSidebar;
        renderAll();
        return;
      case 'toggle-right-sidebar':
        state.view.showRightSidebar = !state.view.showRightSidebar;
        renderAll();
        return;
      case 'toggle-source-editor':
        if (!getCurrentNote()) {
          flashStatus('请先选择一篇笔记');
          return;
        }
        if (state.view.mode !== 'focus') {
          state.view.mode = 'edit';
          state.view.modeBeforeFocus = null;
        } else if (state.view.modeBeforeFocus === 'read' && !state.view.showSourceEditor) {
          // Opening an editable source pane is an explicit switch back to the
          // editing business mode; focus itself remains a layout-only mode.
          state.view.modeBeforeFocus = 'edit';
        }
        state.view.showSourceEditor = !state.view.showSourceEditor;
        renderAll();
        return;
      default:
        return;
    }
  }

  return {
    handleViewMenuAction
  };
}
