export function createEditorMenuStateController(deps, getController) {
  const { state } = deps;

  function closeEditorMenuBar({ restoreFocus = false } = {}) {
    if (!state.editorMenuOpen) {
      return;
    }

    const menuKey = state.editorMenuOpen;
    state.editorMenuOpen = null;
    getController().renderEditorMenuBar({
      focusMenuKey: menuKey,
      focusTarget: restoreFocus ? 'trigger' : null
    });
  }

  return {
    closeEditorMenuBar
  };
}
