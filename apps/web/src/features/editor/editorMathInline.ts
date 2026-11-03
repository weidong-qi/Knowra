import { InputRule } from '@milkdown/kit/prose/inputrules';
import { Plugin, PluginKey, TextSelection, type Command } from '@milkdown/kit/prose/state';
import { Decoration, DecorationSet } from '@milkdown/kit/prose/view';
import { $inputRule, $nodeSchema, $prose } from '@milkdown/kit/utils';
import { createMathNodeView } from './editorMathNodeView';

export const mathInlineSchema = $nodeSchema('math_inline', () => ({
  content: 'text*',
  group: 'inline',
  inline: true,
  code: true,
  marks: '',
  isolating: true,
  parseDOM: [{ tag: 'span[data-math-inline]', preserveWhitespace: 'full' as const }],
  toDOM: () => ['span', { 'data-math-inline': '' }, 0] as const,
  parseMarkdown: {
    match: (node) => node.type === 'inlineMath',
    runner: (state, node, type) => {
      state.openNode(type);
      if (node.value) state.addText(node.value as string);
      state.closeNode();
    }
  },
  toMarkdown: {
    match: (node) => node.type.name === 'math_inline',
    runner: (state, node) => {
      state.addNode('inlineMath', undefined, node.textContent);
    }
  }
}));

/** 输入 `$x$` 的结束符后转为行内公式，光标留在公式内以便继续修改。 */
export const mathInlineInputRule = $inputRule((ctx) => new InputRule(
  /(?:^|[^$\\])\$((?:\\.|[^$\\])+)\$$/,
  (state, match, start, end) => {
    const type = mathInlineSchema.type(ctx);
    const body = match[1]!;
    if (/^\s|\s$/.test(body) || /^\d/.test(state.selection.$from.parent.textContent.slice(state.selection.$from.parentOffset))) return null;
    // 触发时结束符 `$` 尚未写入文档，所以只回退开头符号和正文。
    const from = end - body.length - 1;
    if (from < start || state.selection.$from.parent.type.spec.code || state.selection.$from.parent.type === type) return null;
    // Milkdown 的 customInputRules 不执行 InputRule.inCodeMark，需要在 handler 保留字面代码边界。
    if ((state.storedMarks ?? state.selection.$from.marks()).some(mark => mark.type.spec.code)) return null;
    let touchesCode = false;
    state.doc.nodesBetween(from, end, node => { if (node.marks.some(mark => mark.type.spec.code)) touchesCode = true; });
    if (touchesCode) return null;
    const node = type.create(null, state.schema.text(body));
    const tr = state.tr.replaceWith(from, end, node);
    return tr.setSelection(TextSelection.create(tr.doc, from + 1 + body.length));
  },
  { inCodeMark: false }
));

/** 选区包成行内公式；无选区则插入可直接覆盖的占位 `x`。 */
export const insertMathInline: Command = (state, dispatch) => {
  const type = state.schema.nodes.math_inline;
  const { $from, $to, from, to } = state.selection;
  if (!type || !$from.parent.inlineContent || $from.parent.type.spec.code || !$from.sameParent($to)) return false;
  if ($from.parent.type === type) return false;
  let hasInlineNode = false;
  if (from !== to) state.doc.nodesBetween(from, to, node => {
    if (node.isInline && !node.isText) hasInlineNode = true;
    return !hasInlineNode;
  });
  if (hasInlineNode) return false;
  const text = from === to ? 'x' : state.doc.textBetween(from, to);
  if (!text) return false;
  if (dispatch) {
    const tr = state.tr.replaceWith(from, to, type.create(null, state.schema.text(text)));
    tr.setSelection(TextSelection.create(tr.doc, from + 1, from + 1 + text.length));
    dispatch(tr.scrollIntoView());
  }
  return true;
};

const KEY = new PluginKey('V4_MATH_INLINE');

export const mathInlineBehavior = $prose(() => new Plugin({
  key: KEY,
  appendTransaction(transactions, _oldState, state) {
    if (!transactions.some(transaction => transaction.docChanged)) return null;
    const boundaries: number[] = [];
    state.doc.descendants((parent, pos) => {
      if (!parent.inlineContent) return;
      let previousWasMath = false;
      parent.forEach((node, offset) => {
        const isMath = node.type.name === 'math_inline' && Boolean(node.textContent);
        if (isMath && previousWasMath) boundaries.push(pos + 1 + offset);
        previousWasMath = isMath;
      });
    });
    if (!boundaries.length) return null;
    // 相邻的 $a$$b$ 会被 Markdown 重开为一个公式；显式空格同时存在于编辑器、保存及历史中。
    const tr = state.tr;
    for (const pos of boundaries.reverse()) tr.insertText(' ', pos);
    return tr;
  },
  props: {
    decorations(state) {
      const { $from, $to } = state.selection;
      if ($from.parent.type.name !== 'math_inline' || !$from.sameParent($to)) return null;
      return DecorationSet.create(state.doc, [Decoration.node($from.before(), $from.after(), { class: 'math-editing' })]);
    },
    handleKeyDown(view, event) {
      const { $from, empty } = view.state.selection;
      if (!view.editable || $from.parent.type.name !== 'math_inline' || event.ctrlKey || event.metaKey || event.altKey || event.isComposing || event.keyCode === 229 || view.composing) return false;
      if (event.key === 'Enter' && !event.shiftKey && !event.altKey) {
        view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, $from.after())).scrollIntoView());
        return true;
      }
      if (event.key === 'ArrowRight' && empty && $from.parentOffset === $from.parent.content.size && !event.shiftKey) {
        view.dispatch(view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve($from.after()), 1)).scrollIntoView());
        return true;
      }
      if (event.key === 'ArrowLeft' && empty && $from.parentOffset === 0 && !event.shiftKey) {
        view.dispatch(view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve($from.before()), -1)).scrollIntoView());
        return true;
      }
      return false;
    },
    nodeViews: {
      math_inline: createMathNodeView(false)
    }
  }
}));
