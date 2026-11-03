import { Plugin, PluginKey } from '@milkdown/kit/prose/state';
import { Decoration, DecorationSet } from '@milkdown/kit/prose/view';
import { $prose } from '@milkdown/kit/utils';

export const findHighlightPluginKey = new PluginKey('STUDY_FIND_HIGHLIGHTS');

export const findHighlightBehavior = $prose(() => new Plugin({
  key: findHighlightPluginKey,
  state: {
    init: () => ({
      query: '',
      activeIndex: -1,
      decorations: DecorationSet.empty
    }),
    apply(transaction, pluginState) {
      const meta = transaction.getMeta(findHighlightPluginKey);
      const query = typeof meta?.query === 'string' ? meta.query : pluginState.query;
      const activeIndex = typeof meta?.activeIndex === 'number' ? meta.activeIndex : pluginState.activeIndex;

      if (!meta && !transaction.docChanged) {
        return pluginState;
      }

      return {
        query,
        activeIndex,
        decorations: buildFindDecorations(transaction.doc, query, activeIndex)
      };
    }
  },
  props: {
    decorations(state) {
      return findHighlightPluginKey.getState(state)?.decorations ?? null;
    }
  }
}));
export function collectDocumentTextMatches(doc, needle) {
  const matches = [];

  doc.descendants((node, pos) => {
    if (!node.isText || !node.text) {
      return;
    }

    let startIndex = node.text.indexOf(needle);
    while (startIndex !== -1) {
      const from = pos + startIndex;
      const to = from + needle.length;
      matches.push({ from, to });
      startIndex = node.text.indexOf(needle, startIndex + Math.max(1, needle.length));
    }
  });

  return matches;
}

function buildFindDecorations(doc, query, activeIndex) {
  const needle = typeof query === 'string' ? query.trim() : '';
  if (!needle) {
    return DecorationSet.empty;
  }

  const matches = collectDocumentTextMatches(doc, needle);
  if (!matches.length) {
    return DecorationSet.empty;
  }

  return DecorationSet.create(
    doc,
    matches.map((match, index) => Decoration.inline(match.from, match.to, {
      class: index === activeIndex
        ? 'editor-find-match editor-find-match-active'
        : 'editor-find-match'
    }))
  );
}

