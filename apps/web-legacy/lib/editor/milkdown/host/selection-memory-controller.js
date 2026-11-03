import { editorViewCtx } from '@milkdown/kit/core';
import { TextSelection } from '@milkdown/kit/prose/state';

export function attachSelectionMemory(host) {
  const root = host?.root;
  if (!(root instanceof HTMLElement)) {
    return () => {};
  }

  const rememberSelection = () => rememberCurrentSelection(host);
  const rememberFocusedSelection = () => {
    if (isEditorFocusActive(host)) {
      rememberCurrentSelection(host);
    }
  };

  root.addEventListener('focusin', rememberSelection, true);
  root.addEventListener('mouseup', rememberSelection, true);
  root.addEventListener('keyup', rememberSelection, true);
  document.addEventListener('selectionchange', rememberFocusedSelection, true);

  rememberCurrentSelection(host);

  return () => {
    root.removeEventListener('focusin', rememberSelection, true);
    root.removeEventListener('mouseup', rememberSelection, true);
    root.removeEventListener('keyup', rememberSelection, true);
    document.removeEventListener('selectionchange', rememberFocusedSelection, true);
  };
}

export function rememberCurrentSelection(host) {
  const view = host?.editor?.ctx.get(editorViewCtx);
  const selection = view?.state?.selection;
  if (!view || !selection) {
    return false;
  }

  host.lastSelectionRange = {
    from: selection.from,
    to: selection.to
  };
  return true;
}

export function restoreLastSelection(host) {
  const view = host?.editor?.ctx.get(editorViewCtx);
  const selection = host?.lastSelectionRange;
  const docSize = view?.state?.doc?.content?.size ?? 0;
  if (!view || !selection) {
    return false;
  }

  const from = clampSelectionPosition(selection.from, docSize);
  const to = clampSelectionPosition(selection.to, docSize);
  const nextSelection = TextSelection.create(view.state.doc, Math.min(from, to), Math.max(from, to));
  const transaction = view.state.tr.setSelection(nextSelection).scrollIntoView();
  view.dispatch(transaction);
  view.focus();
  rememberCurrentSelection(host);
  return true;
}

function isEditorFocusActive(host) {
  const view = host?.editor?.ctx.get(editorViewCtx);
  if (!view) {
    return false;
  }

  if (typeof view.hasFocus === 'function' && view.hasFocus()) {
    return true;
  }

  const activeElement = document.activeElement;
  return activeElement instanceof Node && host.root?.contains(activeElement);
}

function clampSelectionPosition(value, max) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    return 0;
  }

  return Math.max(0, Math.min(Math.trunc(numericValue), max));
}
