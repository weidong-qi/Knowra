export function resolveEditorRenderState({
  note,
  effectiveView,
  currentEditorNoteId,
  hasCurrentEditorHost,
  currentEditorMarkdown,
  draftMarkdown
}) {
  if (!note) {
    return {
      kind: 'empty',
      sourceOpen: false,
      viewMode: effectiveView.mode,
      shouldTeardownHost: true,
      shouldCloseTableDialog: true
    };
  }

  if (note.deleted) {
    return {
      kind: 'recycle',
      sourceOpen: false,
      viewMode: 'recycle',
      shouldTeardownHost: true,
      shouldCloseTableDialog: true
    };
  }

  const contentMode = effectiveView.contentMode
    ?? (effectiveView.mode === 'read' ? 'read' : 'edit');
  const shouldUseRichEditor = contentMode !== 'read' && !effectiveView.showSourceEditor;
  const hasMatchingMarkdown = currentEditorMarkdown === undefined
    || draftMarkdown === undefined
    || currentEditorMarkdown === draftMarkdown;
  if (
    shouldUseRichEditor
    && hasCurrentEditorHost
    && currentEditorNoteId === note.id
    && hasMatchingMarkdown
  ) {
    return {
      kind: 'reuse-rich-editor',
      sourceOpen: false,
      viewMode: effectiveView.mode,
      shouldTeardownHost: false,
      shouldCloseTableDialog: false
    };
  }

  if (!shouldUseRichEditor) {
    return {
      kind: effectiveView.showSourceEditor ? 'source-preview' : 'preview',
      sourceOpen: effectiveView.showSourceEditor,
      viewMode: effectiveView.mode,
      shouldTeardownHost: true,
      shouldCloseTableDialog: true
    };
  }

  return {
    kind: 'mount-rich-editor',
    sourceOpen: false,
    viewMode: effectiveView.mode,
    shouldTeardownHost: false,
    shouldCloseTableDialog: false
  };
}
