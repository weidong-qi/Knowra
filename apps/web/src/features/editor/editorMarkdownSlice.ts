import type { Node as ProseNode } from '@milkdown/kit/prose/model';
import { Slice } from '@milkdown/kit/prose/model';

export function parseMarkdownSlice(
  parser: (markdown: string) => ProseNode | string | null,
  markdown: string
): Slice | null {
  const parsed = parser(markdown);
  if (!parsed || typeof parsed === 'string') return null;
  let content = parsed.content;
  while (content.firstChild?.type.name === 'paragraph' && !content.firstChild.textContent.trim()) {
    content = content.cut(content.firstChild.nodeSize);
  }
  while (content.lastChild?.type.name === 'paragraph' && !content.lastChild.textContent.trim()) {
    content = content.cut(0, content.size - content.lastChild.nodeSize);
  }
  return new Slice(content, 0, 0);
}
