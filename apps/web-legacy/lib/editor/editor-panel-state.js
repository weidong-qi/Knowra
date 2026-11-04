export function createOpenedEditorPanelState(previousPanel = {}, mode) {
  return {
    open: true,
    mode,
    query: previousPanel.query ?? '',
    replacement: previousPanel.replacement ?? '',
    matchIndex: -1,
    matchCount: 0,
    autoFocusInput: true
  };
}

export function applyEditorPanelMatchResult(panel, { index, count }) {
  return {
    ...panel,
    matchIndex: index,
    matchCount: count,
    autoFocusInput: false
  };
}
