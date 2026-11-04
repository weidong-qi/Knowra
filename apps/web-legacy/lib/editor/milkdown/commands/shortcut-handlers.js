import { editorViewCtx, rootCtx, schemaCtx } from '@milkdown/kit/core';
import { getNodeFromSchema } from '@milkdown/kit/prose';
import { TextSelection } from '@milkdown/kit/prose/state';
import {
  liftListItemCommand,
  setBlockTypeCommand,
  wrapInBulletListCommand,
  wrapInOrderedListCommand
} from '@milkdown/kit/preset/commonmark';
import { callCommand } from '@milkdown/kit/utils';
import { syncTableHandleLabels } from '../table/table-buttons.js';
import { findAncestorOfType } from '../utils/prosemirror-ranges.js';
import { insertCodeBlockAtTyporaPosition } from './code-block-insertion.js';

function isSelectionInsideSingleTextblock(state, typeName, attrs = null) {
  const { $from, $to } = state.selection;
  if ($from.parent !== $to.parent || $from.parent.type.name !== typeName) {
    return false;
  }

  if (!attrs) {
    return true;
  }

  return Object.entries(attrs).every(([key, value]) => $from.parent.attrs?.[key] === value);
}

function toggleParagraph(editor, schema) {
  const paragraphNodeType = getNodeFromSchema('paragraph', schema);
  if (!paragraphNodeType) {
    return false;
  }

  return executeCallCommand(editor, setBlockTypeCommand.key, {
    nodeType: paragraphNodeType,
    attrs: null
  });
}

function setHeadingLevel(editor, schema, level) {
  const headingNodeType = getNodeFromSchema('heading', schema);
  if (!headingNodeType) {
    return false;
  }

  return executeCallCommand(editor, setBlockTypeCommand.key, {
    nodeType: headingNodeType,
    attrs: { level }
  });
}

function executeCallCommand(editor, key, payload) {
  return editor.action(callCommand(key, payload));
}

export async function handleHeadingShortcut(editor, level) {
  const view = editor.ctx.get(editorViewCtx);
  const schema = editor.ctx.get(schemaCtx);

  if (isSelectionInsideSingleTextblock(view.state, 'heading', { level })) {
    return toggleParagraph(editor, schema);
  }

  return setHeadingLevel(editor, schema, level);
}

export async function handleParagraphShortcut(editor) {
  const schema = editor.ctx.get(schemaCtx);
  return toggleParagraph(editor, schema);
}

export async function handleListShortcut(editor, commandKey) {
  const view = editor.ctx.get(editorViewCtx);
  const schema = editor.ctx.get(schemaCtx);
  const targetTypeName = commandKey === 'ordered' ? 'ordered_list' : 'bullet_list';
  const otherTypeName = commandKey === 'ordered' ? 'bullet_list' : 'ordered_list';
  const targetNodeType = getNodeFromSchema(targetTypeName, schema);
  const listAncestor = findAncestorOfType(view.state.selection.$from, new Set(['bullet_list', 'ordered_list']));

  if (!targetNodeType) {
    return false;
  }

  if (listAncestor?.node.type.name === targetTypeName) {
    return executeCallCommand(editor, liftListItemCommand.key);
  }

  if (listAncestor?.node.type.name === otherTypeName) {
    const attrs = targetTypeName === 'ordered_list'
      ? { order: 1, spread: listAncestor.node.attrs?.spread ?? false }
      : { spread: listAncestor.node.attrs?.spread ?? false };
    const tr = view.state.tr.setNodeMarkup(listAncestor.pos, targetNodeType, attrs);
    view.dispatch(tr.scrollIntoView());
    return true;
  }

  const wrapCommand = commandKey === 'ordered' ? wrapInOrderedListCommand.key : wrapInBulletListCommand.key;
  return executeCallCommand(editor, wrapCommand);
}

export { handleIndentShortcut, handleOutdentShortcut } from './indentation-handlers.js';

export async function insertBlockBelowSelection(editor, commandResolvers, commandKey, options = {}) {
  const view = editor.ctx.get(editorViewCtx);
  const schema = editor.ctx.get(schemaCtx);
  const paragraphNodeType = getNodeFromSchema('paragraph', schema);
  const resolve = commandResolvers[commandKey];

  if (!paragraphNodeType || !resolve) {
    return false;
  }

  if (commandKey === 'codeblock') {
    const codeBlockNodeType = getNodeFromSchema('code_block', schema);
    const { payload } = resolve(options);
    return insertCodeBlockAtTyporaPosition(
      view,
      paragraphNodeType,
      codeBlockNodeType,
      payload
    );
  }

  if (!insertParagraphBelowSelection(view, paragraphNodeType)) {
    return false;
  }

  const { key, payload } = resolve(options);
  const result = await editor.action(callCommand(key, payload));
  syncTableHandleLabels(editor.ctx.get(rootCtx), null);
  view.focus();
  return result;
}

function insertParagraphBelowSelection(view, paragraphNodeType) {
  if (!paragraphNodeType) {
    return false;
  }

  const { state } = view;
  const { $from } = state.selection;
  const tableAncestor = findAncestorOfType($from, new Set(['table']));
  let blockDepth = tableAncestor?.depth ?? $from.depth;

  while (blockDepth > 0 && !tableAncestor && !$from.node(blockDepth).isTextblock) {
    blockDepth -= 1;
  }

  if (blockDepth <= 0) {
    return false;
  }

  const insertPos = $from.after(blockDepth);
  const tr = state.tr.insert(insertPos, paragraphNodeType.create());
  tr.setSelection(TextSelection.create(tr.doc, insertPos + 1));
  view.dispatch(tr.scrollIntoView());
  return true;
}

export async function insertParagraphNearSelection(editor, direction) {
  const view = editor.ctx.get(editorViewCtx);
  const schema = editor.ctx.get(schemaCtx);
  const paragraphNodeType = getNodeFromSchema('paragraph', schema);
  if (!paragraphNodeType) {
    return false;
  }

  const { $from } = view.state.selection;
  let textblockDepth = $from.depth;
  while (textblockDepth > 0 && !$from.node(textblockDepth).isTextblock) {
    textblockDepth -= 1;
  }

  if (textblockDepth <= 0) {
    return false;
  }

  const insertPos = direction === 'above'
    ? $from.before(textblockDepth)
    : $from.after(textblockDepth);
  const tr = view.state.tr.insert(insertPos, paragraphNodeType.create());
  tr.setSelection(TextSelection.create(tr.doc, insertPos + 1));
  view.dispatch(tr.scrollIntoView());
  return true;
}
