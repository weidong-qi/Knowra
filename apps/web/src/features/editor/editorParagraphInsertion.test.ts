import { Schema, type Node as ProseNode } from '@milkdown/kit/prose/model';
import { EditorState, NodeSelection, TextSelection, type Selection } from '@milkdown/kit/prose/state';
import { CellSelection, tableEditing, tableNodes } from '@milkdown/kit/prose/tables';
import { history, redo, undo } from '@milkdown/kit/prose/history';
import { describe, expect, it } from 'vitest';
import { insertParagraphOutsideBlock } from './editorParagraphInsertion';

// 与 Milkdown GFM 一致：每格恰好一个 paragraph，表头后必须有数据行。
const nodes = tableNodes({ tableGroup: 'block', cellContent: 'paragraph', cellAttributes: { alignment: { default: 'left' } } });
const schema = new Schema({ nodes: {
  doc: { content: 'block+' }, paragraph: { group: 'block', content: 'text*' }, text: {},
  blockquote: { group: 'block', content: 'block+' },
  table_only: { group: 'block', content: 'table' },
  bullet_list: { group: 'block', content: 'list_item+' }, list_item: { content: 'paragraph block*' },
  ...nodes,
  table: { ...nodes.table, content: 'table_header_row table_row+' },
  table_header_row: { ...nodes.table_row, content: 'table_header*' },
  table_row: { ...nodes.table_row, content: 'table_cell*' }
} });
const p = (text = '') => schema.node('paragraph', null, text ? schema.text(text) : undefined);
const row = (header: boolean, values: string[]) => schema.node(header ? 'table_header_row' : 'table_row', null,
  values.map(value => schema.node(header ? 'table_header' : 'table_cell', null, p(value))));
const table = () => schema.node('table', null, [row(true, ['H1', 'H2']), row(false, ['A', 'B']), row(false, ['C', 'D'])]);
function position(doc: ProseNode, text: string) {
  let found = -1;
  doc.descendants((node, offset) => { if (node.isText && node.text === text) found = offset; });
  expect(found).toBeGreaterThan(0);
  return found;
}
function run(doc: ProseNode, selection: Selection, direction: 'above' | 'below') {
  const state = EditorState.create({ doc, selection, plugins: [history(), tableEditing({ allowTableNodeSelection: true })] });
  let next = state;
  expect(insertParagraphOutsideBlock(direction)(state)).toBe(true);
  expect(insertParagraphOutsideBlock(direction)(state, tr => { next = state.apply(tr); })).toBe(true);
  next.doc.check();
  expect(next.selection.$from.parent.type.name).toBe('paragraph');
  expect(next.selection.$from.parent.content.size).toBe(0);
  expect(undo(next, tr => { next = next.apply(tr); })).toBe(true);
  expect(next.doc.eq(doc)).toBe(true);
  expect(next.selection.eq(selection)).toBe(true);
  expect(redo(next, tr => { next = next.apply(tr); })).toBe(true);
  return next;
}

describe.each(['above', 'below'] as const)('整表 %s 插入正文', direction => {
  it.each(['H1', 'H2', 'A', 'B', 'C', 'D'])('光标在 %s 时不拆表、不丢单元格且可撤销重做', value => {
    const original = table();
    const doc = schema.node('doc', null, [p('before'), original, p('after')]);
    const next = run(doc, TextSelection.create(doc, position(doc, value)), direction);
    expect(next.doc.childCount).toBe(4);
    expect(next.doc.child(direction === 'above' ? 2 : 1).eq(original)).toBe(true);
    expect(next.doc.firstChild?.textContent).toBe('before');
    expect(next.doc.lastChild?.textContent).toBe('after');
    expect(next.selection.$from.depth).toBe(1);
  });
  it('支持多格选区和整表节点选区', () => {
    const original = table(); const doc = schema.node('doc', null, original);
    const cellSelection = CellSelection.create(doc, position(doc, 'A') - 2, position(doc, 'D') - 2);
    for (const selection of [cellSelection, NodeSelection.create(doc, 0)]) {
      const next = run(doc, selection, direction);
      expect(next.doc.childCount).toBe(2);
      expect(next.doc.child(direction === 'above' ? 1 : 0).eq(original)).toBe(true);
    }
  });
  it.each(['blockquote', 'list_item'])('保留 %s 内的表格容器', container => {
    const original = table();
    const inner = container === 'blockquote'
      ? schema.node('blockquote', null, original)
      : schema.node('bullet_list', null, schema.node('list_item', null, [p('item'), original]));
    const doc = schema.node('doc', null, inner);
    const next = run(doc, TextSelection.create(doc, position(doc, 'A')), direction);
    expect(next.doc.firstChild?.type.name).toBe(inner.type.name);
    const parent = container === 'blockquote' ? next.doc.firstChild! : next.doc.firstChild!.firstChild!;
    expect(parent.child(direction === 'above' ? parent.childCount - 1 : parent.childCount - 2).eq(original)).toBe(true);
  });
  it('合并格仍在整表外插入而不修改 rowspan/colspan', () => {
    const merged = schema.node('table', null, [
      schema.node('table_header_row', null, schema.node('table_header', { colspan: 2 }, p('merged'))),
      schema.node('table_row', null, [schema.node('table_cell', { rowspan: 2 }, p('span')), schema.node('table_cell', null, p('right'))]),
      schema.node('table_row', null, schema.node('table_cell', null, p('bottom')))
    ]);
    const doc = schema.node('doc', null, merged);
    const next = run(doc, TextSelection.create(doc, position(doc, 'span')), direction);
    expect(next.doc.child(direction === 'above' ? 1 : 0).eq(merged)).toBe(true);
  });
});

it('非表格正文仍在当前段落旁插入，且不改写所选文字', () => {
  const doc = schema.node('doc', null, [p('first'), p('second')]);
  const next = run(doc, TextSelection.create(doc, 2, 4), 'below');
  expect(next.doc.childCount).toBe(3);
  expect(next.doc.textContent).toBe(doc.textContent);
});

it('容器不允许段落时不尝试结构拟合，不派发事务', () => {
  const doc = schema.node('doc', null, schema.node('table_only', null, table()));
  const selection = TextSelection.create(doc, position(doc, 'A'));
  const state = EditorState.create({ doc, selection });
  for (const direction of ['above', 'below'] as const) {
    expect(insertParagraphOutsideBlock(direction)(state, () => { throw new Error('unexpected dispatch'); })).toBe(false);
  }
});
