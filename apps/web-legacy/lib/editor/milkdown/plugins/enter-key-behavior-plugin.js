import { schemaCtx } from '@milkdown/kit/core';
import { getNodeFromSchema } from '@milkdown/kit/prose';
import { liftEmptyBlock, splitBlock } from '@milkdown/kit/prose/commands';
import { Plugin, PluginKey, TextSelection } from '@milkdown/kit/prose/state';
import { $prose } from '@milkdown/kit/utils';
import {
  resolveBackspaceBehavior,
  resolveEnterBehavior,
  shouldKeepTrailingBlank
} from '../../enter-behavior.js';
import { findAncestorOfType } from '../utils/prosemirror-ranges.js';

function getLastTextblockInfo(doc) {
  let lastBlock = null;
  doc.descendants((node, pos) => {
    if (node.isTextblock) {
      lastBlock = { node, pos };
    }
  });
  return lastBlock;
}

function getTrailingBlankCount(doc) {
  const textblocks = [];
  doc.descendants((node) => {
    if (node.isTextblock) {
      textblocks.push(node);
    }
  });

  let count = 0;
  for (let index = textblocks.length - 1; index >= 0; index -= 1) {
    const node = textblocks[index];
    if (node.type.name !== 'paragraph' || node.textContent.trim().length > 0) {
      break;
    }
    count += 1;
  }

  return count;
}

function getStructuredContext($from) {
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    const typeName = $from.node(depth).type.name;
    if (typeName === 'list_item' || typeName === 'blockquote') {
      return { type: typeName, depth };
    }
  }

  return null;
}

function exitTableWithParagraph(view, paragraphNodeType, depth) {
  if (!paragraphNodeType || typeof depth !== 'number') {
    return false;
  }

  const { state } = view;
  const insertPos = state.selection.$from.after(depth);
  const tr = state.tr.insert(insertPos, paragraphNodeType.create());
  tr.setSelection(TextSelection.create(tr.doc, insertPos + 1));
  view.dispatch(tr.scrollIntoView());
  return true;
}

function handleTrailingBlankEnter(view, paragraphNodeType) {
  if (!paragraphNodeType) {
    return false;
  }

  let nextTransaction = null;
  const didSplit = splitBlock(view.state, (tr) => {
    nextTransaction = tr;
  });

  if (!didSplit || !nextTransaction) {
    return false;
  }

  const selectionPos = nextTransaction.selection.from;
  const insertPos = nextTransaction.selection.$from.after(nextTransaction.selection.$from.depth);
  nextTransaction.insert(insertPos, paragraphNodeType.create());
  nextTransaction.setSelection(TextSelection.create(nextTransaction.doc, selectionPos));
  view.dispatch(nextTransaction.scrollIntoView());
  return true;
}

function handleStructuredBackspace(view) {
  const { state } = view;
  if (!state.selection.empty || !state.selection.$from.parent.isTextblock) {
    return false;
  }

  const { $from } = state.selection;
  const structuredContext = getStructuredContext($from);
  const parentType = structuredContext?.type ?? $from.parent.type.name;
  const parentIsBlank = $from.parent.textContent.trim().length === 0;
  const behavior = resolveBackspaceBehavior({
    parentType,
    parentIsBlank,
    atLineStart: $from.parentOffset === 0
  });

  if (behavior !== 'exit-structured-block') {
    return false;
  }

  return liftEmptyBlock(state, (tr) => {
    view.dispatch(tr.scrollIntoView());
  });
}

export const enhancedEnterBehavior = $prose((ctx) => {
  const schema = ctx.get(schemaCtx);
  const paragraphNodeType = getNodeFromSchema('paragraph', schema);

  return new Plugin({
    key: new PluginKey('STUDY_ENHANCED_ENTER_BEHAVIOR'),
    props: {
      handleKeyDown(view, event) {
        if (
          event.key === 'Backspace'
          && !event.shiftKey
          && !event.altKey
          && !event.metaKey
          && !event.ctrlKey
        ) {
          const handled = handleStructuredBackspace(view);
          if (handled) {
            event.preventDefault();
          }
          return handled;
        }

        if (
          event.key !== 'Enter'
          || event.shiftKey
          || event.altKey
          || event.metaKey
          || event.ctrlKey
        ) {
          return false;
        }

        const { state } = view;
        if (!state.selection.empty || !state.selection.$from.parent.isTextblock) {
          return false;
        }

        const { $from } = state.selection;
        const tableAncestor = findAncestorOfType($from, new Set(['table']));
        if (tableAncestor) {
          event.preventDefault();
          return exitTableWithParagraph(view, paragraphNodeType, tableAncestor.depth);
        }

        const structuredContext = getStructuredContext($from);
        const parentType = structuredContext?.type ?? $from.parent.type.name;
        const parentIsBlank = $from.parent.textContent.trim().length === 0;
        const behavior = resolveEnterBehavior({ parentType, parentIsBlank });

        if (behavior === 'exit-structured-block') {
          const lifted = liftEmptyBlock(state, (tr) => {
            view.dispatch(tr.scrollIntoView());
          });
          if (lifted) {
            event.preventDefault();
          }
          return lifted;
        }

        const lastTextblock = getLastTextblockInfo(state.doc);
        const currentBlockPos = $from.before($from.depth);
        const shouldAppendTrailingBlank = shouldKeepTrailingBlank({
          docIsEmpty: state.doc.textContent.trim().length === 0,
          atDocEnd: (
            $from.parentOffset === $from.parent.content.size
            && lastTextblock?.pos === currentBlockPos
          ),
          currentBlockIsBlank: $from.parent.textContent.trim().length === 0,
          trailingBlankCount: getTrailingBlankCount(state.doc),
          parentType: $from.parent.type.name
        });

        if (!shouldAppendTrailingBlank) {
          return false;
        }

        event.preventDefault();
        return handleTrailingBlankEnter(view, paragraphNodeType);
      }
    }
  });
});
