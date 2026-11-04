import type { EditorState } from '@milkdown/kit/prose/state';

interface MarkdownNode {
  type: string;
  children?: MarkdownNode[];
  position?: { start: { offset?: number }; end: { offset?: number } };
}

type Range = { start: number; end: number };
const PROTECTED_TYPES = new Set(['code', 'inlineCode', 'math', 'inlineMath', 'html', 'link', 'linkReference', 'image', 'imageReference', 'definition']);

/** 复用编辑器的 Markdown 语法位置，仅转换正文里的 TeX 分隔符，避免改写代码和已有公式。 */
export function convertTexMathDelimiters(text: string, parse: (source: string) => MarkdownNode): string {
  if (!/\\[[(]/.test(text)) return text;
  const protectedRanges: Range[] = [];
  const proseRanges: Range[] = [];
  const nestedRanges: Range[] = [];
  const visit = (node: MarkdownNode) => {
    const start = node.position?.start.offset;
    const end = node.position?.end.offset;
    if (['list', 'blockquote', 'table', 'heading'].includes(node.type) && start !== undefined && end !== undefined) nestedRanges.push({ start, end });
    if (PROTECTED_TYPES.has(node.type)) {
      if (start !== undefined && end !== undefined) protectedRanges.push({ start, end });
      return;
    }
    if ((node.type === 'paragraph' || node.type === 'heading') && start !== undefined && end !== undefined) proseRanges.push({ start, end });
    node.children?.forEach(visit);
  };
  visit(parse(text));
  const tokens = [...text.matchAll(/\\[\[\]()]/g)].filter(match => !isEscaped(text, match.index));
  const replacements: Array<Range & { value: string }> = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const open = tokens[index]!;
    if (open[0] !== '\\[' && open[0] !== '\\(') continue;
    const start = open.index;
    if (protectedRanges.some(range => range.start <= start && start < range.end)) continue;
    const closeToken = open[0] === '\\[' ? '\\]' : '\\)';
    const closeIndex = tokens.findIndex((token, candidate) => candidate > index && token[0] === closeToken);
    if (closeIndex < 0) continue;
    const close = tokens[closeIndex]!;
    const end = close.index + 2;
    const display = open[0] === '\\[';
    // 嵌套容器的块级转换需要重建前缀；保留原文，不能以顶层空行破坏容器。
    if (display && nestedRanges.some(range => range.start < end && start < range.end)) continue;
    const inProse = display
      ? proseRanges.some(range => range.start <= start && start < range.end) && proseRanges.some(range => range.start < end && end <= range.end)
      : proseRanges.some(range => range.start <= start && end <= range.end);
    // 行内公式不跨段落；块公式可以包含空行，但都不能跨代码或现存公式配对。
    if (!inProse || protectedRanges.some(range => range.start < end && start < range.end)) continue;
    const body = text.slice(start + 2, close.index).trim();
    if (!body) continue;
    const dollars = Math.max(0, ...[...body.matchAll(/\$+/g)].map(match => match[0].length));
    const fence = '$'.repeat(Math.max(display ? 2 : /\d/.test(text[end] ?? '') ? 2 : 1, dollars + 1));
    const inlineBody = /^\$|\$$/.test(body) ? ` ${body} ` : body;
    replacements.push({ start, end, value: display ? `\n\n${fence}\n${body}\n${fence}\n\n` : `${fence}${inlineBody}${fence}` });
    index = closeIndex;
  }
  let result = text;
  for (const replacement of replacements.reverse()) result = result.slice(0, replacement.start) + replacement.value + result.slice(replacement.end);
  return result;
}

function isEscaped(text: string, position: number): boolean {
  let count = 0;
  while (position > 0 && text[--position] === '\\') count += 1;
  return count % 2 === 1;
}

/** 原生与菜单粘贴共享源码判断；显式 storedMarks（含空数组）优先于光标处标记。 */
export function shouldPasteAsSource(state: EditorState): boolean {
  const { $from, $to } = state.selection;
  return $from.sameParent($to) && Boolean(
    $from.parent.type.spec.code
    || $from.parent.type.name === 'math_inline'
    || (state.storedMarks ?? $from.marks()).some(mark => mark.type.spec.code)
  );
}
