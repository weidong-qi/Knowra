import { it, expect } from 'vitest';
import { Editor, rootCtx, defaultValueCtx, editorViewCtx, serializerCtx, remarkStringifyOptionsCtx } from '@milkdown/kit/core';
import { commonmark } from '@milkdown/kit/preset/commonmark';
import { gfm } from '@milkdown/kit/preset/gfm';
import { getAnnotationSelection, resolveAnnotationRange, createAnnotationHighlightBehavior, setEditorAnnotations, annotationPluginKey } from './editorAnnotations';
import type { Annotation } from '@study-accelerator/web-core';
import { highlightRemark, highlightSchema } from './editorHighlight';
import { internalLinkRemark, internalLinkSchema } from './editorInternalLink';
import { TextSelection } from '@milkdown/kit/prose/state';
import { anchorForSection, projectMarkdown } from '@study-accelerator/content-anchor';

const long = '### 合成流程\n\n总述\n\n' + Array.from({ length: 7 }, (_, i) =>
  '### 步骤' + i + '\n\n**说明**' + '说明'.repeat(70)
    + '\n\nX∈Rn×4\n\n> 引用\n\n* 甲\n* 乙\n\n```\n甲\n\n乙\n```\n\n***\n\n结论\n\n').join('');
const cases = [
  ['Markdown分隔空白', '### 标题\n\n\n\n正文\n\n\n', false],
  ['编辑器首尾空段', '### 标题\n\n<br />\n\n正文\n\n<br />', false],
  ['同级长流程', long, true],
  ['二级父标题长流程', '## 合成父标题\n\n' + long, false],
  ['纯长度对照', '## 长度对照\n\n' + '合成段落内容。'.repeat(1500), false],
  ['复杂结构短章节', '## 复杂结构\n\n正文\n\n* 一\n* 二\n\n> 引用\n\n***\n\n尾部', false]
] as const;

it.each(cases)('%s：创建和重开依标题身份定位，保留同级边界', async (_label, markdown, hasPeerBoundary) => {
  const root = document.createElement('div'); document.body.append(root);
  const editor = await Editor.make().config(ctx => {
    ctx.set(rootCtx, root); ctx.set(defaultValueCtx, markdown);
  }).use(commonmark).use(gfm).create();
  try {
    const view = editor.ctx.get(editorViewCtx);
    const serialized = editor.ctx.get(serializerCtx)(view.state.doc);
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1)));
    const selected = getAnnotationSelection(editor, serialized, 'section');
    expect(selected).not.toBeNull();
    expect(resolveAnnotationRange(view.state.doc, selected! as Annotation, projectMarkdown(serialized))).toEqual({
      from: 1, to: hasPeerBoundary ? view.state.doc.child(0).nodeSize + view.state.doc.child(1).nodeSize : view.state.doc.content.size
    });
    if (hasPeerBoundary) expect(selected!.quoteText).toBe('合成流程\n总述');
    if (_label === '二级父标题长流程') expect(selected!.quoteText).toContain('步骤6');
    expect(getAnnotationSelection(editor, serialized.replace(/标题|合成流程|合成父标题|长度对照|复杂结构/, '不同标题'), 'section')).toBeNull();
  } finally { await editor.destroy(); root.remove(); }
});

it.each([false, true])('引用定义省略后重开首节：重复标题=%s仍绑定原投影位置', async duplicate => {
  const markdown = duplicate
    ? '[甲]: https://example.com/a\n\n[乙]: https://example.com/b\n\n## 同名\n\n正文\n\n## 同名\n\n正文'
    : '[甲]: https://example.com/a\n\n## 唯一\n\n正文';
  const root = document.createElement('div'); document.body.append(root);
  const editor = await Editor.make().config(ctx => {
    ctx.set(rootCtx, root); ctx.set(defaultValueCtx, markdown);
  }).use(commonmark).use(gfm).create();
  try {
    const doc = editor.ctx.get(editorViewCtx).state.doc;
    const projection = projectMarkdown(markdown);
    for (let index = 0; index < projection.sections.length; index++) {
      const anchor = anchorForSection(projection, index);
      const annotation = { scopeType: 'section', anchor, quoteText: anchor.quoteText } as Annotation;
      const expectedFrom = index === 0 ? 1 : doc.child(0).nodeSize + doc.child(1).nodeSize + 1;
      const resolved = resolveAnnotationRange(doc, annotation, projectMarkdown(editor.ctx.get(serializerCtx)(doc)));
      expect(resolved?.from).toBe(expectedFrom);
      expect(resolved!.to).toBe(index === 0 && duplicate ? expectedFrom - 1 + doc.child(0).nodeSize + doc.child(1).nodeSize : doc.content.size);
    }
  } finally { await editor.destroy(); root.remove(); }
});

const canonicalCases = [
  ['HTML注释', '<!-- metadata -->', 0],
  ['HTML块', '<div>Metadata</div>', 0],
  ['行内HTML', 'Before <span>inline</span> after', 0],
  ['空代码块', '```\n```', 0],
  ['空表格单元格', '| A | B |\n| - | - |\n|   |   |', 0],
  ['行内代码表格', '| A | B |\n| - | - |\n| **x** | `y` |', 0],
  ['图片', '![](synthetic.png)', 0],
  ['硬换行', 'Before  \nafter', 0],
  ['高亮语法', '==Highlight==', 0],
  ['内部链接语法', '[[InternalLink]]', 0],
  ['HTML重复章节', Array(5).fill('<!-- metadata -->').join('\n\n'), 1]
] as const;
it.each(canonicalCases)('%s：复用规范投影，创建和持久化高亮仍绑定准确章节', async (_label, prefix, index) => {
  const markdown = prefix + '\n\n' + Array(3).fill('## Same\n\nBody ==highlight== [[link]]').join('\n\n');
  const root = document.createElement('div'); document.body.append(root);
  const editor = await Editor.make().config(ctx => {
    ctx.set(rootCtx, root); ctx.set(defaultValueCtx, markdown);
    ctx.update(remarkStringifyOptionsCtx, options => {
      type Handler = NonNullable<typeof options.handlers>['text'];
      const delimited = (open: string, close = open): Handler => (node, _parent, state, info) => {
        const exit = state.enter('emphasis'), tracker = state.createTracker(info);
        let value = tracker.move(open);
        value += tracker.move(state.containerPhrasing(node, { before: value, after: close, ...tracker.current() }));
        value += tracker.move(close); exit(); return value;
      };
      return { ...options, handlers: { ...options.handlers, highlight: delimited('=='), internalLink: delimited('[[', ']]') } };
    });
  })
    .use(commonmark).use(gfm).use(highlightRemark).use(highlightSchema).use(internalLinkRemark).use(internalLinkSchema)
    .use(createAnnotationHighlightBehavior(() => {})).create();
  try {
    const view = editor.ctx.get(editorViewCtx), doc = view.state.doc;
    const positions: number[] = []; doc.forEach((node, position) => { if (node.type.name === 'heading') positions.push(position + 1); });
    const serialized = editor.ctx.get(serializerCtx)(doc), projection = projectMarkdown(serialized);
    const anchor = anchorForSection(projectMarkdown(markdown), index);
    const annotation = { id: 'canonical', scopeType: 'section', anchor, quoteText: anchor.quoteText, anchorStatus: 'resolved' } as Annotation;
    expect(resolveAnnotationRange(doc, annotation, projection)?.from).toBe(positions[index]);
    expect(resolveAnnotationRange(doc, annotation)).toBeNull();
    expect(resolveAnnotationRange(doc, { ...annotation, quoteText: '错误摘录' }, projection)).toBeNull();
    setEditorAnnotations(editor, [annotation], null);
    expect(annotationPluginKey.getState(view.state)?.ranges.get('canonical')?.from).toBe(positions[index]);
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, positions[index])));
    const selected = getAnnotationSelection(editor, serialized, 'section');
    expect(selected).not.toBeNull();
    expect(resolveAnnotationRange(doc, selected! as Annotation, projection)?.from).toBe(positions[index]);
  } finally { await editor.destroy(); root.remove(); }
});

it.each([[3, 1, 'Nested\nInside'], [2, 0, 'Parent\nOutside']] as const)('引用容器内标题等级%s：章节%s创建和重开不扩大', async (level, index, quote) => {
  const markdown = '## Parent\n\nOutside\n\n> ' + '#'.repeat(level) + ' Nested\n>\n> Inside\n\n## Next\n\nNext body';
  const root = document.createElement('div'); document.body.append(root);
  const editor = await Editor.make().config(ctx => { ctx.set(rootCtx, root); ctx.set(defaultValueCtx, markdown); })
    .use(commonmark).use(gfm).use(createAnnotationHighlightBehavior(() => {})).create();
  try {
    const view = editor.ctx.get(editorViewCtx), doc = view.state.doc;
    let position = -1; doc.descendants((node, offset) => { if (node.type.name === 'heading' && node.textContent === (index ? 'Nested' : 'Parent')) position = offset + 1; });
    const serialized = editor.ctx.get(serializerCtx)(doc), projection = projectMarkdown(serialized);
    const anchor = anchorForSection(projectMarkdown(markdown), index);
    const annotation = { id: 'nested', scopeType: 'section', anchor, quoteText: anchor.quoteText, anchorStatus: 'resolved' } as Annotation;
    expect(resolveAnnotationRange(doc, annotation, projection)?.from).toBe(position);
    setEditorAnnotations(editor, [annotation], null);
    expect(annotationPluginKey.getState(view.state)?.ranges.get('nested')?.from).toBe(position);
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, position)));
    const selected = getAnnotationSelection(editor, serialized, 'section');
    expect(selected?.quoteText).toBe(quote);
    const resolved = resolveAnnotationRange(doc, selected! as Annotation, projection)!;
    expect(doc.textBetween(resolved.from, resolved.to, '\n')).toBe(quote);
    expect(resolveAnnotationRange(doc, selected! as Annotation, projection)?.from).toBe(position);
  } finally { await editor.destroy(); root.remove(); }
});
