import { editorViewCtx, schemaCtx } from '@milkdown/kit/core';
import { lift } from '@milkdown/kit/prose/commands';
import {
  liftListItemCommand,
  sinkListItemCommand,
  wrapInBlockquoteCommand
} from '@milkdown/kit/preset/commonmark';
import { callCommand } from '@milkdown/kit/utils';
import { resolveIndentBehavior } from '../../enter-behavior.js';
import { findAncestorOfType } from '../utils/prosemirror-ranges.js';
import {
  indentContinuationParagraph,
  isContinuationParagraph,
  outdentContinuationParagraph
} from './indentation-continuation.js';

function executeCallCommand(editor, key, payload) {
  return editor.action(callCommand(key, payload));
}

export async function handleIndentShortcut(editor) {
  const view = editor.ctx.get(editorViewCtx);
  const schema = editor.ctx.get(schemaCtx);
  const { $from } = view.state.selection;

  const tableAncestor = findAncestorOfType($from, new Set(['table', 'table_cell', 'table_header']));
  const listItemAncestor = findAncestorOfType($from, new Set(['list_item']));
  const blockquoteAncestor = findAncestorOfType($from, new Set(['blockquote']));
  const behavior = resolveIndentBehavior({
    direction: 'in',
    inTable: Boolean(tableAncestor),
    inListItem: Boolean(listItemAncestor),
    inBlockquote: Boolean(blockquoteAncestor),
    parentType: $from.parent.type.name
  });

  if (behavior === 'table-navigation') {
    return false;
  }

  if (behavior === 'sink-list-item') {
    if (isContinuationParagraph($from, listItemAncestor)) {
      return indentContinuationParagraph(view, schema, $from, listItemAncestor);
    }

    return executeCallCommand(editor, sinkListItemCommand.key);
  }

  if (behavior === 'deepen-blockquote') {
    return executeCallCommand(editor, wrapInBlockquoteCommand.key);
  }

  if (behavior === 'indent-textblock') {
    return insertTextIndent(view);
  }

  return false;
}

function insertTextIndent(view) {
  const { state } = view;
  const tr = state.tr.insertText('    ', state.selection.from, state.selection.to);
  view.dispatch(tr.scrollIntoView());
  view.focus();
  return true;
}

function removeTextIndent(view) {
  const { state } = view;
  const { $from } = state.selection;
  const text = $from.parent.textContent;
  const lineStartOffset = text.lastIndexOf('\n', Math.max(0, $from.parentOffset - 1)) + 1;
  const removable = text.slice(lineStartOffset, lineStartOffset + 4).match(/^( {1,4}|\t)/)?.[0] ?? '';

  if (!removable) {
    return false;
  }

  const lineStartPos = $from.start() + lineStartOffset;
  const tr = state.tr.delete(lineStartPos, lineStartPos + removable.length);
  view.dispatch(tr.scrollIntoView());
  view.focus();
  return true;
}

export async function handleOutdentShortcut(editor) {
  const view = editor.ctx.get(editorViewCtx);
  const schema = editor.ctx.get(schemaCtx);
  const { $from } = view.state.selection;

  const tableAncestor = findAncestorOfType($from, new Set(['table', 'table_cell', 'table_header']));
  const listItemAncestor = findAncestorOfType($from, new Set(['list_item']));
  const blockquoteAncestor = findAncestorOfType($from, new Set(['blockquote']));
  const behavior = resolveIndentBehavior({
    direction: 'out',
    inTable: Boolean(tableAncestor),
    inListItem: Boolean(listItemAncestor),
    inBlockquote: Boolean(blockquoteAncestor),
    parentType: $from.parent.type.name
  });

  if (behavior === 'table-navigation') {
    return false;
  }

  if (behavior === 'lift-list-item') {
    if (isContinuationParagraph($from, listItemAncestor)) {
      return outdentContinuationParagraph(view, schema, $from, listItemAncestor);
    }

    return executeCallCommand(editor, liftListItemCommand.key);
  }

  if (behavior === 'lift-block') {
    return lift(view.state, (tr) => {
      view.dispatch(tr.scrollIntoView());
    });
  }

  if (behavior === 'outdent-textblock') {
    return removeTextIndent(view);
  }

  return false;
}
