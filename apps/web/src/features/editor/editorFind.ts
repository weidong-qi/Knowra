import { type Editor, editorViewCtx } from '@milkdown/kit/core';
import type { Node as ProseNode } from '@milkdown/kit/prose/model';
import { Plugin, PluginKey, TextSelection } from '@milkdown/kit/prose/state';
import { Decoration, DecorationSet } from '@milkdown/kit/prose/view';
import { $prose } from '@milkdown/kit/utils';
import type { EditorFindDirection, EditorFindResult } from './editorCommands';

interface TextMatch {
  from: number;
  to: number;
}

export const findHighlightPluginKey = new PluginKey('KNOWRA_V4_FIND_HIGHLIGHTS');

export const findHighlightBehavior = $prose(() => new Plugin({
  key: findHighlightPluginKey,
  state: {
    init: () => ({ query: '', activeIndex: -1, decorations: DecorationSet.empty }),
    apply(transaction, pluginState) {
      const meta = transaction.getMeta(findHighlightPluginKey) as { query?: string; activeIndex?: number } | undefined;
      if (!meta && !transaction.docChanged) return pluginState;
      const query = typeof meta?.query === 'string' ? meta.query : pluginState.query;
      const activeIndex = typeof meta?.activeIndex === 'number' ? meta.activeIndex : pluginState.activeIndex;
      return { query, activeIndex, decorations: buildFindDecorations(transaction.doc, query, activeIndex) };
    }
  },
  props: {
    decorations(state) {
      return findHighlightPluginKey.getState(state)?.decorations ?? null;
    }
  }
}));

export function collectDocumentTextMatches(doc: ProseNode, query: string): TextMatch[] {
  const needle = query.trim();
  if (!needle) return [];
  const matches: TextMatch[] = [];
  doc.descendants((node, pos) => {
    if (!node.isText || !node.text) return;
    let startIndex = node.text.indexOf(needle);
    while (startIndex !== -1) {
      matches.push({ from: pos + startIndex, to: pos + startIndex + needle.length });
      startIndex = node.text.indexOf(needle, startIndex + Math.max(1, needle.length));
    }
  });
  return matches;
}

export function resolveMatchNavigationIndex(currentIndex: number, matchCount: number, direction: EditorFindDirection): number {
  if (matchCount <= 0) return -1;
  if (direction === 'previous') return currentIndex < 0 ? matchCount - 1 : (currentIndex - 1 + matchCount) % matchCount;
  return currentIndex < 0 ? 0 : (currentIndex + 1) % matchCount;
}

export function findAndSelect(editor: Editor, query: string, currentIndex: number, direction: EditorFindDirection): EditorFindResult {
  const view = editor.ctx.get(editorViewCtx);
  const needle = query.trim();
  const matches = collectDocumentTextMatches(view.state.doc, needle);
  const index = resolveMatchNavigationIndex(currentIndex, matches.length, direction);
  if (index < 0) {
    dispatchFindMeta(editor, needle, -1);
    return { found: false, count: 0, index: -1 };
  }
  const match = matches[index];
  view.dispatch(view.state.tr
    .setSelection(TextSelection.create(view.state.doc, match.from, match.to))
    .setMeta(findHighlightPluginKey, { query: needle, activeIndex: index })
    .setMeta('addToHistory', false)
    .scrollIntoView());
  view.focus();
  return { found: true, count: matches.length, index };
}

export function replaceCurrentMatch(editor: Editor, query: string, replacement: string, currentIndex: number): EditorFindResult {
  const view = editor.ctx.get(editorViewCtx);
  const needle = query.trim();
  const matches = collectDocumentTextMatches(view.state.doc, needle);
  const index = currentIndex >= 0 && currentIndex < matches.length ? currentIndex : 0;
  const match = matches[index];
  if (!match) return { found: false, count: 0, index: -1, replaced: 0 };

  let transaction = view.state.tr.insertText(replacement, match.from, match.to);
  const remainingMatches = collectDocumentTextMatches(transaction.doc, needle);
  const nextIndex = remainingMatches.length > 0 ? Math.min(index, remainingMatches.length - 1) : -1;
  if (nextIndex >= 0) {
    const nextMatch = remainingMatches[nextIndex];
    transaction = transaction.setSelection(TextSelection.create(transaction.doc, nextMatch.from, nextMatch.to));
  }
  view.dispatch(transaction
    .setMeta(findHighlightPluginKey, { query: needle, activeIndex: nextIndex })
    .scrollIntoView());
  view.focus();
  return { found: remainingMatches.length > 0, count: remainingMatches.length, index: nextIndex, replaced: 1 };
}

export function replaceAllMatches(editor: Editor, query: string, replacement: string): EditorFindResult {
  const view = editor.ctx.get(editorViewCtx);
  const needle = query.trim();
  const matches = collectDocumentTextMatches(view.state.doc, needle);
  if (!matches.length) return { found: false, count: 0, index: -1, replaced: 0 };
  let transaction = view.state.tr;
  for (let index = matches.length - 1; index >= 0; index -= 1) {
    const match = matches[index];
    transaction = transaction.insertText(replacement, match.from, match.to);
  }
  view.dispatch(transaction.setMeta(findHighlightPluginKey, { query: '', activeIndex: -1 }).scrollIntoView());
  view.focus();
  return { found: false, count: 0, index: -1, replaced: matches.length };
}

export function clearFindHighlights(editor: Editor): void {
  dispatchFindMeta(editor, '', -1);
}

function dispatchFindMeta(editor: Editor, query: string, activeIndex: number): void {
  const view = editor.ctx.get(editorViewCtx);
  view.dispatch(view.state.tr
    .setMeta(findHighlightPluginKey, { query, activeIndex })
    .setMeta('addToHistory', false));
}

function buildFindDecorations(doc: ProseNode, query: string, activeIndex: number): DecorationSet {
  const matches = collectDocumentTextMatches(doc, query);
  if (!matches.length) return DecorationSet.empty;
  return DecorationSet.create(doc, matches.map((match, index) => Decoration.inline(match.from, match.to, {
    class: index === activeIndex ? 'editor-find-match editor-find-match-active' : 'editor-find-match'
  })));
}
