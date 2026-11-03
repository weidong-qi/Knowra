import { insertParagraphOutsideBlock } from './editorParagraphInsertion';
import { indentCode, unwrapCodeLines, removeEmptyCode } from './editorCodeCommands';
import { type Editor, editorViewCtx, schemaCtx } from '@milkdown/kit/core';
import { lift, setBlockType, wrapIn } from '@milkdown/kit/prose/commands';
import { getNodeFromSchema } from '@milkdown/kit/prose';
import { TextSelection, type EditorState, type Transaction } from '@milkdown/kit/prose/state';
import {
  liftListItemCommand,
  setBlockTypeCommand,
  sinkListItemCommand,
  wrapInBulletListCommand,
  wrapInOrderedListCommand
} from '@milkdown/kit/preset/commonmark';
import {
  goToNextTableCellCommand,
  goToPrevTableCellCommand
} from '@milkdown/kit/preset/gfm';
import { callCommand } from '@milkdown/kit/utils';

type ListTypeName = 'bullet_list' | 'ordered_list';

export function runParagraphCommand(editor: Editor): boolean {
  const schema = editor.ctx.get(schemaCtx);
  const paragraphNodeType = getNodeFromSchema('paragraph', schema);
  if (!paragraphNodeType) return false;
  return Boolean(editor.action(callCommand(setBlockTypeCommand.key, {
    nodeType: paragraphNodeType,
    attrs: null
  })));
}

export function runCodeBlockCommand(editor: Editor): boolean {
  const view = editor.ctx.get(editorViewCtx);
  return applyTyporaCodeBlockCommand(view.state, view.dispatch);
}

export function applyTyporaCodeBlockCommand(
  state: EditorState,
  dispatch?: (transaction: Transaction) => void
): boolean {
  const codeBlockNodeType = state.schema.nodes.code_block;
  const paragraphNodeType = state.schema.nodes.paragraph;
  if (!codeBlockNodeType || !paragraphNodeType) return false;

  const { selection } = state;
  const { $from } = selection;
  if ($from.parent.type === codeBlockNodeType && $from.sameParent(selection.$to)) return unwrapCodeLines(state, dispatch);
  let textblockDepth = $from.depth;
  while (textblockDepth > 0 && !$from.node(textblockDepth).isTextblock) textblockDepth -= 1;

  const currentTextblock = textblockDepth > 0 ? $from.node(textblockDepth) : null;
  const shouldInsertAfterCurrentLine = Boolean(
    currentTextblock
    && currentTextblock.type !== codeBlockNodeType
    && currentTextblock.content.size > 0
  );

  if (shouldInsertAfterCurrentLine) {
    const containerDepth = textblockDepth - 1;
    const container = $from.node(containerDepth);
    const insertionIndex = $from.indexAfter(containerDepth);
    if (container.canReplaceWith(insertionIndex, insertionIndex, codeBlockNodeType)) {
      const insertPos = $from.after(textblockDepth);
      const codeBlock = codeBlockNodeType.create({ language: '' });
      const transaction = state.tr.insert(insertPos, codeBlock);

      if (textblockDepth === 1 && insertPos === state.doc.content.size) {
        transaction.insert(insertPos + codeBlock.nodeSize, paragraphNodeType.create());
      }

      transaction.setSelection(TextSelection.create(transaction.doc, insertPos + 1));
      dispatch?.(transaction.scrollIntoView());
      return true;
    }
  }

  return setBlockType(codeBlockNodeType, { language: '' })(state, (transaction) => {
    if (transaction.doc.lastChild?.type === codeBlockNodeType) {
      transaction.insert(transaction.doc.content.size, paragraphNodeType.create());
    }
    dispatch?.(transaction.scrollIntoView());
  });
}

export function runHeadingCommand(editor: Editor, level: number): boolean {
  const view = editor.ctx.get(editorViewCtx);
  const schema = editor.ctx.get(schemaCtx);
  if (isSelectionInsideHeading(view.state, level)) return runParagraphCommand(editor);

  const headingNodeType = getNodeFromSchema('heading', schema);
  if (!headingNodeType) return false;
  return Boolean(editor.action(callCommand(setBlockTypeCommand.key, {
    nodeType: headingNodeType,
    attrs: { level }
  })));
}

export function runListCommand(editor: Editor, targetTypeName: ListTypeName): boolean {
  const view = editor.ctx.get(editorViewCtx);
  const schema = editor.ctx.get(schemaCtx);
  const targetNodeType = getNodeFromSchema(targetTypeName, schema);
  const listAncestor = findListAncestor(view.state.selection.$from);
  if (!targetNodeType) return false;

  if (listAncestor?.node.type.name === targetTypeName) {
    return Boolean(editor.action(callCommand(liftListItemCommand.key)));
  }

  if (listAncestor) {
    const attrs = targetTypeName === 'ordered_list'
      ? { order: 1, spread: listAncestor.node.attrs.spread ?? false }
      : { spread: listAncestor.node.attrs.spread ?? false };
    view.dispatch(view.state.tr.setNodeMarkup(listAncestor.pos, targetNodeType, attrs).scrollIntoView());
    return true;
  }

  const command = targetTypeName === 'ordered_list'
    ? wrapInOrderedListCommand
    : wrapInBulletListCommand;
  return Boolean(editor.action(callCommand(command.key)));
}

export function runDeleteSelectionCommand(editor: Editor): boolean {
  const view = editor.ctx.get(editorViewCtx);
  if (removeEmptyCode(view.state, view.dispatch)) return true;
  if (view.state.selection.empty) return false;
  view.dispatch(view.state.tr.deleteSelection().scrollIntoView());
  return true;
}

export function runIndentCommand(editor: Editor): boolean {
  const view = editor.ctx.get(editorViewCtx);
  if (view.state.selection.$from.parent.type.spec.code) return indentCode()(view.state, view.dispatch);
  if (isSelectionInsideTable(editor)) return false;
  if (findListAncestor(view.state.selection.$from)) {
    return Boolean(editor.action(callCommand(sinkListItemCommand.key)));
  }
  if (findBlockquoteAncestor(view.state.selection.$from)) {
    const blockquoteNodeType = getNodeFromSchema('blockquote', editor.ctx.get(schemaCtx));
    return blockquoteNodeType ? wrapIn(blockquoteNodeType)(view.state, view.dispatch) : false;
  }
  const { from, to } = view.state.selection;
  if (from === to) {
    view.dispatch(view.state.tr.insertText('    ', from).scrollIntoView());
    return true;
  }
  const transaction = view.state.tr;
  for (const position of collectSelectedTextblockStarts(view.state).reverse()) {
    transaction.insertText('    ', position);
  }
  view.dispatch(transaction.scrollIntoView());
  return true;
}

export function runOutdentCommand(editor: Editor): boolean {
  const view = editor.ctx.get(editorViewCtx);
  if (view.state.selection.$from.parent.type.spec.code) return indentCode(true)(view.state, view.dispatch);
  if (isSelectionInsideTable(editor)) return false;
  if (findListAncestor(view.state.selection.$from)) {
    return Boolean(editor.action(callCommand(liftListItemCommand.key)));
  }
  if (findBlockquoteAncestor(view.state.selection.$from)) {
    return lift(view.state, view.dispatch);
  }
  const transaction = view.state.tr;
  const removableRanges = collectSelectedTextblockStarts(view.state)
    .map((position) => {
      const node = view.state.doc.nodeAt(position - 1);
      const removable = node?.textContent.slice(0, 4).match(/^( {1,4}|\t)/)?.[0];
      return removable ? { from: position, to: position + removable.length } : null;
    })
    .filter((range): range is { from: number; to: number } => range !== null)
    .reverse();
  if (removableRanges.length === 0) return false;
  for (const range of removableRanges) transaction.delete(range.from, range.to);
  view.dispatch(transaction.scrollIntoView());
  return true;
}

export function isSelectionInsideTable(editor: Editor): boolean {
  const view = editor.ctx.get(editorViewCtx);
  return findTableAncestor(view.state.selection.$from);
}

export function runTableNavigationCommand(editor: Editor, direction: 'next' | 'previous'): boolean {
  const command = direction === 'next' ? goToNextTableCellCommand : goToPrevTableCellCommand;
  return Boolean(editor.action(callCommand(command.key)));
}

export function insertParagraphNearSelection(editor: Editor, direction: 'above' | 'below'): boolean {
  const view = editor.ctx.get(editorViewCtx);
  return insertParagraphOutsideBlock(direction)(view.state, view.dispatch);
}

function isSelectionInsideHeading(state: ReturnType<typeof getEditorState>, level: number): boolean {
  const { $from, $to } = state.selection;
  return $from.parent === $to.parent
    && $from.parent.type.name === 'heading'
    && $from.parent.attrs.level === level;
}

function getEditorState(editor: Editor) {
  return editor.ctx.get(editorViewCtx).state;
}

function findListAncestor($from: ReturnType<typeof getEditorState>['selection']['$from']) {
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    const node = $from.node(depth);
    if (node.type.name === 'bullet_list' || node.type.name === 'ordered_list') {
      return { node, pos: $from.before(depth) };
    }
  }
  return null;
}

function findBlockquoteAncestor($from: ReturnType<typeof getEditorState>['selection']['$from']) {
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    if ($from.node(depth).type.name === 'blockquote') return true;
  }
  return false;
}

function findTableAncestor($from: ReturnType<typeof getEditorState>['selection']['$from']) {
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    if ($from.node(depth).type.name === 'table') return true;
  }
  return false;
}

function collectSelectedTextblockStarts(state: ReturnType<typeof getEditorState>): number[] {
  const { from, to, $from } = state.selection;
  if (from === to) return [$from.start()];

  const starts = new Set<number>();
  state.doc.nodesBetween(from, to, (node, position) => {
    if (node.isTextblock) starts.add(position + 1);
  });
  if ($from.parent.isTextblock) starts.add($from.start());
  return [...starts].sort((left, right) => left - right);
}
