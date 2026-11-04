import type { EditorView } from '@milkdown/kit/prose/view';

/** Keep a typing caret at the nearest visible edge of the document stage. */
export function scrollEditorSelectionIntoView(view: EditorView): boolean {
  const stage = view.dom.closest<HTMLElement>('[data-editor-scroll-root]');
  if (!stage) return false;

  const selection = view.state.selection;
  const caret = view.coordsAtPos(selection.head);
  const stageBounds = stage.getBoundingClientRect();
  const toolbar = stage.querySelector<HTMLElement>('[data-editor-toolbar-stack]')
    ?? stage.querySelector<HTMLElement>('[role="toolbar"][aria-label="笔记格式工具栏"]');
  const toolbarBounds = toolbar?.getBoundingClientRect();
  const toolbarBottom = toolbarBounds && toolbarBounds.top <= stageBounds.top + 1
    ? toolbarBounds.bottom
    : stageBounds.top;
  const top = Math.max(stageBounds.top, toolbarBottom) + 10;
  const bottom = stageBounds.bottom - 16;

  if (caret.top < top) stage.scrollTop += caret.top - top;
  else if (caret.bottom > bottom) stage.scrollTop += caret.bottom - bottom;
  return true;
}
