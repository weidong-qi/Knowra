import { editorViewCtx } from '@milkdown/kit/core';
import { TextSelection } from '@milkdown/kit/prose/state';
import { resolveMatchNavigationIndex } from '../../find-navigation.js';
import {
  collectDocumentTextMatches,
  findHighlightPluginKey
} from '../plugins/find-highlight-plugin.js';

export async function findAndSelect(host, query, previousMatchIndex = -1, direction = 'next') {
  await host.ready;

  const needle = typeof query === 'string' ? query.trim() : '';
  if (!needle) {
    await clearSearchHighlights(host);
    return { found: false, count: 0, index: -1 };
  }

  const view = host.editor.ctx.get(editorViewCtx);
  const matches = collectDocumentTextMatches(view.state.doc, needle);
  if (!matches.length) {
    view.dispatch(
      view.state.tr
        .setMeta(findHighlightPluginKey, { query: needle, activeIndex: -1 })
        .setMeta('addToHistory', false)
    );
    return { found: false, count: 0, index: -1 };
  }

  const index = resolveMatchNavigationIndex({
    currentIndex: previousMatchIndex,
    matchCount: matches.length,
    direction
  });
  const match = matches[index];
  const selection = TextSelection.create(view.state.doc, match.from, match.to);
  view.dispatch(
    view.state.tr
      .setSelection(selection)
      .setMeta(findHighlightPluginKey, { query: needle, activeIndex: index })
      .setMeta('addToHistory', false)
      .scrollIntoView()
  );
  view.focus();

  return {
    found: true,
    count: matches.length,
    index
  };
}

export async function clearSearchHighlights(host) {
  await host.ready;
  const view = host.editor.ctx.get(editorViewCtx);
  view.dispatch(
    view.state.tr
      .setMeta(findHighlightPluginKey, { query: '', activeIndex: -1 })
      .setMeta('addToHistory', false)
  );
}
