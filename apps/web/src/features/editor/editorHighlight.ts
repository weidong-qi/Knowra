import { toggleMark } from '@milkdown/kit/prose/commands';
import { $command, $markSchema } from '@milkdown/kit/utils';
import { createDelimitedRemark } from './editorMarkdownMarks';

export const highlightRemark = createDelimitedRemark('highlight', /==([^=\n]+?)==/g, 'highlight');

export const highlightSchema = $markSchema('highlight', () => ({
  parseDOM: [{ tag: 'mark' }],
  toDOM: () => ['mark', 0],
  parseMarkdown: {
    match: (node) => node.type === 'highlight',
    runner: (state, node, markType) => {
      state.openMark(markType);
      state.next(node.children);
      state.closeMark(markType);
    }
  },
  toMarkdown: {
    match: (mark) => mark.type.name === 'highlight',
    runner: (state, mark) => {
      state.withMark(mark, 'highlight');
    }
  }
}));

export const toggleHighlightCommand = $command('ToggleHighlight', (ctx) => () => (
  toggleMark(highlightSchema.type(ctx))
));
