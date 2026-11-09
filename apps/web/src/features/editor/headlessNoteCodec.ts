import { Editor, defaultValueCtx, editorViewCtx, parserCtx, rootCtx, serializerCtx } from '@milkdown/kit/core';
import type { MilkdownPlugin } from '@milkdown/kit/ctx';
import { gfm } from '@milkdown/kit/preset/gfm';
import type { Node as ProseNode } from '@milkdown/kit/prose/model';
import type { EditorView } from '@milkdown/kit/prose/view';
import { commonmarkPreset } from './editorHardbreakMarks';
import { noteLinkSchema } from './editorNoteLinks';
import { createCodeBlockBehavior } from './editorCodeBlock';
import { mathBlockSchema, mathBlockSerializerGuard } from './editorMathBlock';
import { mathInlineSchema } from './editorMathInline';
import { mathInlineGuardRemark, mathRemark } from './editorMathMarkdown';
import { cjkFriendlyEmptyPhrasingGuard, cjkFriendlyRemark, cjkFriendlyStrikethroughRemark } from './editorCjkFriendly';
import { highlightRemark, highlightSchema } from './editorHighlight';
import { internalLinkRemark, internalLinkSchema } from './editorInternalLink';
import { configureImageSize } from './editorImageBehavior';
import { configureBlockIdentitySchema } from './editorBlockIdentity';
import { createKnowraMarksCodec, knowraMarkSchema, type KnowraMarkProblem } from './editorKnowraMarks';
import { configureNoteMarkdownStringify } from './editorMarkdownStringify';
import { inlineAnnotationHighlightBehavior } from './editorInlineAnnotations';

export interface HeadlessNoteCodec {
  view: EditorView;
  /** 编辑器解析器（已接入 Knowra 标记转换）。 */
  parse(markdown: string): ProseNode;
  /** 编辑器序列化器（已接入 Knowra 标记转换）。 */
  serialize(doc: ProseNode): string;
  /** 取出并清空上一次 parse / serialize 期间的标记问题。 */
  takeProblems(): KnowraMarkProblem[];
  destroy(): Promise<void>;
}

/**
 * 无界面笔记编辑器：与 MilkdownNoteEditor 相同的 schema、remark 与写出规则（只取影响解析和写出的部分，
 * 交互插件不需要），供测试按真实编辑器解析和写出正文。挂在不可见的容器里，用完必须 destroy。
 */
export async function createHeadlessNoteCodec(
  markdown = '',
  extraPlugins: MilkdownPlugin[] = []
): Promise<HeadlessNoteCodec> {
  const globals = globalThis as Record<string, unknown>;
  globals.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  const problems: KnowraMarkProblem[] = [];
  const root = document.createElement('div');
  root.hidden = true;
  root.setAttribute('aria-hidden', 'true');
  document.body.append(root);
  const editor = await Editor.make()
    .config(ctx => {
      configureImageSize(ctx);
      ctx.set(rootCtx, root);
      ctx.set(defaultValueCtx, markdown);
      configureNoteMarkdownStringify(ctx);
    })
    .use(commonmarkPreset)
    .use(noteLinkSchema)
    .use(createCodeBlockBehavior(() => {}))
    .use(gfm)
    .use(cjkFriendlyRemark)
    .use(cjkFriendlyStrikethroughRemark)
    .use(cjkFriendlyEmptyPhrasingGuard)
    .use(mathRemark)
    .use(mathInlineGuardRemark)
    .use(mathBlockSchema)
    .use(mathBlockSerializerGuard)
    .use(mathInlineSchema)
    .use(highlightRemark)
    .use(highlightSchema)
    .use(internalLinkRemark)
    .use(internalLinkSchema)
    .use(knowraMarkSchema)
    .use(createKnowraMarksCodec(problem => problems.push(problem)))
    .use(extraPlugins)
    .config(configureBlockIdentitySchema)
    .create();
  return {
    view: editor.ctx.get(editorViewCtx),
    parse: (text: string) => editor.ctx.get(parserCtx)(text) as ProseNode,
    serialize: (doc: ProseNode) => editor.ctx.get(serializerCtx)(doc),
    takeProblems: () => problems.splice(0),
    destroy: async () => {
      await editor.destroy();
      root.remove();
    }
  };
}

/** 带内联重点显示插件的测试编辑器：返回视图，供操作与装饰测试使用。 */
export async function createKnowraTestEditor(markdown: string) {
  return createHeadlessNoteCodec(markdown, [inlineAnnotationHighlightBehavior].flat());
}
