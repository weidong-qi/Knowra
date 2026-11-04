export function focusEditorMenuTarget({ menuBar, menuKey, focusTarget }) {
  if (!menuBar || !menuKey || !focusTarget) {
    return false;
  }

  const selector = focusTarget === 'first-item'
    ? `[data-editor-menu="${menuKey}"] [role="menuitem"]:not([disabled])`
    : `[data-editor-menu-toggle="${menuKey}"]`;
  const target = menuBar.querySelector?.(selector);
  if (!target?.focus) {
    return false;
  }

  target.focus();
  return true;
}
