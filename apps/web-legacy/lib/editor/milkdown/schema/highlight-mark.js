import { toggleMark } from '@milkdown/kit/prose/commands';
import { $command, $markSchema, $remark } from '@milkdown/kit/utils';

export const highlightRemark = $remark('highlight', () => () => (tree) => {
  const visit = (node) => {
    if (node.type === 'text' && typeof node.value === 'string' && /==[^=\n]+?==/.test(node.value)) {
      const out = [];
      const re = /==([^=\n]+?)==/g;
      let last = 0;
      let m;
      while ((m = re.exec(node.value)) !== null) {
        if (m.index > last) out.push({ type: 'text', value: node.value.slice(last, m.index) });
        out.push({ type: 'highlight', children: [{ type: 'text', value: m[1] }] });
        last = m.index + m[0].length;
      }
      if (last < node.value.length) out.push({ type: 'text', value: node.value.slice(last) });
      return out;
    }
    if (Array.isArray(node.children)) {
      node.children = node.children.flatMap(visit);
    }
    return [node];
  };
  tree.children = tree.children.flatMap(visit);
});

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
    runner: (state, mark, node) => {
      state.addNode('text', undefined, '==');
      state.addNode('text', undefined, node.text || '');
      state.addNode('text', undefined, '==');
    }
  }
}));

export const toggleHighlightCommand = $command('ToggleHighlight', (ctx) => () => {
  return toggleMark(highlightSchema.type(ctx));
});

