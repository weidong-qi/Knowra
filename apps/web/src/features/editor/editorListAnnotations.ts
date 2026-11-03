import type { Node as ProseNode } from '@milkdown/kit/prose/model';
import { anchorForListItem, type MarkdownProjection } from '@study-accelerator/content-anchor';

export function listItemAt(doc: ProseNode, position: number) {
  const resolved = doc.resolve(Math.max(0, Math.min(position, doc.content.size)));
  for (let depth = resolved.depth; depth > 0; depth--) {
    const node = resolved.node(depth);
    if (node.type.name === 'list_item') return {
      node, position: resolved.before(depth), depth,
      task: typeof node.attrs.checked === 'boolean',
      from: resolved.before(depth) + 1, to: resolved.before(depth) + node.nodeSize - 1
    };
  }
  return null;
}

export function editorListAnchor(doc: ProseNode, projection: MarkdownProjection, position: number) {
  const item = listItemAt(doc, position);
  if (!item || item.task) return null;
  const items: number[] = [];
  doc.descendants((node, pos) => { if (node.type.name === 'list_item') items.push(pos); });
  if (items.length !== projection.listItems.length) return null;
  const target = projection.listItems[items.indexOf(item.position)];
  if (!target) return null;
  const anchor = anchorForListItem(projection, target.path);
  return doc.textBetween(item.from, item.to, '\n', '\uFFFC') === anchor.quoteText ? anchor : null;
}

export function resolveEditorListRange(doc: ProseNode, path: string, quote: string) {
  if (!/^\d+(?:\.\d+)*$/.test(path)) return null;
  let node = doc, position = 0;
  for (const [depth, part] of path.split('.').entries()) {
    const index = Number(part);
    if (index >= node.childCount) return null;
    if (depth > 0) position++;
    for (let offset = 0; offset < index; offset++) position += node.child(offset).nodeSize;
    node = node.child(index);
  }
  if (node.type.name !== 'list_item' || typeof node.attrs.checked === 'boolean') return null;
  const from = position + 1, to = position + node.nodeSize - 1;
  return doc.textBetween(from, to, '\n', '\uFFFC') === quote ? { from, to } : null;
}
