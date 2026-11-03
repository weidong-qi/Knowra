export function createOutlineController({
  state,
  elements,
  getCurrentNote,
  renderSidebar,
  flashStatus,
  getEditorScrollRoot,
  cancelPendingEditorScrollRestore
}) {
  function findOutlineHeadingTarget(outlineId, outlineIndex) {
    if (!elements.editorContent) {
      return null;
    }

    if (outlineId) {
      const escapedId = typeof CSS !== 'undefined' && typeof CSS.escape === 'function'
        ? CSS.escape(outlineId)
        : outlineId.replace(/"/g, '\\"');
      const directMatch = elements.editorContent.querySelector(`#${escapedId}`);
      if (directMatch) {
        return directMatch;
      }
    }

    if (!Number.isInteger(outlineIndex) || outlineIndex < 0) {
      return null;
    }

    const renderedHeadings = elements.editorContent.querySelectorAll('h1, h2, h3, h4');
    return renderedHeadings.item(outlineIndex) ?? null;
  }

  function toggleOutlineHeading(noteId, headingId) {
    const currentNoteId = getCurrentNote()?.id ?? state.selectedNoteId;
    if (!currentNoteId || !headingId || (noteId && noteId !== currentNoteId)) {
      return false;
    }

    const collapsedByNote = state.outlineCollapsedHeadingIdsByNote ?? {};
    const nextCollapsedHeadingIds = { ...(collapsedByNote[currentNoteId] ?? {}) };
    if (nextCollapsedHeadingIds[headingId]) {
      delete nextCollapsedHeadingIds[headingId];
    } else {
      nextCollapsedHeadingIds[headingId] = true;
    }

    const nextCollapsedByNote = { ...collapsedByNote };
    if (Object.keys(nextCollapsedHeadingIds).length) {
      nextCollapsedByNote[currentNoteId] = nextCollapsedHeadingIds;
    } else {
      delete nextCollapsedByNote[currentNoteId];
    }

    state.outlineCollapsedHeadingIdsByNote = nextCollapsedByNote;
    renderSidebar(getCurrentNote());
    return true;
  }

  function jumpToOutlineHeading(outlineId, outlineIndex) {
    const target = findOutlineHeadingTarget(outlineId, outlineIndex);
    if (!target) {
      flashStatus('当前标题在正文中未找到');
      return false;
    }

    const noteId = getCurrentNote()?.id ?? state.selectedNoteId;
    cancelPendingEditorScrollRestore?.(noteId);

    const root = getEditorScrollRoot?.();
    if (root
      && typeof root.getBoundingClientRect === 'function'
      && typeof target.getBoundingClientRect === 'function'
      && typeof root.scrollTop === 'number'
      && typeof root.scrollHeight === 'number'
      && typeof root.clientHeight === 'number') {
      const rootRect = root.getBoundingClientRect();
      const targetRect = target.getBoundingClientRect();
      const maxScrollTop = Math.max(0, root.scrollHeight - root.clientHeight);
      const nextScrollTop = root.scrollTop + targetRect.top - rootRect.top;
      root.scrollTop = Math.min(maxScrollTop, Math.max(0, nextScrollTop));
      return true;
    }

    if (typeof target.scrollIntoView !== 'function') {
      flashStatus('当前标题在正文中未找到');
      return false;
    }

    target.scrollIntoView({ behavior: 'auto', block: 'start', inline: 'nearest' });
    return true;
  }

  return {
    findOutlineHeadingTarget,
    toggleOutlineHeading,
    jumpToOutlineHeading
  };
}
