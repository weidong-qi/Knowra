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
import { highlightRemark, highlightSchema } from './editorHighlight';
import { internalLinkRemark, internalLinkSchema } from './editorInternalLink';
import { configureImageSize } from './editorImageBehavior';
import { annotationMarkSchema, annotationSerializerGuard, configureBlockIdentitySchema } from './editorBlockIdentity';
import { createKnowraMarksCodec, knowraMarkSchema, type KnowraMarkProblem } from './editorKnowraMarks';
import { configureNoteMarkdownStringify } from './editorMarkdownStringify';
import type { MigrationCodec } from './annotationInlineMigration';

export interface HeadlessNoteCodec extends MigrationCodec {
  view: EditorView;
  destroy(): Promise<void>;
}

/**
 * 无界面笔记编辑器：与 MilkdownNoteEditor 相同的 schema、remark 与写出规则（只取影响解析和写出的部分，
 * 交互插件不需要），用于重点迁移逐篇打开、改写并写出正文。挂在不可见的容器里，用完必须 destroy。
 */
export async function createHeadlessNoteCodec(markdown = '', extraPlugins: MilkdownPlugin[] = []): Promise<HeadlessNoteCodec> {
  const globals = globalThis as Record<string, unknown>;
  globals.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} };
  const problems: KnowraMarkProblem[] = [];
  const root = document.createElement('div');
  root.hidden = true;
  root.setAttribute('aria-hidden', 'true');
  document.body.append(root);
  const editor = await Editor.make().config(ctx => {
    configureImageSize(ctx);
    ctx.set(rootCtx, root);
    ctx.set(defaultValueCtx, markdown);
    configureNoteMarkdownStringify(ctx);
  }).use(commonmarkPreset).use(noteLinkSchema).use(createCodeBlockBehavior(() => {})).use(gfm)
    .use(mathRemark).use(mathInlineGuardRemark).use(mathBlockSchema).use(mathBlockSerializerGuard).use(mathInlineSchema)
    .use(highlightRemark).use(highlightSchema).use(internalLinkRemark).use(internalLinkSchema)
    .use(annotationMarkSchema).use(annotationSerializerGuard)
    .use(knowraMarkSchema).use(createKnowraMarksCodec(problem => problems.push(problem)))
    .use(extraPlugins)
    .config(configureBlockIdentitySchema)
    .create();
  return {
    view: editor.ctx.get(editorViewCtx),
    parse: (text: string) => editor.ctx.get(parserCtx)(text) as ProseNode,
    serialize: (doc: ProseNode) => editor.ctx.get(serializerCtx)(doc),
    takeProblems: () => problems.splice(0),
    destroy: async () => { await editor.destroy(); root.remove(); }
  };
}
