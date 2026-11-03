export function getEffectiveViewState(view) {
  const contentMode = view.mode === 'focus'
    ? (['read', 'edit'].includes(view.modeBeforeFocus) ? view.modeBeforeFocus : 'edit')
    : (view.mode === 'read' ? 'read' : 'edit');

  return {
    mode: view.mode,
    contentMode,
    showLeftSidebar: view.mode === 'focus' ? false : view.showLeftSidebar,
    showRightSidebar: view.mode === 'focus' ? false : view.showRightSidebar,
    showSourceEditor: view.showSourceEditor
  };
}
