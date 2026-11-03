import { mathFromMarkdown, mathToMarkdown } from 'mdast-util-math';
import { math } from 'micromark-extension-math';
import { remarkStringifyOptionsCtx } from '@milkdown/kit/core';
import { $remark } from '@milkdown/kit/utils';
import type { Handle } from 'mdast-util-to-markdown';

interface MarkdownNode {
  type: string;
  value?: string;
  children?: MarkdownNode[];
  position?: { start: { offset?: number }; end: { offset?: number } };
}

const singleDollarHandlers = mathToMarkdown().handlers!;
const multipleDollarHandlers = mathToMarkdown({ singleDollarTextMath: false }).handlers!;

/** 普通金额保留原文，可能重新解析成公式的字面美元必须转义。 */
const textHandler: Handle = (node, parent, state, info) => {
  if (node.type !== 'text') return '';
  // 只有纯文本容器中的金额可安全省略转义，避免与跨粗体/链接/公式的美元配对。
  const plainContainer = parent && ['paragraph', 'heading', 'tableCell'].includes(parent.type)
    && parent.children.every((child) => child.type === 'text');
  const hasLiteralDelimiter = /\$(?!\d)/.test(node.value);
  const value = state.safe(node.value, info);
  return value.replace(/(\\*)\$/g, (whole: string, slashes: string, offset: number) => {
    if (slashes.length % 2 === 1) return whole;
    const next = value[offset + whole.length] ?? '';
    if (plainContainer && !hasLiteralDelimiter && /\d/.test(next)) return whole;
    return `${slashes}\\$`;
  });
};

const inlineMathHandler: Handle = (node, parent, state, info) => {
  if (node.type !== 'inlineMath') return '';
  // 空行内公式没有标准 Markdown 表达；保存时不制造 $$ 块或占位源码。
  if (!node.value) return '';
  const needsMultiple = /^\s|\s$/.test(node.value) || /\d/.test(info.after ?? '') || node.value.includes('$');
  const handler = needsMultiple ? multipleDollarHandlers.inlineMath! : singleDollarHandlers.inlineMath!;
  return handler(node, parent, state, info);
};
const inlineMathWithPeek = Object.assign(inlineMathHandler, { peek: () => '$' });

/** 只在必要处转义美元，避免把价格正文统一改写为反斜杠美元。 */
export const mathRemark = $remark('mathBlock', (ctx) => {
  // InitReady 已为每个 Editor 创建独立 options；只有初始 handlers 引用共享。
  // stringify 此时已捕获 options，故替换本实例的 handlers 字段（先克隆），
  // 不修改共享 handlers，也不 ctx.set 一个 stringify 不会读取的新 options。
  const options = ctx.get(remarkStringifyOptionsCtx);
  const baseTextHandler = options.handlers?.text;
  options.handlers = { ...options.handlers, text: (node, parent, state, info) => {
    if (node.type === 'text' && !node.value.includes('$') && baseTextHandler) return baseTextHandler(node, parent, state, info);
    return textHandler(node, parent, state, info);
  } };
  return function mathPlugin(this: unknown) {
    const data = (this as { data(): Record<string, unknown[] | undefined> }).data();
    (data.micromarkExtensions ??= []).push(math({ singleDollarTextMath: true }));
    (data.fromMarkdownExtensions ??= []).push(mathFromMarkdown());
    (data.toMarkdownExtensions ??= []).push({
      handlers: { ...singleDollarHandlers, text: textHandler, inlineMath: inlineMathWithPeek },
      unsafe: [
        { character: '\r', inConstruct: 'mathFlowMeta' },
        { character: '\n', inConstruct: 'mathFlowMeta' },
        { character: '$', inConstruct: 'mathFlowMeta' },
        { atBreak: true, character: '$', after: '\\$' }
      ]
    });
  } as never;
});

/** 用原始定界符内文本判断，不能使用已被 micromark 去掉边缘空格的 value。 */
export const mathInlineGuardRemark = $remark('mathInlineGuard', () => () => (tree, file) => {
  const source = String(file.value ?? '');
  const visit = (node: MarkdownNode) => {
    if (!node.children) return;
    node.children = node.children.map((child) => {
      if (child.type !== 'inlineMath') return child;
      const start = child.position?.start.offset;
      const end = child.position?.end.offset;
      if (start === undefined || end === undefined) return child;
      const raw = source.slice(start, end);
      if (raw.startsWith('$$')) return child;
      if (/^\s|\s$/.test(raw.slice(1, -1)) || /\d/.test(source[end] ?? '')) return { type: 'text', value: raw };
      return child;
    });
    node.children.forEach(visit);
  };
  visit(tree as unknown as MarkdownNode);
});
