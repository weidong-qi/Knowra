import { TextSelection } from '@milkdown/kit/prose/state';
import { $command, $markSchema } from '@milkdown/kit/utils';
import { createDelimitedRemark } from './editorMarkdownMarks';

export const internalLinkRemark = createDelimitedRemark(
  'internal-link',
  /\[\[([^\]\n]+?)\]\]/g,
  'internalLink'
);

export const internalLinkSchema = $markSchema('internalLink', () => ({
  parseDOM: [{ tag: 'span[data-internal-link]' }],
  toDOM: () => ['span', { 'data-internal-link': '' }, 0],
  parseMarkdown: {
    match: (node) => node.type === 'internalLink',
    runner: (state, node, markType) => {
      state.openMark(markType);
      state.next(node.children);
      state.closeMark(markType);
    }
  },
  toMarkdown: {
    match: (mark) => mark.type.name === 'internalLink',
    runner: (state, mark) => {
      state.withMark(mark, 'internalLink');
    }
  }
}));

export const insertInternalLinkCommand = $command('InsertInternalLink', (ctx) => () => (state, dispatch) => {
  const { from, to, empty } = state.selection;
  const mark = internalLinkSchema.type(ctx).create();
  const transaction = state.tr;
  if (empty) {
    const linkText = '内部链接';
    transaction.insertText(linkText, from).addMark(from, from + linkText.length, mark);
    transaction.setSelection(TextSelection.create(transaction.doc, from, from + linkText.length));
  } else {
    transaction.addMark(from, to, mark);
    transaction.setSelection(TextSelection.create(transaction.doc, from, to));
  }
  dispatch?.(transaction.scrollIntoView());
  return true;
});
