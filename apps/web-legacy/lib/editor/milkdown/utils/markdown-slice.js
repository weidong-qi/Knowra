import { parserCtx } from '@milkdown/kit/core';
import { Slice } from '@milkdown/kit/prose/model';

export function normalizeMarkdown(markdown) {
  return typeof markdown === 'string' ? markdown : '';
}

export function parseMarkdownSlice(ctx, markdown) {
  const text = normalizeMarkdown(markdown);
  if (!text) {
    return null;
  }

  const parser = ctx.get(parserCtx);
  const parsed = parser(text);
  if (!parsed || typeof parsed === 'string') {
    return null;
  }

  let content = parsed.content;
  while (content.size > 0) {
    const first = content.firstChild;
    if (first && first.type.name === 'paragraph' && first.textContent.trim() === '') {
      content = content.cut(first.nodeSize);
    } else {
      break;
    }
  }
  while (content.size > 0) {
    const last = content.lastChild;
    if (last && last.type.name === 'paragraph' && last.textContent.trim() === '') {
      content = content.cut(0, content.size - last.nodeSize);
    } else {
      break;
    }
  }

  return new Slice(content, 0, 0);
}
