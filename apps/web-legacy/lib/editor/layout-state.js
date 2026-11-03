export const EDITOR_LAYOUT_BREAKPOINTS = Object.freeze({
  full: 1120,
  compact: 900,
  protected: 720
});

export const EDITOR_LAYOUT_MODES = Object.freeze([
  'full',
  'compact',
  'protected',
  'overlay'
]);

export const EDITOR_MARGINALIA_WIDTH = 232;
export const EDITOR_DIRECTORY_WIDTH = 232;
export const EDITOR_FUNCTION_NAV_WIDTH = 208;

export function resolveEditorLayoutMode(width) {
  const normalizedWidth = Number(width);
  if (!Number.isFinite(normalizedWidth) || normalizedWidth < 0) {
    return null;
  }

  if (normalizedWidth >= EDITOR_LAYOUT_BREAKPOINTS.full) {
    return 'full';
  }
  if (normalizedWidth >= EDITOR_LAYOUT_BREAKPOINTS.compact) {
    return 'compact';
  }
  if (normalizedWidth >= EDITOR_LAYOUT_BREAKPOINTS.protected) {
    return 'protected';
  }
  return 'overlay';
}

export function resolveEditorMainWidth({
  workspaceWidth,
  rightSidebarOpen,
  marginaliaWidth = EDITOR_MARGINALIA_WIDTH
} = {}) {
  const normalizedWorkspaceWidth = Number(workspaceWidth);
  const normalizedMarginaliaWidth = Number(marginaliaWidth);
  if (!Number.isFinite(normalizedWorkspaceWidth) || normalizedWorkspaceWidth < 0) {
    return null;
  }

  if (!rightSidebarOpen) {
    return normalizedWorkspaceWidth;
  }

  const reservedWidth = Number.isFinite(normalizedMarginaliaWidth) && normalizedMarginaliaWidth > 0
    ? normalizedMarginaliaWidth
    : EDITOR_MARGINALIA_WIDTH;
  return Math.max(0, normalizedWorkspaceWidth - reservedWidth);
}
