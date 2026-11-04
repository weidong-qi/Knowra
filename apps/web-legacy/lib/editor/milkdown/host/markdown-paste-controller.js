import { editorViewCtx } from '@milkdown/kit/core';
import { normalizeMarkdown, parseMarkdownSlice } from '../utils/markdown-slice.js';
import {
  rememberCurrentSelection,
  restoreLastSelection
} from './selection-memory-controller.js';

export async function pasteMarkdown(host, markdown) {
  await host.ready;

  const text = normalizeMarkdown(markdown);
  if (!text) {
    return false;
  }

  const view = host.editor.ctx.get(editorViewCtx);
  if (typeof view.hasFocus === 'function' && !view.hasFocus()) {
    restoreLastSelection(host);
  }
  const slice = parseMarkdownSlice(host.editor.ctx, text);
  if (!slice) {
    return false;
  }

  view.dispatch(view.state.tr.replaceSelection(slice).scrollIntoView());
  view.focus();
  rememberCurrentSelection(host);
  return true;
}
