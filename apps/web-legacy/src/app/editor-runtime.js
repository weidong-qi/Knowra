export function createEditorRuntime() {
  return {
    autosaveTimer: null,
    currentEditorHost: null,
    currentEditorNoteId: null,
    currentEditorMarkdown: null,
    pendingEditorNoteId: null,
    pendingEditorMarkdown: null,
    editorMountToken: 0
  };
}
