import type { Node as ProseNode } from '@milkdown/kit/prose/model';

export function listItemAt(doc: ProseNode, position: number) {
  const resolved = doc.resolve(Math.max(0, Math.min(position, doc.content.size)));
  for (let depth = resolved.depth; depth > 0; depth--) {
    const node = resolved.node(depth);
    if (node.type.name === 'list_item')
      return {
        node,
        position: resolved.before(depth),
        depth,
        task: typeof node.attrs.checked === 'boolean',
        from: resolved.before(depth) + 1,
        to: resolved.before(depth) + node.nodeSize - 1
      };
  }
  return null;
}
