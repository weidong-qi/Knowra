import { afterEach, describe, expect, it } from 'vitest';
import { Editor, defaultValueCtx, editorViewCtx, rootCtx, remarkStringifyOptionsCtx } from '@milkdown/kit/core';
import { commonmark } from '@milkdown/kit/preset/commonmark';
import { gfm } from '@milkdown/kit/preset/gfm';
import { getMarkdown } from '@milkdown/kit/utils';
import { mathBlockSchema } from './editorMathBlock';
import { mathInlineSchema } from './editorMathInline';
import { mathInlineGuardRemark, mathRemark } from './editorMathMarkdown';

const editors: Editor[] = [];
async function create(markdown: string, withMath = true) {
  const root = document.createElement('div');
  document.body.append(root);
  const builder = Editor.make()
    .config((ctx) => { ctx.set(rootCtx, root); ctx.set(defaultValueCtx, markdown); })
    .use(commonmark).use(gfm);
  if (withMath) builder.use(mathRemark).use(mathInlineGuardRemark).use(mathBlockSchema).use(mathInlineSchema);
  const editor = await builder.create();
  editors.push(editor);
  return editor;
}
afterEach(async () => {
  await Promise.all(editors.splice(0).map((editor) => editor.destroy()));
  document.body.replaceChildren();
});

async function expectStable(markdown: string) {
  const editor = await create(markdown);
  const saved = editor.action(getMarkdown());
  const reopened = await create(saved);
  expect(reopened.ctx.get(editorViewCtx).state.doc.toJSON()).toEqual(editor.ctx.get(editorViewCtx).state.doc.toJSON());
  return { editor, saved };
}

describe('公式 Markdown 保真', () => {
  it.each(['$ x $', '$ x$', '$x $', '$\tx\t$', '$x$2'])('按原始单美元内容保留普通文本 %s', async (markdown) => {
    const { editor } = await expectStable(markdown);
    expect(editor.ctx.get(editorViewCtx).state.doc.child(0).child(0).type.name).toBe('text');
  });

  it.each([String.raw`literal \$x\$`, String.raw`literal \$5 and 6\$`, String.raw`literal \$\$x\$\$`, String.raw`literal \$x\$ 与 $y$`, String.raw`价格 \$5 与 $x$`, String.raw`价格 \$5 **and 6** \$`, String.raw`价格 **\$5** and 6\$`, String.raw`\$$x$\$`, String.raw`$x$\$`])('保存字面美元不变成公式 %s', async (markdown) => {
    await expectStable(markdown);
  });

  it('普通金额保存仍保持美元原文', async () => {
    const { saved } = await expectStable('价格 $5 和 $6，或 $10 起\n');
    expect(saved).toBe('价格 $5 和 $6，或 $10 起\n');
  });

  it.each(['$$x$$2', '$$ x $$', '$$ x$$', '$$x $$', '$$  $$', '$$a$b$$', '$$$a$$b$$$', '正文 $x$ 和 $y$'])('行内公式往返保留源码与类型 %s', async (markdown) => {
    await expectStable(markdown);
  });

  it('空行内公式保存为空正文，不产生块公式', async () => {
    const editor = await create('前后');
    const view = editor.ctx.get(editorViewCtx);
    view.dispatch(view.state.tr.insert(2, view.state.schema.nodes.math_inline!.create()));
    expect(editor.action(getMarkdown())).toBe('前后\n');
    const reopened = await create(editor.action(getMarkdown()));
    expect(reopened.ctx.get(editorViewCtx).state.doc.child(0).textContent).toBe('前后');
  });
});


describe('多编辑器 stringify 配置隔离', () => {
  it('只替换当前实例的 handlers，不污染已有/后续普通编辑器', async () => {
    const plain = await create(String.raw`literal \$x\$`, false);
    const options = plain.ctx.get(remarkStringifyOptionsCtx);
    const sharedHandlers = options.handlers;
    const originalText = sharedHandlers?.text;
    const baseline = plain.action(getMarkdown());
    const first = await create(String.raw`literal \$x\$`);
    const second = await create(String.raw`literal \$x\$`);
    const laterPlain = await create(String.raw`literal \$x\$`, false);
    expect(options.handlers).toBe(sharedHandlers);
    expect(options.handlers?.text).toBe(originalText);
    expect(laterPlain.ctx.get(remarkStringifyOptionsCtx)).not.toBe(options);
    expect(laterPlain.ctx.get(remarkStringifyOptionsCtx).handlers).toBe(sharedHandlers);
    expect(first.ctx.get(remarkStringifyOptionsCtx)).not.toBe(options);
    expect(first.ctx.get(remarkStringifyOptionsCtx).handlers).not.toBe(sharedHandlers);
    expect(second.ctx.get(remarkStringifyOptionsCtx)).not.toBe(first.ctx.get(remarkStringifyOptionsCtx));
    expect(second.ctx.get(remarkStringifyOptionsCtx).handlers).not.toBe(first.ctx.get(remarkStringifyOptionsCtx).handlers);
    expect(first.action(getMarkdown())).toBe('literal \\$x\\$\n');
    expect(second.action(getMarkdown())).toBe('literal \\$x\\$\n');
    expect(plain.action(getMarkdown())).toBe(baseline);
    expect(laterPlain.action(getMarkdown())).toBe(baseline);
  });
});
