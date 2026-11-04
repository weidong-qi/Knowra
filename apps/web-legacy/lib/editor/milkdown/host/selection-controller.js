import { editorViewCtx } from '@milkdown/kit/core';
import { TextSelection } from '@milkdown/kit/prose/state';

export async function getSelectionSnapshot(host, { contextChars = 80 } = {}) {
  await host.ready;
  const view = host.editor.ctx.get(editorViewCtx);
  const { selection, doc } = view.state;
  if (selection.empty) {
    return null;
  }

  const from = Math.min(selection.from, selection.to);
  const to = Math.max(selection.from, selection.to);
  const sourceText = doc.textBetween(from, to, '\n', '\n').replace(/\s+/g, ' ').trim();
  if (!sourceText) {
    return null;
  }

  const contextBefore = doc
    .textBetween(Math.max(0, from - contextChars), from, '\n', '\n')
    .replace(/\s+/g, ' ')
    .slice(-contextChars);
  const contextAfter = doc
    .textBetween(to, Math.min(doc.content.size, to + contextChars), '\n', '\n')
    .replace(/\s+/g, ' ')
    .slice(0, contextChars);

  return {
    sourceText,
    startOffset: from,
    endOffset: to,
    contextBefore,
    contextAfter,
    anchor: {
      type: 'prosemirror-text-range',
      from,
      to
    }
  };
}

export async function selectTextRange(host, { startNode, startOffset, endNode, endOffset } = {}) {
  await host.ready;

  if (!startNode || !endNode) {
    return false;
  }

  const view = host.editor.ctx.get(editorViewCtx);
  const from = view.posAtDOM(startNode, startOffset ?? 0);
  const to = view.posAtDOM(endNode, endOffset ?? 0);

  if (typeof from !== 'number' || typeof to !== 'number') {
    return false;
  }

  const selection = TextSelection.create(view.state.doc, Math.min(from, to), Math.max(from, to));
  const transaction = view.state.tr.setSelection(selection).scrollIntoView();
  view.dispatch(transaction);
  view.focus();
  return true;
}
