import type { RemarkPluginRaw } from '@milkdown/kit/transformer';
import { $remark } from '@milkdown/kit/utils';
import { cjkFriendlyEmphasisExtension } from '@study-accelerator/shared/markdown-cjk';
import remarkCjkFriendlySerialize from 'remark-cjk-friendly/serializeOnly';
import remarkCjkFriendlyGfmStrikethrough from 'remark-cjk-friendly-gfm-strikethrough';

/**
 * 中文标点旁的强调定界符：CommonMark 把全角标点当标点，`**小标题：**正文` 这类写法不能闭合，
 * 重开笔记后加粗、斜体、删除线会退化成字面 `**`。解析与写出两端都放宽 CJK 字符旁的规则：
 * 写出端若只按 CommonMark 判断，会把 `~~删除：~~正文` 的“正”编码成 `&#x6B63;`。
 * 服务端 content-anchor / shared 解析器接入同一组 micromark 扩展，保持偏移一致。
 * 删除线插件需排在 gfm 之后。
 */
/**
 * 解析端用共享的 cjkFriendlyEmphasisExtension（CJK 规则与 CommonMark 规则取并集，emoji 旁的强调不退化），
 * 写出端用 remark-cjk-friendly 的写出插件。
 */
const remarkCjkFriendly: RemarkPluginRaw<unknown> = function () {
  const data = this.data();
  (data.micromarkExtensions ??= []).push(cjkFriendlyEmphasisExtension());
  remarkCjkFriendlySerialize.call(this);
};
export const cjkFriendlyRemark = $remark('cjkFriendly', () => remarkCjkFriendly);
export const cjkFriendlyStrikethroughRemark = $remark(
  'cjkFriendlyStrikethrough',
  () => remarkCjkFriendlyGfmStrikethrough
);

interface MarkdownTreeNode {
  type: string;
  children?: MarkdownTreeNode[];
}

const PHRASING_CONTAINERS = new Set(['paragraph', 'heading', 'tableCell']);

function fillEmptyPhrasing(node: MarkdownTreeNode) {
  if (PHRASING_CONTAINERS.has(node.type)) node.children ??= [];
  node.children?.forEach(fillEmptyPhrasing);
}

/**
 * Milkdown 写出空段落时 mdast 节点没有 children；CJK 写出插件的 containerPhrasing 不容忍缺省，
 * 写出前补成空数组（Milkdown 写出不经过 remark transformer，只能包裹 compiler）。
 */
const emptyPhrasingGuard: RemarkPluginRaw<unknown> = function () {
  const compiler = this.compiler;
  if (!compiler) return;
  this.compiler = (tree, file) => {
    fillEmptyPhrasing(tree as unknown as MarkdownTreeNode);
    return compiler(tree, file);
  };
};
export const cjkFriendlyEmptyPhrasingGuard = $remark('cjkFriendlyEmptyPhrasingGuard', () => emptyPhrasingGuard);
