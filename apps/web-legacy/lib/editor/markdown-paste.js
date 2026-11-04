import { Fragment, Slice } from '@milkdown/kit/prose/model';

const MARKDOWN_BLOCK_PATTERNS = [
  /^\s{0,3}#{1,6}\s+/m,
  /^\s{0,3}```/m,
  /^\s{0,3}~~~+/m,
  /^\s{0,3}>\s+/m,
  /^\s{0,3}(?:[-*+] |\d+\. )/m,
  /^\s{0,3}\|.+\|\s*$/m
];

export function looksLikeMarkdown(text) {
  const source = typeof text === 'string' ? text : '';
  return MARKDOWN_BLOCK_PATTERNS.some((pattern) => pattern.test(source));
}

export function shouldPreferPlainMarkdown({ text, vscodeData } = {}) {
  if (vscodeData || !text) {
    return false;
  }

  return looksLikeMarkdown(text);
}

function sanitizeFragment(fragment) {
  const children = [];
  let changed = false;

  for (let index = 0; index < fragment.childCount; index += 1) {
    const node = fragment.child(index);
    const nextNode = index + 1 < fragment.childCount ? fragment.child(index + 1) : null;
    const isSpuriousEmptyCodeBlock = node.type.name === 'code_block'
      && node.textContent.trim() === ''
      && nextNode?.type.name === 'code_block'
      && nextNode.textContent.trim() !== '';

    if (isSpuriousEmptyCodeBlock) {
      changed = true;
      continue;
    }

    const sanitizedContent = node.content.size > 0 ? sanitizeFragment(node.content) : node.content;
    if (sanitizedContent !== node.content) {
      children.push(node.copy(sanitizedContent));
      changed = true;
    } else {
      children.push(node);
    }
  }

  return changed ? Fragment.fromArray(children) : fragment;
}

export function removeSpuriousEmptyCodeBlocks(slice) {
  if (!slice?.content) {
    return slice;
  }

  const content = sanitizeFragment(slice.content);
  return content === slice.content
    ? slice
    : new Slice(content, slice.openStart, slice.openEnd);
}

/**
 * Strip every inline `style="..."` attribute from the given HTML string.
 *
 * Why this exists: ChatGPT / Claude / other AI chat UIs annotate keywords in
 * their rendered output with `<span style="background: ...; color: ...">`.
 * ProseMirror's default clipboard parser would otherwise preserve those
 * inline styles on the pasted nodes, painting a purple-blue background over
 * the user's notes — a visual artifact the user never asked for.
 *
 * We strip `style` and let the editor's own CSS / marks decide how the text
 * is rendered. Semantic information (text, marks like `<strong>`, links) is
 * kept; only the visual dressing is removed.
 *
 * Safe in non-browser environments: when `DOMParser` is unavailable (e.g.
 * Node test runner), the input HTML is returned unchanged.
 */
export function stripPastedInlineStyles(html) {
  if (typeof html !== 'string' || !html) {
    return html;
  }

  const DOMParserCtor = typeof globalThis !== 'undefined' ? globalThis.DOMParser : undefined;
  if (!DOMParserCtor) {
    return html;
  }

  const doc = new DOMParserCtor().parseFromString(html, 'text/html');
  if (!doc?.body) {
    return html;
  }

  const all = doc.body.querySelectorAll('[style]');
  for (const element of all) {
    element.removeAttribute('style');
  }

  return doc.body.innerHTML;
}
