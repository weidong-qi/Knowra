import { afterEach, describe, expect, it } from 'vitest';
import { Editor, defaultValueCtx, editorViewCtx, editorViewOptionsCtx, rootCtx } from '@milkdown/kit/core';
import { commonmark } from '@milkdown/kit/preset/commonmark';
import { history } from '@milkdown/kit/plugin/history';
import { NodeSelection, TextSelection } from '@milkdown/kit/prose/state';
import { undo, redo } from '@milkdown/kit/prose/history';
import type { EditorView } from '@milkdown/kit/prose/view';
import { mathRemark, mathInlineGuardRemark } from './editorMathMarkdown';
import { mathBlockSchema } from './editorMathBlock';
import { insertMathInline, mathInlineBehavior, mathInlineInputRule, mathInlineSchema } from './editorMathInline';
import { selectCodeBlockContents } from './editorCodeCommands';
import { getMarkdown } from '@milkdown/kit/utils';
import { parserCtx, serializerCtx } from '@milkdown/kit/core';

const editors: Editor[] = [];
afterEach(async () => { await Promise.all(editors.splice(0).map(editor => editor.destroy())); document.body.replaceChildren(); });

async function create(markdown: string) {
  const editor = await Editor.make().config(ctx => {
    ctx.set(rootCtx, document.body.appendChild(document.createElement('div')));
    ctx.set(defaultValueCtx, markdown);
    ctx.update(editorViewOptionsCtx, options => ({ ...options, handleScrollToSelection: () => true }));
  }).use(commonmark).use(history).use(mathRemark).use(mathInlineGuardRemark).use(mathBlockSchema)
    .use(mathInlineSchema).use(mathInlineBehavior).use(mathInlineInputRule).create();
  editors.push(editor);
  return editor.ctx.get(editorViewCtx);
}

function type(view: EditorView, text: string) {
  for (const ch of text) {
    const { from, to } = view.state.selection;
    if (!view.someProp('handleTextInput', handler => handler(view, from, to, ch, () => view.state.tr.insertText(ch, from, to)))) {
      view.dispatch(view.state.tr.insertText(ch, from, to));
    }
  }
}

function key(view: EditorView, value: string, options: KeyboardEventInit = {}) {
  return Boolean(view.someProp('handleKeyDown', handler => handler(view, new KeyboardEvent('keydown', { key: value, ...options }))));
}

describe('行内公式编辑边界', () => {
  it.each(['`abc`', '```\nabc\n```'])('在代码 %s 输入美元时保留代码', async markdown => {
    const view = await create(markdown);
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 2)));
    type(view, '$x$');
    expect(view.state.doc.textContent).toBe('a$x$bc');
    expect(view.dom.querySelector('[data-math-inline]')).toBeNull();
  });

  it('转义美元属于 LaTeX 源码，直到未转义的结束符才转换', async () => {
    const view = await create('');
    type(view, '$a\\$');
    expect(view.state.doc.firstChild?.firstChild?.type.name).toBe('text');
    type(view, 'b$');
    expect(view.state.selection.$from.parent.type.name).toBe('math_inline');
    expect(view.state.selection.$from.parent.textContent).toBe('a\\$b');
  });

  it('结束符后已有数字时保留金额文本', async () => {
    const view = await create('2');
    type(view, '$x$');
    expect(view.state.doc.textContent).toBe('$x$2');
    expect(view.dom.querySelector('[data-math-inline]')).toBeNull();
  });

  it('公式源码中的 Markdown 标记和美元不会被再次解析', async () => {
    const view = await create('$x$');
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 3)));
    type(view, '**a** `b` $c$');
    expect(view.state.selection.$from.parent.type.name).toBe('math_inline');
    expect(view.state.selection.$from.parent.textContent).toBe('x**a** `b` $c$');
    expect(view.state.selection.$from.parent.childCount).toBe(1);
    expect(selectCodeBlockContents(view.state, view.dispatch)).toBe(false);
  });

  it('仅图片的选区不抛异常，也不替换图片', async () => {
    const view = await create('![图](https://example.test/image.png)');
    view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, 1)));
    const before = view.state.doc;
    expect(insertMathInline(view.state, view.dispatch)).toBe(false);
    expect(view.state.doc.eq(before)).toBe(true);
  });

  it.each(['a![图](https://example.test/image.png)b', 'a$x$b'])('混合选区 %s 不丢弃图片或已有公式', async markdown => {
    const view = await create(markdown);
    const before = view.state.doc;
    view.dispatch(view.state.tr.setSelection(TextSelection.create(before, 1, before.content.size - 1)));
    expect(insertMathInline(view.state, view.dispatch)).toBe(false);
    expect(view.state.doc.eq(before)).toBe(true);
  });

  it('正常退出、左右边界、只读和组合输入保持各自键盘语义', async () => {
    const view = await create('前 $x$ 后');
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 5)));
    expect(key(view, 'ArrowRight', { ctrlKey: true })).toBe(false);
    const mathKey = (options: KeyboardEventInit = {}) => mathInlineBehavior.plugin().props.handleKeyDown!.call(mathInlineBehavior.plugin(), view, new KeyboardEvent('keydown', { key: 'Enter', ...options }));
    expect(mathKey({ isComposing: true })).toBe(false);
    view.setProps({ editable: () => false });
    expect(mathKey()).toBe(false);
    view.setProps({ editable: () => true });
    expect(key(view, 'ArrowRight')).toBe(true);
    expect(view.state.selection.$from.parent.type.name).toBe('paragraph');
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 4)));
    expect(key(view, 'ArrowLeft')).toBe(true);
    expect(view.state.selection.from).toBe(3);
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 4)));
    expect(key(view, 'Enter')).toBe(true);
    expect(view.state.selection.from).toBe(6);
  });

  it('公式插入和源码编辑支持撤销、重做，渲染随文档同步', async () => {
    const view = await create('abc');
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1, 4)));
    expect(insertMathInline(view.state, view.dispatch)).toBe(true);
    expect(view.dom.querySelector('[data-math-preview] .katex')).not.toBeNull();
    expect(undo(view.state, view.dispatch)).toBe(true);
    expect(view.state.doc.firstChild?.firstChild?.type.name).toBe('text');
    expect(redo(view.state, view.dispatch)).toBe(true);
    expect(view.state.doc.firstChild?.firstChild?.type.name).toBe('math_inline');
    view.dispatch(view.state.tr.insertText('y', 2, 5));
    expect(view.dom.querySelector('[data-math-source]')?.textContent).toBe('y');
    expect(view.dom.querySelector('[data-math-preview]')?.textContent).toContain('y');
  });

  it('相邻公式由显式空格分隔，删除分隔符后保存及撤销重做仍保真', async () => {
    const view = await create('$a$ $b$');
    view.dispatch(view.state.tr.delete(4, 5));
    expect(view.state.doc.firstChild?.childCount).toBe(3);
    expect(view.state.doc.firstChild?.child(1).text).toBe(' ');
    const editor = editors.at(-1)!;
    const saved = editor.action(getMarkdown());
    expect(saved).toBe('$a$ $b$\n');
    expect(editor.ctx.get(parserCtx)(saved).eq(view.state.doc)).toBe(true);
    expect(undo(view.state, view.dispatch)).toBe(true);
    expect(redo(view.state, view.dispatch)).toBe(true);
    expect(editor.ctx.get(serializerCtx)(view.state.doc)).toBe(saved);
  });

  it('在公式旁插入和粘贴多个公式时保留独立源码', async () => {
    const view = await create('$a$');
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 4)));
    expect(insertMathInline(view.state, view.dispatch)).toBe(true);
    expect(view.state.selection.$from.parent.textContent).toBe('x');
    expect(view.state.doc.firstChild?.child(1).text).toBe(' ');
    const type = view.state.schema.nodes.math_inline!;
    view.dispatch(view.state.tr.insert(1, [type.create(null, view.state.schema.text('b')), type.create(null, view.state.schema.text('c'))]));
    const editor = editors.at(-1)!;
    const saved = editor.action(getMarkdown());
    expect(saved).toBe('$b$ $c$ $a$ $x$\n');
    expect(editor.ctx.get(parserCtx)(saved).eq(view.state.doc)).toBe(true);
  });
});
