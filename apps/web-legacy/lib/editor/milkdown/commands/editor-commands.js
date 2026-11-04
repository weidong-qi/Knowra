import { schemaCtx } from '@milkdown/kit/core';
import { getNodeFromSchema } from '@milkdown/kit/prose';
import { TextSelection } from '@milkdown/kit/prose/state';
import { $command } from '@milkdown/kit/utils';
import { toggleHighlightCommand } from '../schema/highlight-mark.js';
import { createCommandResolvers } from './command-resolvers.js';

export const insertLinkCommand = $command('InsertLink', () => () => (state, dispatch) => {
  const { selection } = state;
  const { $from, $to, empty } = selection;

  const linkText = empty ? 'link' : state.doc.textBetween($from.pos, $to.pos);
  const markdown = `[${linkText}](https://)`;

  const tr = empty
    ? state.tr.insertText(markdown, $from.pos)
    : state.tr.replaceWith($from.pos, $to.pos, state.schema.text(markdown));

  const urlStart = $from.pos + linkText.length + 3;
  const urlEnd = urlStart + 7;
  tr.setSelection(TextSelection.create(tr.doc, urlStart, urlEnd));
  dispatch(tr.scrollIntoView());
  return true;
});

export const insertImageBlockCommand = $command('InsertImage', (ctx) => () => (state, dispatch) => {
  const schema = ctx.get(schemaCtx);
  const imageBlockNodeType = getNodeFromSchema('image-block', schema);

  if (!imageBlockNodeType) {
    return false;
  }

  const node = imageBlockNodeType.create({
    src: '',
    caption: '',
    ratio: 1
  });

  const tr = state.tr.replaceSelectionWith(node, false);
  dispatch(tr.scrollIntoView());
  return true;
});

export const insertInternalLinkCommand = $command('InsertInternalLink', () => () => (state, dispatch) => {
  const { selection } = state;
  const { $from, $to, empty } = selection;

  const linkText = empty ? '内部链接' : state.doc.textBetween($from.pos, $to.pos);
  const markdown = `[[${linkText}]]`;

  const tr = empty
    ? state.tr.insertText(markdown, $from.pos)
    : state.tr.replaceWith($from.pos, $to.pos, state.schema.text(markdown));

  const linkStart = $from.pos + 2;
  const linkEnd = linkStart + linkText.length;
  tr.setSelection(TextSelection.create(tr.doc, linkStart, linkEnd));
  dispatch(tr.scrollIntoView());
  return true;
});

export const turnIntoTaskListCommand = $command('TurnIntoTaskList', (ctx) => () => (state, dispatch) => {
  const schema = ctx.get(schemaCtx);
  const paragraphNodeType = getNodeFromSchema('paragraph', schema);
  const listItemNodeType = getNodeFromSchema('list_item', schema);
  const bulletListNodeType = getNodeFromSchema('bullet_list', schema);

  if (!paragraphNodeType || !listItemNodeType || !bulletListNodeType) {
    return false;
  }

  const { $from, $to } = state.selection;
  const from = $from.start($from.depth);
  const to = $to.end($to.depth);

  const paragraphContent = state.doc.slice(from, to).content;
  const taskListItem = listItemNodeType.create(
    { checked: false },
    [paragraphNodeType.create(null, paragraphContent)]
  );
  const bulletList = bulletListNodeType.create(null, [taskListItem]);
  const tr = state.tr.replaceRangeWith(from, to, bulletList);
  dispatch(tr.scrollIntoView());
  return true;
});

export const commandResolvers = createCommandResolvers({
  insertImageBlockCommand,
  insertInternalLinkCommand,
  insertLinkCommand,
  toggleHighlightCommand,
  turnIntoTaskListCommand
});
