import { Plugin, PluginKey } from '@milkdown/kit/prose/state';
import { Decoration, DecorationSet } from '@milkdown/kit/prose/view';
import { $prose } from '@milkdown/kit/utils';

export const annotationHighlightPluginKey = new PluginKey('KNOWRA_ANNOTATION_HIGHLIGHTS');

const normalized = (text) => String(text ?? '').replace(/\s+/g, ' ').trim();

function isDocumentRange(doc, range) {
  const documentSize = doc?.content?.size;
  return Number.isInteger(range.from)
    && Number.isInteger(range.to)
    && Number.isInteger(documentSize)
    && range.from >= 0
    && range.to > range.from
    && range.to <= documentSize;
}

export function resolveAnnotationRange(doc, annotation) {
  const quoteText = String(annotation?.quoteText ?? '');
  if (!quoteText || !doc) {
    return null;
  }

  const direct = {
    from: annotation.fromPosition,
    to: annotation.toPosition
  };
  if (
    isDocumentRange(doc, direct)
    && normalized(doc.textBetween(direct.from, direct.to, '\n', '\n')) === normalized(quoteText)
  ) {
    return direct;
  }

  const matches = [];
  doc.descendants((node, position) => {
    if (!node.isText) {
      return;
    }

    const nodeText = String(node.text ?? '');
    let index = nodeText.indexOf(quoteText);
    while (index >= 0) {
      matches.push({
        from: position + index,
        to: position + index + quoteText.length
      });
      index = nodeText.indexOf(quoteText, index + 1);
    }
  });

  return matches.length === 1 ? matches[0] : null;
}

function createAnnotationDecorations(doc, annotations) {
  return annotations
    .filter((item) => item.status === 'active')
    .map((item) => {
      const range = resolveAnnotationRange(doc, item);
      if (!range || !isDocumentRange(doc, range)) {
        return null;
      }

      return Decoration.inline(range.from, range.to, {
        class: 'annotation-marker',
        'data-annotation-id': item.id,
        title: '重要内容标注'
      });
    })
    .filter(Boolean);
}

export const annotationHighlightBehavior = $prose(() => new Plugin({
  key: annotationHighlightPluginKey,
  state: {
    init: () => ({ annotations: [], decorations: DecorationSet.empty }),
    apply(transaction, previousState) {
      const pluginMeta = transaction.getMeta(annotationHighlightPluginKey);
      const annotations = Array.isArray(pluginMeta?.annotations)
        ? pluginMeta.annotations
        : (previousState?.annotations ?? []);

      if (!transaction.docChanged && !pluginMeta) {
        return previousState;
      }

      const decorations = createAnnotationDecorations(transaction.doc, annotations);
      return {
        annotations,
        decorations: decorations.length
          ? DecorationSet.create(transaction.doc, decorations)
          : DecorationSet.empty
      };
    }
  },
  props: {
    decorations: (state) => annotationHighlightPluginKey.getState(state)?.decorations ?? null,
    handleDOMEvents: {
      click(view, event) {
        const marker = event.target instanceof Element
          ? event.target.closest('[data-annotation-id]')
          : null;
        if (!marker) {
          return false;
        }

        event.preventDefault();
        view.dom.dispatchEvent(new CustomEvent('annotation-marker-click', {
          bubbles: true,
          detail: { annotationId: marker.dataset.annotationId }
        }));
        return true;
      }
    }
  }
}));
