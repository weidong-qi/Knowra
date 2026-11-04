import { $remark } from '@milkdown/kit/utils';

interface MarkdownNode {
  type: string;
  value?: string;
  children?: MarkdownNode[];
}

export function createDelimitedRemark(id: string, pattern: RegExp, nodeType: string) {
  return $remark(id, () => () => (tree) => {
    const visit = (node: MarkdownNode): MarkdownNode[] => {
      if (node.type === 'text' && typeof node.value === 'string') {
        const matches = [...node.value.matchAll(pattern)];
        if (matches.length > 0) {
          const nodes: MarkdownNode[] = [];
          let lastIndex = 0;
          for (const match of matches) {
            const matchIndex = match.index;
            if (matchIndex > lastIndex) nodes.push({ type: 'text', value: node.value.slice(lastIndex, matchIndex) });
            nodes.push({ type: nodeType, children: [{ type: 'text', value: match[1] }] });
            lastIndex = matchIndex + match[0].length;
          }
          if (lastIndex < node.value.length) nodes.push({ type: 'text', value: node.value.slice(lastIndex) });
          return nodes;
        }
      }
      if (node.children) node.children = node.children.flatMap(visit);
      return [node];
    };
    tree.children = tree.children.flatMap((node) => visit(node as MarkdownNode)) as typeof tree.children;
  });
}
