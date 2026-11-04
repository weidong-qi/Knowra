import { editorStateOptionsCtx, SerializerReady, serializerCtx } from '@milkdown/kit/core';
import type { Ctx, MilkdownPlugin } from '@milkdown/kit/ctx';
import { Fragment, type Node as ProseNode } from '@milkdown/kit/prose/model';
import { setBlockType } from '@milkdown/kit/prose/commands';
import { Plugin, PluginKey, TextSelection, type Command } from '@milkdown/kit/prose/state';
import { Decoration, DecorationSet } from '@milkdown/kit/prose/view';
import { $nodeSchema, $prose } from '@milkdown/kit/utils';
import { createMathNodeView } from './editorMathNodeView';

export const mathBlockSchema = $nodeSchema('math_block', () => ({
  content: 'text*',
  group: 'block',
  marks: '',
  code: true,
  defining: true,
  isolating: true,
  parseDOM: [{ tag: 'pre[data-math-block]', preserveWhitespace: 'full' as const, contentElement: 'code' }],
  toDOM: () => ['pre', { 'data-math-block': '' }, ['code', 0]] as const,
  parseMarkdown: {
    match: (node) => node.type === 'math',
    runner: (state, node, type) => {
      state.openNode(type);
      if (node.value) state.addText(node.value as string);
      state.closeNode();
    }
  },
  toMarkdown: {
    match: (node) => node.type.name === 'math_block',
    runner: (state, node) => {
      state.addNode('math', undefined, node.textContent);
    }
  }
}));

/** 在空段落输入 `$$` 后回车，转为公式块（对齐 Typora）。 */
export const createMathFromFence: Command = (state, dispatch) => {
  const { $from, empty } = state.selection;
  if (!empty || $from.parent.type.name !== 'paragraph' || $from.parentOffset !== $from.parent.content.size) return false;
  const type = state.schema.nodes.math_block;
  if (!type || !/^\s{0,3}\$\$\s*$/.test($from.parent.textContent)) return false;
  const tr = state.tr.delete($from.start(), $from.end()).setBlockType($from.before(), $from.before() + 1, type);
  dispatch?.(tr.scrollIntoView());
  return true;
};

/** 菜单/快捷键：空段落直接转换，否则在当前块下方插入；已在公式块内则还原为正文。 */
export const insertMathBlock: Command = (state, dispatch) => {
  const type = state.schema.nodes.math_block;
  const paragraph = state.schema.nodes.paragraph;
  if (!type || !paragraph) return false;
  const { $from } = state.selection;
  if ($from.parent.type === type) {
    return setBlockType(paragraph)(state, dispatch);
  }
  const depth = $from.depth;
  if (depth < 1 || !$from.parent.isTextblock) return false;
  if ($from.parent.content.size === 0) return setBlockType(type)(state, dispatch ? (tr) => dispatch(tr.scrollIntoView()) : undefined);
  const container = $from.node(depth - 1);
  const index = $from.indexAfter(depth - 1);
  if (!container.canReplaceWith(index, index, type)) return false;
  if (dispatch) {
    const pos = $from.after(depth);
    const node = type.create();
    const tr = state.tr.insert(pos, node);
    tr.setSelection(TextSelection.create(tr.doc, pos + 1));
    dispatch(tr.scrollIntoView());
  }
  return true;
};

/** 只为文末公式补正文入口；已有段落（包括空段）和行内公式保持原样。 */
export function normalizeTrailingMathBlock(doc: ProseNode): ProseNode {
  const paragraph = doc.type.schema.nodes.paragraph;
  if (doc.lastChild?.type.name !== 'math_block' || !paragraph
    || !doc.canReplaceWith(doc.childCount, doc.childCount, paragraph)) return doc;
  return doc.copy(doc.content.append(Fragment.from(paragraph.create())));
}

/** 加载和 flush 替换时直接建立规范化的编辑基线，不派发事务或写入撤销历史。 */
export function configureMathBlockDocument(ctx: Ctx) {
  ctx.update(editorStateOptionsCtx, previous => options => {
    const configured = previous(options);
    return configured.doc ? { ...configured, doc: normalizeTrailingMathBlock(configured.doc) } : configured;
  });
}

/** 文末公式后的空正文是输入入口，不为保存正文制造额外空行。 */
export const mathBlockSerializerGuard: MilkdownPlugin = ctx => async () => {
  await ctx.wait(SerializerReady);
  ctx.update(serializerCtx, serialize => doc => {
    const last = doc.lastChild;
    if (last?.type.name === 'paragraph' && last.content.size === 0
      && doc.childCount > 1 && doc.child(doc.childCount - 2).type.name === 'math_block') {
      return serialize(doc.copy(doc.content.cut(0, doc.content.size - last.nodeSize)));
    }
    return serialize(doc);
  });
};

const EDITING_KEY = new PluginKey<DecorationSet>('V4_MATH_BLOCK_EDITING');

/** 光标在公式块内时显示源码；离开后仅显示渲染结果。 */
export const mathBlockBehavior = $prose(() => new Plugin({
  key: EDITING_KEY,
  appendTransaction(transactions, _oldState, state) {
    if (!transactions.some(transaction => transaction.docChanged)) return null;
    const normalized = normalizeTrailingMathBlock(state.doc);
    if (normalized === state.doc) return null;
    // 跟随原编辑事务进入同一个历史事件，撤销插入公式时不会残留额外空行。
    return state.tr.insert(state.doc.content.size, normalized.lastChild!);
  },
  props: {
    decorations(state) {
      const { $from, $to } = state.selection;
      if ($from.parent.type.name !== 'math_block' || !$from.sameParent($to)) return null;
      return DecorationSet.create(state.doc, [Decoration.node($from.before(), $from.after(), { class: 'math-editing' })]);
    },
    nodeViews: {
      math_block: createMathNodeView(true)
    }
  }
}));
