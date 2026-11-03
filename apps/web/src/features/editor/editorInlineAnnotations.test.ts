import { afterEach, describe, expect, it } from 'vitest';
import { $prose } from '@milkdown/kit/utils';
import { history, undo, redo, closeHistory } from '@milkdown/kit/prose/history';
import { TextSelection } from '@milkdown/kit/prose/state';
import type { EditorView } from '@milkdown/kit/prose/view';
import { parseKnowraMarks } from '@study-accelerator/shared/knowra-marks';
import type { Annotation } from '@study-accelerator/web-core';
import {
  createInlineAnnotation,
  excludeBlockFromInlineAnnotation,
  inlineAnnotationRanges,
  reanchorInlineAnnotation,
  removeInlineAnnotation,
  restoreInlineAnnotation,
  selectInlineAnnotation,
  setInlineAnnotationRows,
  updateInlineAnnotation
} from './editorInlineAnnotations';
import { createBlockIdentityBehavior } from './editorBlockIdentity';
import { createHeadlessNoteCodec } from './headlessNoteCodec';
import { createKnowraTestEditor } from './annotationInlineMigration.testing';

const destroyers: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const destroy of destroyers.splice(0)) await destroy();
});
async function open(markdown: string) {
  const editor = await createKnowraTestEditor(markdown);
  destroyers.push(editor.destroy);
  return editor;
}
const textPos = (view: EditorView, needle: string) => {
  let found = -1;
  view.state.doc.descendants((node, position) => {
    if (found < 0 && node.isText && node.text!.includes(needle)) found = position + node.text!.indexOf(needle);
  });
  return found;
};
const select = (view: EditorView, needle: string, length = needle.length) => {
  const from = textPos(view, needle);
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, from, from + length)));
};
const row = (markId: string, id = `annotation-k-${markId}`) =>
  ({
    id,
    schemaVersion: 3,
    lifecycleStatus: 'active',
    anchor: { format: 'knowra-inline', markId }
  }) as unknown as Annotation;

const NOTE =
  '## 第一章\n\n勾股定理指出两边平方和等于斜边平方。\n\n- 动量守恒\n- 能量守恒\n\n### 子节\n\n子节正文\n\n## 第二章\n\n尾段\n';

describe('内联重点：编辑器操作只改正文标记', () => {
  it('四种范围的新建都写成正确的正文标记，重要程度写入属性', async () => {
    const { view, serialize } = await open(NOTE);
    select(view, '两边平方和');
    const sel = createInlineAnnotation(view, 'selection', 'core');
    select(view, '动量', 0);
    const list = createInlineAnnotation(view, 'list');
    select(view, '第一章', 0);
    const section = createInlineAnnotation(view, 'section', 'important');
    select(view, '尾段', 0);
    const block = createInlineAnnotation(view, 'blocks');
    const parsed = parseKnowraMarks(serialize(view.state.doc));
    expect(parsed.problems).toEqual([]);
    expect(parsed.inline.find(item => item.id === sel)?.attrs).toMatchObject({ t: 'key', l: 'core' });
    expect(parsed.blocks.find(item => item.id === list)?.attrs.s).toBe('list');
    expect(parsed.blocks.find(item => item.id === section)?.attrs).toMatchObject({ s: 'section', l: 'important' });
    expect(parsed.blocks.find(item => item.id === block)?.attrs.s).toBe('blocks');
    const ranges = inlineAnnotationRanges(view.state.doc).byId;
    expect(view.state.doc.textBetween(ranges[section][0].from, ranges[section].at(-1)!.to)).toContain('子节正文');
    expect(view.state.doc.textBetween(ranges[section][0].from, ranges[section].at(-1)!.to)).not.toContain('第二章');
  });

  it('没有选中文字、不在章节或普通列表项内时给出与旧入口一致的提示', async () => {
    const { view } = await open('正文\n\n- [ ] 任务');
    select(view, '正文', 0);
    expect(() => createInlineAnnotation(view, 'selection')).toThrow('请先在正文中选中要标记的内容');
    expect(() => createInlineAnnotation(view, 'section')).toThrow('请先将光标放在标题章节内');
    select(view, '任务', 0);
    expect(() => createInlineAnnotation(view, 'list')).toThrow('请先将光标放在非空的普通列表项内');
  });

  it('取消后可以撤销；正文变了就拒绝撤销', async () => {
    const { view, serialize } = await open(NOTE);
    select(view, '两边平方和');
    const markId = createInlineAnnotation(view, 'selection');
    const marked = serialize(view.state.doc);
    const snapshot = removeInlineAnnotation(view, markId);
    expect(parseKnowraMarks(serialize(view.state.doc)).inline).toEqual([]);
    restoreInlineAnnotation(view, snapshot);
    expect(serialize(view.state.doc)).toBe(marked);
    const again = removeInlineAnnotation(view, markId);
    view.dispatch(view.state.tr.insertText('改', textPos(view, '两边')));
    expect(() => restoreInlineAnnotation(view, again)).toThrow('正文已经变化');
  });

  it('改类型和重要程度：所有片段与块属性一起改；重新选择保留 ID 与属性', async () => {
    const { view, serialize } = await open(NOTE);
    select(view, '两边平方和');
    const markId = createInlineAnnotation(view, 'selection', 'important');
    updateInlineAnnotation(view, markId, { kind: 'pitfall', importance: 'core' });
    expect(parseKnowraMarks(serialize(view.state.doc)).inline[0].attrs).toMatchObject({ c: 'pitfall', l: 'core' });
    select(view, '斜边平方');
    reanchorInlineAnnotation(view, markId, 'selection');
    const [moved] = parseKnowraMarks(serialize(view.state.doc)).inline;
    expect(moved).toMatchObject({ id: markId, attrs: { c: 'pitfall', l: 'core' } });
    expect(
      view.state.doc.textBetween(
        inlineAnnotationRanges(view.state.doc).byId[markId][0].from,
        inlineAnnotationRanges(view.state.doc).byId[markId][0].to
      )
    ).toBe('斜边平方');
  });

  it('排除当前块：只能排除章节范围内的块，排除后显示范围不含该块', async () => {
    const { view, serialize } = await open(NOTE);
    select(view, '第一章', 0);
    const markId = createInlineAnnotation(view, 'section');
    select(view, '尾段', 0);
    expect(() => excludeBlockFromInlineAnnotation(view, markId)).toThrow('当前内容块不在这条重点范围内');
    select(view, '子节正文', 0);
    excludeBlockFromInlineAnnotation(view, markId);
    expect(parseKnowraMarks(serialize(view.state.doc)).blocks.some(item => item.id === markId && item.exclude)).toBe(
      true
    );
    const text = inlineAnnotationRanges(view.state.doc)
      .byId[markId].map(range => view.state.doc.textBetween(range.from, range.to))
      .join('|');
    expect(text).not.toContain('子节正文');
  });

  it('显示：装饰带 v3 行 ID 与重要程度，可被点击选中；定位选中第一段', async () => {
    const { view } = await open(NOTE);
    select(view, '两边平方和');
    const markId = createInlineAnnotation(view, 'selection', 'core');
    setInlineAnnotationRows(view, [row(markId)], null);
    const element = view.dom.querySelector<HTMLElement>('[data-annotation-ids]')!;
    expect(element.className).toContain('editor-annotation');
    expect(element.dataset.importance).toBe('core');
    expect(JSON.parse(element.dataset.annotationIds!)).toEqual([`annotation-k-${markId}`]);
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1)));
    expect(selectInlineAnnotation(view, markId)).toBe(true);
    expect(view.state.doc.textBetween(view.state.selection.from, view.state.selection.to)).toBe('两边平方和');
  });
});

it('不支持行内标记的公式选区和空段落明确拒绝，不写入部分标记', async () => {
  const math = await open('$$\nx = y\n$$');
  select(math.view, 'x = y');
  expect(() => createInlineAnnotation(math.view, 'selection')).toThrow('当前范围不支持');
  expect(parseKnowraMarks(math.serialize(math.view.state.doc)).inline).toEqual([]);
  const empty = await open('');
  expect(() => createInlineAnnotation(empty.view, 'blocks')).toThrow('空段落');
  expect(parseKnowraMarks(empty.serialize(empty.view.state.doc)).blocks).toEqual([]);
});

it('整段代码选区的末尾新增继承内联重点及属性，重新解析后仍覆盖', async () => {
  const editor = await createHeadlessNoteCodec(
    '```\n甲\n乙\n```',
    [createBlockIdentityBehavior(() => new Set())].flat()
  );
  destroyers.push(editor.destroy);
  select(editor.view, '甲\n乙');
  const id = createInlineAnnotation(editor.view, 'selection', 'core');
  const end = textPos(editor.view, '乙') + 1;
  editor.view.dispatch(editor.view.state.tr.insertText('\n新增行', end));
  const markdown = editor.serialize(editor.view.state.doc);
  const mark = parseKnowraMarks(markdown).blocks.find(item => item.id === id)!;
  expect(mark.code?.text).toBe('甲\n乙\n新增行');
  expect(mark.attrs.l).toBe('core');
  const reopened = editor.parse(markdown);
  const ranges = inlineAnnotationRanges(reopened).byId[id];
  expect(ranges.map(range => reopened.textBetween(range.from, range.to)).join('')).toContain('新增行');
});

it('引用后的光标不错误选择已结束的引用内章节', async () => {
  const noOuter = await open('> ## inner\n>\n> inside\n\noutside');
  select(noOuter.view, 'outside', 0);
  expect(() => createInlineAnnotation(noOuter.view, 'section')).toThrow('章节内');
  const outer = await open('# outer\n\n> ## inner\n>\n> inside\n\noutside');
  select(outer.view, 'outside', 0);
  const id = createInlineAnnotation(outer.view, 'section');
  const ranges = inlineAnnotationRanges(outer.view.state.doc).byId[id];
  expect(outer.view.state.doc.textBetween(ranges[0].from, ranges[0].to)).toContain('outside');
});

it('部分代码选区不因代码末尾新增而扩大', async () => {
  const editor = await createHeadlessNoteCodec(
    '```\n甲\n乙\n```',
    [createBlockIdentityBehavior(() => new Set())].flat()
  );
  destroyers.push(editor.destroy);
  select(editor.view, '甲');
  const id = createInlineAnnotation(editor.view, 'selection');
  editor.view.dispatch(editor.view.state.tr.insertText('\n新增行', textPos(editor.view, '乙') + 1));
  const mark = parseKnowraMarks(editor.serialize(editor.view.state.doc)).blocks.find(item => item.id === id)!;
  expect(mark.code?.text).toBe('甲');
});

it('整段代码重点可改重要级、取消及撤销重做，不被边界继承复活', async () => {
  const editor = await createHeadlessNoteCodec(
    '```\nabc\n```',
    [createBlockIdentityBehavior(() => new Set()), $prose(() => history())].flat()
  );
  destroyers.push(editor.destroy);
  select(editor.view, 'abc');
  const id = createInlineAnnotation(editor.view, 'selection', 'core');
  editor.view.dispatch(closeHistory(editor.view.state.tr));
  updateInlineAnnotation(editor.view, id, { importance: 'important' });
  const mark = () => parseKnowraMarks(editor.serialize(editor.view.state.doc)).blocks.find(item => item.id === id);
  expect(mark()?.attrs.l).toBe('important');
  editor.view.dispatch(closeHistory(editor.view.state.tr));
  removeInlineAnnotation(editor.view, id);
  expect(inlineAnnotationRanges(editor.view.state.doc).byId[id]).toBeUndefined();
  expect(undo(editor.view.state, editor.view.dispatch)).toBe(true);
  expect(mark()?.attrs.l).toBe('important');
  expect(redo(editor.view.state, editor.view.dispatch)).toBe(true);
  expect(mark()).toBeUndefined();
  expect(undo(editor.view.state, editor.view.dispatch)).toBe(true);
  editor.view.dispatch(closeHistory(editor.view.state.tr).insertText('d', textPos(editor.view, 'abc') + 3));
  expect(mark()?.code?.text).toBe('abcd');
  expect(undo(editor.view.state, editor.view.dispatch)).toBe(true);
  expect(mark()?.code?.text).toBe('abc');
  expect(redo(editor.view.state, editor.view.dispatch)).toBe(true);
  expect(mark()?.code?.text).toBe('abcd');
});

it('取消后插入相同文字，不把自定义撤销误恢复到新内容', async () => {
  const editor = await open('abc tail');
  select(editor.view, 'abc');
  const id = createInlineAnnotation(editor.view, 'selection');
  const snapshot = removeInlineAnnotation(editor.view, id);
  editor.view.dispatch(editor.view.state.tr.insertText('abc', 1));
  expect(() => restoreInlineAnnotation(editor.view, snapshot)).toThrow('正文已经变化');
  expect(inlineAnnotationRanges(editor.view.state.doc).byId[id]).toBeUndefined();
});

it('章节重点在代码块末尾编辑、重新设定范围和重开后仍覆盖代码', async () => {
  const editor = await open('## 读取数据\n\n问题\n\n```\n第一行\n最后一行\n```\n\n## 下一章\n\n正文');
  select(editor.view, '读取数据', 0);
  const id = createInlineAnnotation(editor.view, 'section', 'core');
  setInlineAnnotationRows(editor.view, [row(id)], null);
  const codeHighlight = () => editor.view.dom.querySelector<HTMLElement>('pre code .editor-annotation');
  expect(codeHighlight()?.textContent).toBe('第一行\n最后一行');
  editor.view.dispatch(editor.view.state.tr.insertText('新增', textPos(editor.view, '最后一行') + 4));
  expect(codeHighlight()?.textContent).toBe('第一行\n最后一行新增');
  expect(codeHighlight()?.dataset.importance).toBe('core');
  select(editor.view, '读取数据', 0);
  reanchorInlineAnnotation(editor.view, id, 'section');
  expect(codeHighlight()?.textContent).toBe('第一行\n最后一行新增');
  const reopened = await open(editor.serialize(editor.view.state.doc));
  expect(reopened.view.dom.querySelector('pre code .editor-annotation')?.textContent).toBe('第一行\n最后一行新增');
});
