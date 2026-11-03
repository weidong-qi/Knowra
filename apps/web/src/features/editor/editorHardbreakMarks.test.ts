import { afterEach, describe, expect, it } from 'vitest';
import { Editor, defaultValueCtx, editorViewCtx, remarkStringifyOptionsCtx, rootCtx } from '@milkdown/kit/core';
import { commonmark, hardbreakClearMarkPlugin } from '@milkdown/kit/preset/commonmark';
import { gfm } from '@milkdown/kit/preset/gfm';
import type { MarkType } from '@milkdown/kit/prose/model';
import { getMarkdown } from '@milkdown/kit/utils';
import { commonmarkPreset } from './editorHardbreakMarks';
import { highlightRemark, highlightSchema } from './editorHighlight';

const editors: Editor[] = [];
async function create(markdown: string) {
  const root = document.createElement('div');
  document.body.append(root);
  const editor = await Editor.make()
    .config((ctx) => {
      ctx.set(rootCtx, root);
      ctx.set(defaultValueCtx, markdown);
      ctx.update(remarkStringifyOptionsCtx, (options) => {
        type MarkdownHandler = NonNullable<typeof options.handlers>['text'];
        const highlight: MarkdownHandler = (node, _parent, state, info) => (
          `==${state.containerPhrasing(node, { ...info, before: '=', after: '=' })}==`
        );
        return { ...options, handlers: { ...options.handlers, highlight } };
      });
    })
    .use(commonmarkPreset).use(gfm).use(highlightRemark).use(highlightSchema)
    .create();
  editors.push(editor);
  return editor;
}
afterEach(async () => {
  await Promise.all(editors.splice(0).map((editor) => editor.destroy()));
  document.body.replaceChildren();
});

function paragraphRange(editor: Editor) {
  const { doc } = editor.ctx.get(editorViewCtx).state;
  return { from: 1, to: doc.child(0).nodeSize - 1 };
}
function addMark(editor: Editor, markName: string) {
  const view = editor.ctx.get(editorViewCtx);
  const { from, to } = paragraphRange(editor);
  view.dispatch(view.state.tr.addMark(from, to, (view.state.schema.marks[markName] as MarkType).create()));
}
function removeMark(editor: Editor, markName: string) {
  const view = editor.ctx.get(editorViewCtx);
  const { from, to } = paragraphRange(editor);
  view.dispatch(view.state.tr.removeMark(from, to, view.state.schema.marks[markName] as MarkType));
}
function hardbreaks(editor: Editor) {
  const result: Array<{ isInline: unknown; marks: number }> = [];
  editor.ctx.get(editorViewCtx).state.doc.descendants((node) => {
    if (node.type.name === 'hardbreak') result.push({ isInline: node.attrs.isInline, marks: node.marks.length });
  });
  return result;
}

describe('hardbreak 格式化保留软换行', () => {
  it('替换了 commonmark 自带的 hardbreakClearMarkPlugin', () => {
    expect(commonmark).toContain(hardbreakClearMarkPlugin);
    expect(commonmarkPreset).not.toContain(hardbreakClearMarkPlugin);
  });

  it.each([
    ['strong', '**第一行**\n**第二行**\n'],
    ['highlight', '==第一行==\n==第二行==\n']
  ])('跨软换行添加 %s 后仍是软换行，取消后恢复原文', async (markName, marked) => {
    const editor = await create('第一行\n第二行\n');
    expect(hardbreaks(editor)).toEqual([{ isInline: true, marks: 0 }]);

    addMark(editor, markName);
    expect(hardbreaks(editor)).toEqual([{ isInline: true, marks: 0 }]);
    expect(editor.action(getMarkdown())).toBe(marked);

    removeMark(editor, markName);
    expect(editor.action(getMarkdown())).toBe('第一行\n第二行\n');
  });

  it('硬换行加粗后仍是硬换行且不带 mark', async () => {
    const editor = await create('第一行\\\n第二行\n');
    expect(hardbreaks(editor)).toEqual([{ isInline: false, marks: 0 }]);

    addMark(editor, 'strong');
    expect(hardbreaks(editor)).toEqual([{ isInline: false, marks: 0 }]);
    expect(editor.action(getMarkdown())).toBe('**第一行**\\\n**第二行**\n');

    removeMark(editor, 'strong');
    expect(editor.action(getMarkdown())).toBe('第一行\\\n第二行\n');
  });

  it('同一事务中靠后的 AddMarkStep 也会清理 hardbreak 上的 mark', async () => {
    const editor = await create('第一行\n第二行\n');
    const view = editor.ctx.get(editorViewCtx);
    const { schema } = view.state;
    const { from, to } = paragraphRange(editor);
    view.dispatch(view.state.tr
      .addMark(from, from + 1, schema.marks.emphasis!.create())
      .addMark(from, to, schema.marks.strong!.create()));
    expect(hardbreaks(editor)).toEqual([{ isInline: true, marks: 0 }]);
  });
});
