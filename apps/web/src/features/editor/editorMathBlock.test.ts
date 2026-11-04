import { afterEach, describe, expect, it } from 'vitest';
import { Editor, defaultValueCtx, editorViewCtx, rootCtx } from '@milkdown/kit/core';
import { commonmark } from '@milkdown/kit/preset/commonmark';
import { gfm } from '@milkdown/kit/preset/gfm';
import { TextSelection } from '@milkdown/kit/prose/state';
import { history, undo, redo, undoDepth, closeHistory } from '@milkdown/kit/prose/history';
import { $prose, getMarkdown, replaceAll } from '@milkdown/kit/utils';
import {
  configureMathBlockDocument,
  mathBlockSerializerGuard,
  createMathFromFence,
  insertMathBlock,
  mathBlockBehavior,
  mathBlockSchema,
} from './editorMathBlock';
import { mathInlineGuardRemark, mathRemark } from './editorMathMarkdown';
import { renderMath, stripTexDelimiters } from './editorMathRender';
import { insertMathInline, mathInlineBehavior, mathInlineInputRule, mathInlineSchema } from './editorMathInline';

const editors: Editor[] = [];
afterEach(async () => { await Promise.all(editors.splice(0).map(editor => editor.destroy())); document.body.replaceChildren(); });

async function create(markdown: string) {
  const root = document.createElement('div');
  document.body.append(root);
  const editor = await Editor.make()
    .config((ctx) => { configureMathBlockDocument(ctx); ctx.set(rootCtx, root); ctx.set(defaultValueCtx, markdown); })
    .use($prose(() => history())).use(commonmark).use(gfm).use(mathRemark).use(mathInlineGuardRemark).use(mathBlockSchema).use(mathBlockBehavior).use(mathBlockSerializerGuard).use(mathInlineSchema).use(mathInlineBehavior).use(mathInlineInputRule)
    .create();
  editors.push(editor);
  return { editor, root };
}

describe('math block', () => {
  it('round-trips $$ blocks with special characters and blank lines', async () => {
    const md = '前文\n\n$$\na_1 * b_2\n\n\\frac{1}{2}\n$$\n\n后文\n';
    const { editor, root } = await create(md);
    const view = editor.ctx.get(editorViewCtx);
    expect(view.state.doc.child(1).type.name).toBe('math_block');
    expect(view.state.doc.child(1).textContent).toBe('a_1 * b_2\n\n\\frac{1}{2}');
    expect(root.querySelector('[data-math-preview] .katex')).not.toBeNull();
    expect(editor.action(getMarkdown())).toBe(md);
  });

  it('converts a $$ paragraph to a block and toggles back', async () => {
    const { editor } = await create('x\n');
    const view = editor.ctx.get(editorViewCtx);
    view.dispatch(view.state.tr.insertText('$$', 1, 2));
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 3)));
    expect(createMathFromFence(view.state, view.dispatch)).toBe(true);
    expect(view.state.doc.childCount).toBe(2);
    expect(view.state.doc.lastChild?.type.name).toBe('paragraph');
    expect(view.state.doc.child(0).type.name).toBe('math_block');
    expect(insertMathBlock(view.state, view.dispatch)).toBe(true);
    expect(view.state.doc.child(0).type.name).toBe('paragraph');
  });

  it('normalizes loaded and replaced trailing formulas without history or changing Markdown', async () => {
    const md = '$$\nx^2\n$$\n';
    const { editor } = await create(md);
    const view = editor.ctx.get(editorViewCtx);
    expect(view.state.doc.childCount).toBe(2);
    expect(view.state.doc.lastChild?.type.name).toBe('paragraph');
    expect(editor.action(getMarkdown())).toBe(md);
    expect(undoDepth(view.state)).toBe(0);
    editor.action(replaceAll('$$\ny^2\n$$\n', true));
    expect(view.state.doc.childCount).toBe(2);
    expect(undoDepth(view.state)).toBe(0);
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1)));
    expect(view.state.doc.childCount).toBe(2);
  });

  it.each(['', '前文\n'])('normalizes menu insertion and undoes it atomically from %j', async md => {
    const { editor } = await create(md);
    const view = editor.ctx.get(editorViewCtx);
    const before = view.state.doc;
    expect(insertMathBlock(view.state, view.dispatch)).toBe(true);
    expect(view.state.doc.lastChild?.type.name).toBe('paragraph');
    expect(view.state.doc.lastChild?.content.size).toBe(0);
    expect(view.state.selection.$from.parent.type.name).toBe('math_block');
    expect(undoDepth(view.state)).toBe(1);
    expect(undo(view.state, view.dispatch)).toBe(true);
    expect(view.state.doc.eq(before)).toBe(true);
    expect(redo(view.state, view.dispatch)).toBe(true);
    expect(view.state.doc.lastChild?.type.name).toBe('paragraph');
  });

  it('restores a deleted tail once, supports subsequent typing and preserves formula undo', async () => {
    const { editor } = await create('$$\nx\n$$\n');
    const view = editor.ctx.get(editorViewCtx);
    const original = view.state.doc;
    const tail = view.state.doc.content.size - 2;
    view.dispatch(view.state.tr.delete(tail, tail + 2));
    expect(view.state.doc.eq(original)).toBe(true);
    expect(undoDepth(view.state)).toBe(1);
    expect(undo(view.state, view.dispatch)).toBe(true);
    expect(view.state.doc.eq(original)).toBe(true);
    expect(undoDepth(view.state)).toBe(0);
    view.dispatch(closeHistory(view.state.tr).setSelection(TextSelection.create(view.state.doc, tail + 1)).insertText('后文'));
    expect(view.state.doc.childCount).toBe(2);
    expect(view.state.doc.lastChild?.textContent).toBe('后文');
  });

  it('adds only one tail after consecutive formulas and never changes inline or nested formulas', async () => {
    const { editor } = await create('$$\nx\n$$\n\n$$\ny\n$$\n');
    const view = editor.ctx.get(editorViewCtx);
    expect(view.state.doc.childCount).toBe(3);
    expect(view.state.doc.lastChild?.type.name).toBe('paragraph');
    for (const md of ['$$\nx\n$$\n\n后文\n', '正文 $x$\n', '> $$\n> x\n> $$\n']) {
      editor.action(replaceAll(md, true));
      expect(editor.action(getMarkdown())).toBe(md);
      expect(view.state.doc.lastChild?.type.name).toBe(md.startsWith('>') ? 'blockquote' : 'paragraph');
    }
  });

  it('preserves multiple and middle empty paragraphs and stabilizes parse/serialize cycles', async () => {
    const { editor } = await create('$$\nx\n$$\n');
    const view = editor.ctx.get(editorViewCtx);
    for (let i = 0; i < 3; i++) {
      const serialized = editor.action(getMarkdown());
      expect(serialized).toBe('$$\nx\n$$\n');
      editor.action(replaceAll(serialized, true));
      expect(view.state.doc.childCount).toBe(2);
    }
    const paragraph = view.state.schema.nodes.paragraph;
    view.dispatch(view.state.tr.insert(view.state.doc.content.size, paragraph.create()));
    expect(view.state.doc.childCount).toBe(3);
    const multiple = editor.action(getMarkdown());
    expect(multiple).toContain('<br />');
    expect(multiple).not.toBe('$$\nx\n$$\n');
    view.dispatch(view.state.tr.insert(view.state.doc.content.size, paragraph.create(null, view.state.schema.text('后文'))));
    expect(view.state.doc.childCount).toBe(4);
    const middle = editor.action(getMarkdown());
    expect(middle.match(/<br \/>/g)).toHaveLength(2);
    expect(middle).toContain('后文');
  });

  it('keeps fence conversion and its automatic tail in one undo event', async () => {
    const { editor } = await create('\\$\\$\n');
    const view = editor.ctx.get(editorViewCtx);
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 3)));
    const before = view.state.doc;
    expect(createMathFromFence(view.state, view.dispatch)).toBe(true);
    expect(view.state.doc.childCount).toBe(2);
    expect(undoDepth(view.state)).toBe(1);
    expect(undo(view.state, view.dispatch)).toBe(true);
    expect(view.state.doc.eq(before)).toBe(true);
    expect(redo(view.state, view.dispatch)).toBe(true);
    expect(view.state.doc.childCount).toBe(2);
  });

  it('shows a readable error for invalid LaTeX', () => {
    const el = document.createElement('div');
    renderMath(el, '\\frac{1');
    expect(el.classList.contains('math-error')).toBe(true);
    expect(el.textContent).not.toBe('');
  });
});

describe('math inline', () => {
  it('parses single-dollar formulas and round-trips them', async () => {
    const md = '设 $a_1 * b_2$ 与 $\\alpha$ 相等\n';
    const { editor, root } = await create(md);
    const para = editor.ctx.get(editorViewCtx).state.doc.child(0);
    expect(para.childCount).toBe(5);
    expect(para.child(1).type.name).toBe('math_inline');
    expect(para.child(1).textContent).toBe('a_1 * b_2');
    expect(root.querySelectorAll('[data-math-inline] .katex')).toHaveLength(2);
    expect(editor.action(getMarkdown())).toBe(md);
  });

  it('keeps prices like $5 and $6 as plain text without escaping', async () => {
    const md = '价格 $5 和 $6，或 $10 起\n';
    const { editor } = await create(md);
    expect(editor.ctx.get(editorViewCtx).state.doc.child(0).childCount).toBe(1);
    expect(editor.action(getMarkdown())).toBe(md);
  });

  it('wraps a selection and inserts a placeholder', async () => {
    const { editor } = await create('abc\n');
    const view = editor.ctx.get(editorViewCtx);
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 2, 3)));
    expect(insertMathInline(view.state, view.dispatch)).toBe(true);
    expect(editor.action(getMarkdown())).toBe('a$b$c\n');
  });
});

describe('math inline input rule', () => {
  it('turns a typed $x$ into an inline formula with the caret inside', async () => {
    const { editor } = await create('设\n');
    const view = editor.ctx.get(editorViewCtx);
    view.dispatch(view.state.tr.insertText(' ', 2));
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 3)));
    for (const ch of '$\\alpha^2$') {
      const { from, to } = view.state.selection;
      if (!view.someProp('handleTextInput', (f) => f(view, from, to, ch, () => view.state.tr.insertText(ch, from, to)))) view.dispatch(view.state.tr.insertText(ch, from, to));
    }
    const para = view.state.doc.child(0);
    expect(para.child(1).type.name).toBe('math_inline');
    expect(para.child(1).textContent).toBe('\\alpha^2');
    expect(view.state.selection.$from.parent.type.name).toBe('math_inline');
    expect(editor.action(getMarkdown())).toBe('设 $\\alpha^2$\n');
  });
});

describe('TeX delimiters', () => {
  it('strips the outer \\[ \\] wrapper when rendering', () => {
    expect(stripTexDelimiters('\\[\na(q,k)=w_v^\\top\n\\]')).toBe('\na(q,k)=w_v^\\top\n');
    expect(stripTexDelimiters('\\( x^2 \\)')).toBe(' x^2 ');
    expect(stripTexDelimiters('x^2')).toBe('x^2');
    const el = document.createElement('div');
    renderMath(el, '\\[\na(q,k)=w_v^\\top\\tanh(W_qq)\n\\]');
    expect(el.classList.contains('math-error')).toBe(false);
    expect(el.querySelector('.katex')).not.toBeNull();
  });

});
