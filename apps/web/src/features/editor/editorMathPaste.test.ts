import { afterEach, describe, expect, it, vi } from 'vitest';
import { Editor, defaultValueCtx, editorViewCtx, editorViewOptionsCtx, remarkCtx, rootCtx } from '@milkdown/kit/core';
import { commonmark } from '@milkdown/kit/preset/commonmark';
import { getMarkdown } from '@milkdown/kit/utils';
import { TextSelection } from '@milkdown/kit/prose/state';
import { mathBlockSchema } from './editorMathBlock';
import { mathInlineGuardRemark, mathRemark } from './editorMathMarkdown';
import { convertTexMathDelimiters, shouldPasteAsSource } from './editorMathPaste';
import { mathInlineSchema } from './editorMathInline';
import { runEditorClipboardAction } from './editorClipboard';
import { readClipboardText } from '../../browser/clipboard';
import { createEditorPasteBehavior } from './editorPasteBehavior';

vi.mock('../../browser/clipboard', () => ({ readClipboardText: vi.fn(), writeClipboardText: vi.fn(), runDocumentCommand: vi.fn() }));

const editors: Editor[] = [];
afterEach(async () => { await Promise.all(editors.splice(0).map(editor => editor.destroy())); document.body.replaceChildren(); });
async function create(markdown = '') {
  const root = document.createElement('div');
  document.body.append(root);
  const editor = await Editor.make().config(ctx => { ctx.set(rootCtx, root); ctx.set(defaultValueCtx, markdown); ctx.set(editorViewOptionsCtx, { handleScrollToSelection: () => true }); })
    .use(commonmark).use(mathRemark).use(mathInlineGuardRemark).use(mathBlockSchema).use(mathInlineSchema)
    .use(createEditorPasteBehavior(() => {})).create();
  editors.push(editor);
  return editor;
}

describe('公式粘贴边界', () => {
  it('只转换普通正文，保留代码与既有数学源码', async () => {
    const editor = await create();
    const protectedText = ['```tex\n\\(code\\)\n```', '    \\(indent\\)', '`\\(inline\\)`', '$\\(existing\\)$', '$$\n\\[existing\\]\n$$'].join('\n\n');
    expect(convertTexMathDelimiters(protectedText, source => editor.ctx.get(remarkCtx).parse(source))).toBe(protectedText);
  });
  it('转换正文内单双分隔符，并保留空白和不完整输入', async () => {
    const editor = await create();
    const convert = (source: string) => convertTexMathDelimiters(source, text => editor.ctx.get(remarkCtx).parse(text));
    expect(convert('设 \\( a_1 + b_2 \\) 成立')).toBe('设 $a_1 + b_2$ 成立');
    expect(convert('前文\n\n\\[\n\\frac{1}{2}\n\\]\n\n后文')).toBe('前文\n\n\n\n$$\n\\frac{1}{2}\n$$\n\n\n\n后文');
    expect(convert('\\[a\n\nb\\]')).toBe('\n\n$$\na\n\nb\n$$\n\n');
    expect(convert('\\( \\) 和 \\[未闭合')).toBe('\\( \\) 和 \\[未闭合');
  });
  it('尊重转义、不同长度代码围栏、引用和列表内代码边界', async () => {
    const editor = await create();
    const convert = (source: string) => convertTexMathDelimiters(source, text => editor.ctx.get(remarkCtx).parse(text));
    const untouched = [String.raw`\\(escaped\\)`, '``包含 ` 与 \\(x\\)``', '~~~tex\n\\(x\\)\n~~~', '> ```tex\n> \\(x\\)\n> ```', '- item\n\n      \\(x\\)', '[link](https://example.test/\\(x\\))'].join('\n\n');
    expect(convert(untouched)).toBe(untouched);
    expect(convert('`\\(code\\)` 与 \\(math\\)')).toBe('`\\(code\\)` 与 $math$');
    expect(convert(String.raw`\\\(math\)`)).toBe(String.raw`\\$math$`);
  });
  it('TeX 行内公式后紧跟数字仍解析为公式', async () => {
    const editor = await create();
    const view = editor.ctx.get(editorViewCtx);
    const source = '\\(x\\)2';
    view.pasteText(source, { clipboardData: { items: [], getData: (type: string) => type === 'text/plain' ? source : '' }, preventDefault() {} } as unknown as ClipboardEvent);
    expect(view.state.doc.firstChild?.firstChild?.type.name).toBe('math_inline');
    expect(view.state.doc.firstChild?.textContent).toBe('x2');
  });
  it.each([String.raw`a\$`, String.raw`$a`, String.raw`\$`])('美元边界源码 %s 粘贴与保存重载保持数学节点', async body => {
    const editor = await create();
    const view = editor.ctx.get(editorViewCtx);
    const source = `\\(${body}\\)`;
    view.pasteText(source, { clipboardData: { items: [], getData: (type: string) => type === 'text/plain' ? source : '' }, preventDefault() {} } as unknown as ClipboardEvent);
    expect(view.state.doc.firstChild?.firstChild?.type.name).toBe('math_inline');
    expect(view.state.doc.firstChild?.firstChild?.textContent).toBe(body);
    const restored = await create(editor.action(getMarkdown()));
    expect(restored.ctx.get(editorViewCtx).state.doc.toJSON()).toEqual(view.state.doc.toJSON());
  });
  it.each(['- \\[x\\]\n- 后项', '> \\[x\\]\n> 后文'])('容器内块 TeX 不破坏列表或引用结构：%s', async source => {
    const editor = await create();
    const converted = convertTexMathDelimiters(source, text => editor.ctx.get(remarkCtx).parse(text));
    expect(converted).toBe(source);
    const pasted = await create(converted);
    const expectedType = source.startsWith('-') ? 'bullet_list' : 'blockquote';
    expect(pasted.ctx.get(editorViewCtx).state.doc.childCount).toBe(1);
    expect(pasted.ctx.get(editorViewCtx).state.doc.firstChild?.type.name).toBe(expectedType);
    const restored = await create(pasted.action(getMarkdown()));
    expect(restored.ctx.get(editorViewCtx).state.doc.toJSON()).toEqual(pasted.ctx.get(editorViewCtx).state.doc.toJSON());
  });
  it('菜单粘贴与快捷键共用 TeX 转换，保存重载保留公式', async () => {
    const editor = await create();
    vi.mocked(readClipboardText).mockResolvedValue({ ok: true, text: String.raw`设 \(a\$\) 成立` });
    expect(await runEditorClipboardAction(editor, 'paste')).toEqual({ ok: true });
    const doc = editor.ctx.get(editorViewCtx).state.doc;
    expect(doc.firstChild?.child(1).type.name).toBe('math_inline');
    expect(doc.firstChild?.child(1).textContent).toBe(String.raw`a\$`);
    const restored = await create(editor.action(getMarkdown()));
    expect(restored.ctx.get(editorViewCtx).state.doc.toJSON()).toEqual(doc.toJSON());
  });
  it('行内公式中粘贴 TeX 保留纯源码', async () => {
    const editor = await create('$a$');
    const view = editor.ctx.get(editorViewCtx);
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 3)));
    view.pasteText('\\(x\\)', { clipboardData: { items: [], getData: (type: string) => type === 'text/plain' ? '\\(x\\)' : '' }, preventDefault() {} } as unknown as ClipboardEvent);
    expect(view.state.doc.firstChild?.firstChild?.type.name).toBe('math_inline');
    expect(view.state.doc.firstChild?.firstChild?.textContent).toBe('a\\(x\\)');
    expect(view.state.doc.firstChild?.childCount).toBe(1);
  });
  it.each([
    ['native', 'inside'], ['menu', 'inside'], ['native', 'stored'], ['menu', 'stored']
  ])('%s 粘贴尊重行内代码 %s 的源码状态', async (entry, location) => {
    const editor = await create(location === 'inside' ? '`abc`' : 'abc');
    const view = editor.ctx.get(editorViewCtx);
    let tr = view.state.tr.setSelection(TextSelection.create(view.state.doc, 2));
    if (location === 'stored') tr = tr.setStoredMarks([view.state.schema.marks.inlineCode!.create()]);
    view.dispatch(tr);
    const source = String.raw`\(x\)`;
    if (entry === 'native') {
      view.pasteText(source, { clipboardData: { items: [], getData: (type: string) => type === 'text/plain' ? source : '' }, preventDefault() {} } as unknown as ClipboardEvent);
    } else {
      vi.mocked(readClipboardText).mockResolvedValue({ ok: true, text: source });
      expect(await runEditorClipboardAction(editor, 'paste')).toEqual({ ok: true });
    }
    const paragraph = view.state.doc.firstChild!;
    expect(paragraph.textContent).toBe(`a${source}bc`);
    expect(paragraph.childCount).toBe(location === 'inside' ? 1 : 3);
    const code = paragraph.child(location === 'inside' ? 0 : 1);
    expect(code.type.name).toBe('text');
    expect(code.marks[0]?.type.name).toBe('inlineCode');
    const restored = await create(editor.action(getMarkdown()));
    expect(restored.ctx.get(editorViewCtx).state.doc.toJSON()).toEqual(view.state.doc.toJSON());
  });
  it('源码判断尊重显式清空的 storedMarks，并拒绝跨父节点选区', async () => {
    const editor = await create('`abc`\n\n末段');
    const view = editor.ctx.get(editorViewCtx);
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 2)));
    expect(shouldPasteAsSource(view.state)).toBe(true);
    view.dispatch(view.state.tr.setStoredMarks([]));
    expect(shouldPasteAsSource(view.state)).toBe(false);
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 2, 7)));
    expect(shouldPasteAsSource(view.state)).toBe(false);
  });
  it.each(['{"mode":"tex"}', ''])('HTML 代码优先于公式转换（VS Code 元数据：%s）', async vscodeData => {
    const editor = await create();
    const view = editor.ctx.get(editorViewCtx);
    const event = { clipboardData: { items: [], getData: (type: string) => type === 'vscode-editor-data' ? vscodeData : type === 'text/plain' ? '\\(x\\)' : '<pre><code>\\(x\\)</code></pre>' }, preventDefault() {} } as unknown as ClipboardEvent;
    view.pasteHTML('<pre><code>\\(x\\)</code></pre>', event);
    expect(view.state.doc.firstChild?.type.name).toBe('code_block');
    expect(view.state.doc.firstChild?.textContent).toBe('\\(x\\)');
  });
});
