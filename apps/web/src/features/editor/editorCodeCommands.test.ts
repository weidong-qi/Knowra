import { Schema } from '@milkdown/kit/prose/model';
import { EditorState, TextSelection, type Command } from '@milkdown/kit/prose/state';
import { describe, expect, it } from 'vitest';
import { createCodeFromFence, indentCode, leaveCode, moveToCodeLineBoundary, newlineInCode, removeEmptyCode, selectCodeBlockContents, selectCodeBlockContentsAt } from './editorCodeCommands';
import { applyTyporaCodeBlockCommand } from './editorBlockCommands';
const schema = new Schema({ nodes: {
  doc: { content: 'block+' }, paragraph: { content: 'text*', group: 'block' },
  code_block: { content: 'text*', group: 'block', code: true, attrs: { language: { default: '' } } }, text: {}
} });
function make(text: string, from: number, to = from, type = 'code_block') {
  const doc = schema.node('doc', null, [schema.node(type, type === 'code_block' ? { language: 'python' } : null, text ? schema.text(text) : undefined)]);
  return EditorState.create({ doc, selection: TextSelection.create(doc, from + 1, to + 1) });
}
function run(state: EditorState, command: Command) {
  let next = state;
  expect(command(state, tr => { next = state.apply(tr); })).toBe(true);
  return next;
}
describe('代码块编辑', () => {
  it('全选仅覆盖当前多行代码块，正文与相邻内容保持在选区外', () => {
    const code = 'first\nsecond';
    const doc = schema.node('doc', null, [
      schema.node('paragraph', null, schema.text('before')),
      schema.node('code_block', { language: 'python' }, schema.text(code)),
      schema.node('paragraph', null, schema.text('after'))
    ]);
    const codeStart = doc.child(0).nodeSize + 1;
    const state = EditorState.create({ doc, selection: TextSelection.create(doc, codeStart + 2, codeStart + 5) });
    const next = run(state, selectCodeBlockContents);
    expect(next.selection.from).toBe(codeStart);
    expect(next.selection.to).toBe(codeStart + code.length);
    expect(next.doc).toBe(doc);
    expect(selectCodeBlockContents(next)).toBe(true);
    let refreshed = state;
    expect(selectCodeBlockContentsAt(state, codeStart + 4, codeStart + 4, tr => { refreshed = state.apply(tr); })).toBe(true);
    expect(refreshed.selection.from).toBe(codeStart);
    expect(refreshed.selection.to).toBe(codeStart + code.length);
    const acrossBlocks = EditorState.create({ doc, selection: TextSelection.create(doc, codeStart, codeStart + code.length + 2) });
    expect(selectCodeBlockContents(acrossBlocks)).toBe(false);
  });
  it.each(['', '    ', '\n\t'])('删除空代码块 %j 后保留可输入的正文', text => {
    const next = run(make(text, text.length), removeEmptyCode);
    expect(next.doc.childCount).toBe(1);
    expect(next.selection.$from.parent.type.name).toBe('paragraph');
    expect(next.doc.textContent).toBe('');
  });
  it('退出时在已有正文之前新建空行，不占用已有文字', () => {
    const doc = schema.node('doc', null, [schema.node('code_block', null, schema.text('code')), schema.node('paragraph', null, schema.text('existing'))]);
    const next = run(EditorState.create({ doc, selection: TextSelection.create(doc, 2) }), leaveCode);
    expect(next.doc.childCount).toBe(3);
    expect(next.doc.child(1).textContent).toBe('');
    expect(next.doc.child(2).textContent).toBe('existing');
    expect(next.selection.$from.parent.textContent).toBe('');
  });
  it('不会把非空代码误判为空块', () => {
    expect(removeEmptyCode(make('value', 0))).toBe(false);
  });
  it('多行缩进、反缩进和末行边界保留选区', () => {
    let state = make('one\ntwo\nthree', 0, 8);
    state = run(state, indentCode());
    expect(state.doc.textContent).toBe('    one\n    two\nthree');
    state = run(state, indentCode(true));
    expect(state.doc.textContent).toBe('one\ntwo\nthree');
  });
  it('反缩进仅修改当前行并兼容 Tab', () => {
    expect(run(make('first\n\tsecond', 9), indentCode(true)).doc.textContent).toBe('first\nsecond');
  });
  it('换行继承当前行的缩进，连续 Enter 不丢失尾部空行', () => {
    let state = run(make('    value', 9), newlineInCode);
    state = run(state, newlineInCode);
    expect(state.doc.textContent).toBe('    value\n    \n    ');
  });
  it('Home/End 以当前行定位且支持扩展选区', () => {
    const state = make('one\ntwo\nthree', 5);
    expect(run(state, moveToCodeLineBoundary(false, false)).selection.from).toBe(5);
    expect(run(state, moveToCodeLineBoundary(true, true)).selection.to).toBe(8);
  });
  it('显式退出保留全部代码和语言', () => {
    const next = run(make('one\n\n', 5), leaveCode);
    expect(next.doc.firstChild?.textContent).toBe('one\n\n');
    expect(next.doc.firstChild?.attrs.language).toBe('python');
    expect(next.selection.$from.parent.type.name).toBe('paragraph');
  });
  it.each([
    [0, ['paragraph', 'code_block'], ['one', 'two\nthree']],
    [5, ['code_block', 'paragraph', 'code_block'], ['one', 'two', 'three']],
    [10, ['code_block', 'paragraph'], ['one\ntwo', 'three']]
  ] as const)('在偏移 %i 切换当前行而不改变其他代码行', (offset, types, texts) => {
    const next = run(make('one\ntwo\nthree', offset), applyTyporaCodeBlockCommand);
    const nodes = Array.from({ length: next.doc.childCount }, (_, i) => next.doc.child(i));
    expect(nodes.map(node => node.type.name)).toEqual(types);
    expect(nodes.map(node => node.textContent)).toEqual(texts);
    for (const node of nodes.filter(node => node.type.name === 'code_block')) expect(node.attrs.language).toBe('python');
    expect(next.selection.$from.parent.type.name).toBe('paragraph');
  });
  it.each(['', 'single', '    '])('单行代码 %j 切换为普通段落并保留原文', text => {
    const next = run(make(text, text.length), applyTyporaCodeBlockCommand);
    expect(next.doc.childCount).toBe(1);
    expect(next.doc.firstChild?.type.name).toBe('paragraph');
    expect(next.doc.textContent).toBe(text);
    expect(next.selection.$from.parentOffset).toBe(text.length);
  });
  it('选区终点位于下一行开头时不转换下一行，并保持反向选区', () => {
    const next = run(make('one\ntwo\nthree', 8, 1), applyTyporaCodeBlockCommand);
    expect(next.doc.child(0).type.name).toBe('paragraph');
    expect(next.doc.child(1).type.name).toBe('paragraph');
    expect(next.doc.child(2).type.name).toBe('code_block');
    expect(next.doc.child(2).textContent).toBe('three');
    expect(next.selection.anchor).toBeGreaterThan(next.selection.head);
  });
  it('保留当前空行上下的代码空行', () => {
    const next = run(make('\n\n', 1), applyTyporaCodeBlockCommand);
    expect(next.doc.childCount).toBe(3);
    expect(next.doc.child(0).type.name).toBe('code_block');
    expect(next.doc.child(1).type.name).toBe('paragraph');
    expect(next.doc.child(2).type.name).toBe('code_block');
  });
  it.each(['```c++', '~~~c#', '```Objective-C', '````python'])('Enter 识别围栏 %s', fence => {
    const next = run(make(fence, fence.length, fence.length, 'paragraph'), createCodeFromFence);
    expect(next.doc.firstChild?.type.name).toBe('code_block');
    expect(next.doc.textContent).toBe('');
  });
});
