import { history, undo, redo } from '@milkdown/kit/prose/history';
import { describe, expect, it } from 'vitest';
import { Schema } from '@milkdown/kit/prose/model';
import { EditorState, TextSelection } from '@milkdown/kit/prose/state';
import { tableNodes, CellSelection } from '@milkdown/kit/prose/tables';
import { TABLE_MAX_COLUMNS, TABLE_MAX_ROWS, clampTableSize, getTableControlsState, moveTableColumn, moveTableRow, tableControlCommand } from './editorTableModel';

const nodes = tableNodes({ tableGroup: 'block', cellContent: 'paragraph', cellAttributes: { alignment: { default: 'left' } } });
const schema = new Schema({ nodes: {
  doc: { content: 'block+' }, paragraph: { group: 'block', content: 'text*' }, text: {},
  ...nodes,
  table: { ...nodes.table, content: 'table_header_row table_row+' },
  table_header_row: { ...nodes.table_row, content: 'table_header+' },
  table_row: { ...nodes.table_row, content: 'table_cell+' }
} });
function fixture() {
  const p = (text: string) => schema.node('paragraph', null, schema.text(text));
  const row = (header: boolean, values: string[]) => schema.node(header ? 'table_header_row' : 'table_row', null, values.map(value => schema.node(header ? 'table_header' : 'table_cell', null, p(value))));
  const table = schema.node('table', null, [row(true, ['名称', '数量']), row(false, ['苹果', '2']), row(false, ['梨', '3'])]);
  const doc = schema.node('doc', null, [schema.node('paragraph', null, schema.text('之前')), table, schema.node('paragraph', null, schema.text('之后'))]);
  let pos = 0;
  doc.descendants((node, offset) => { if (node.isText && node.text === '苹果') pos = offset; });
  return EditorState.create({ doc, selection: TextSelection.create(doc, pos), plugins: [history()] });
}
function apply(state: EditorState, action: Parameters<typeof tableControlCommand>[0]) {
  let next = state;
  expect(tableControlCommand(action)(state, tr => { next = state.apply(tr); })).toBe(true);
  next.doc.check();
  return next;
}
describe('Markdown 表格控制', () => {
  it('插入行列保留正文、表头和数据并继承列对齐', () => {
    let state = apply(fixture(), 'align-center');
    state = apply(state, 'row-before');
    state = apply(state, 'column-after');
    const table = state.doc.child(1);
    expect(table.childCount).toBe(4);
    expect(table.firstChild?.type.name).toBe('table_header_row');
    expect(table.firstChild?.childCount).toBe(3);
    expect(table.child(1).child(0).attrs.alignment).toBe('center');
    expect(state.doc.textContent).toContain('苹果');
    expect(state.doc.firstChild?.textContent).toBe('之前');
    expect(state.doc.lastChild?.textContent).toBe('之后');
  });
  it('列对齐写到表头及同列所有数据，保证 Markdown 序列化可保留', () => {
    const state = apply(fixture(), 'align-right');
    state.doc.child(1).forEach(row => {
      expect(row.child(0).attrs.alignment).toBe('right');
      expect(row.child(1).attrs.alignment).toBe('left');
    });
  });
  it('行列和整表选择保留 CellSelection', () => {
    for (const action of ['select-row', 'select-column', 'select-table'] as const) {
      const state = apply(fixture(), action);
      expect(state.selection).toBeInstanceOf(CellSelection);
      if (action === 'select-row') expect((state.selection as CellSelection).isRowSelection()).toBe(true);
      if (action === 'select-column') expect((state.selection as CellSelection).isColSelection()).toBe(true);
    }
  });
  it('不能删除表头、最后数据行或最后一列，整表删除有显式操作', () => {
    let state = apply(fixture(), 'delete-row');
    expect(getTableControlsState(state)?.canDeleteRow).toBe(false);
    expect(tableControlCommand('delete-row')(state)).toBe(false);
    state = apply(state, 'delete-column');
    expect(getTableControlsState(state)?.canDeleteColumn).toBe(false);
    expect(tableControlCommand('delete-column')(state)).toBe(false);
    state = apply(state, 'delete-table');
    expect(state.doc.childCount).toBe(2);
    expect(state.doc.textContent).toBe('之前之后');
  });
  it('表头上方不能插入数据行，非表格选区不执行任何操作', () => {
    let state = fixture();
    let headerPos = 0;
    state.doc.descendants((node, pos) => { if (node.isText && node.text === '名称') headerPos = pos; });
    state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, headerPos)));
    expect(tableControlCommand('row-before')(state)).toBe(false);
    expect(tableControlCommand('delete-row')(state)).toBe(false);
    state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 1)));
    expect(getTableControlsState(state)).toBeNull();
    expect(tableControlCommand('delete-table')(state)).toBe(false);
  });
});

function run(state: EditorState, command: ReturnType<typeof moveTableRow>) {
  let next = state;
  expect(command(state, tr => { next = state.apply(tr); })).toBe(true);
  next.doc.check();
  return next;
}
const rowTexts = (state: EditorState) => { const out: string[] = []; state.doc.child(1).forEach(row => out.push(row.textContent)); return out; };

describe('拖拽移动行列', () => {
  it('数据行移动后保持表头固定并选中移动后的整行，可独立撤销', () => {
    const before = fixture();
    const state = run(before, moveTableRow(1, 2));
    expect(rowTexts(state)).toEqual(['名称数量', '梨3', '苹果2']);
    expect((state.selection as CellSelection).isRowSelection()).toBe(true);
    let undone = state;
    expect(undo(state, tr => { undone = state.apply(tr); })).toBe(true);
    expect(undone.doc.eq(before.doc)).toBe(true);
  });
  it('表头行不能被移动或越过，越界与原位无操作', () => {
    const state = fixture();
    for (const [from, to] of [[0, 1], [1, 0], [1, 1], [1, 3], [2, -1]]) expect(moveTableRow(from, to)(state)).toBe(false);
  });
  it('列移动时对齐随单元格移动，表头与数据同列同步', () => {
    const aligned = apply(fixture(), 'align-right');
    const state = run(aligned, moveTableColumn(0, 1));
    expect(rowTexts(state)).toEqual(['数量名称', '2苹果', '3梨']);
    state.doc.child(1).forEach(row => {
      expect(row.child(0).attrs.alignment).toBe('left');
      expect(row.child(1).attrs.alignment).toBe('right');
    });
    expect((state.selection as CellSelection).isColSelection()).toBe(true);
    expect(moveTableColumn(0, 2)(state)).toBe(false);
  });
  it('非表格选区不执行', () => {
    const base = fixture();
    const state = base.apply(base.tr.setSelection(TextSelection.create(base.doc, 1)));
    expect(moveTableRow(1, 2)(state)).toBe(false);
    expect(moveTableColumn(0, 1)(state)).toBe(false);
  });
  it('插入尺寸被限制在支持范围', () => {
    expect(clampTableSize(1, 0)).toEqual({ row: 2, col: 1 });
    expect(clampTableSize(99, 99)).toEqual({ row: TABLE_MAX_ROWS, col: TABLE_MAX_COLUMNS });
    expect(clampTableSize(Number.NaN, 4)).toEqual({ row: 2, col: 4 });
  });
});

it('连续行列与对齐操作分别撤销重做，单元格选择不清空历史', () => {
  let state = fixture(); const snapshots = [state.doc];
  for (const action of ['row-after', 'column-after', 'align-center'] as const) { state = apply(state, action); snapshots.push(state.doc); }
  state = apply(state, 'select-row');
  for (let index = 2; index >= 0; index--) {
    expect(undo(state, tr => { state = state.apply(tr); })).toBe(true);
    expect(state.doc.eq(snapshots[index])).toBe(true);
  }
  for (let index = 1; index <= 3; index++) {
    expect(redo(state, tr => { state = state.apply(tr); })).toBe(true);
    expect(state.doc.eq(snapshots[index])).toBe(true);
  }
});

it('多行多列选区的快捷插入位于所选范围下方或右侧并保留单元格选择', () => {
  for (const action of ['row-after', 'column-after'] as const) {
    let state = fixture();
    const cells: number[] = [];
    state.doc.descendants((node, pos) => { if (node.type.name === 'table_cell') cells.push(pos); });
    state = state.apply(state.tr.setSelection(CellSelection.create(state.doc, cells[0], cells.at(-1))));
    state = apply(state, action);
    expect(state.selection).toBeInstanceOf(CellSelection);
    const table = state.doc.child(1);
    expect(table.textContent).toContain('苹果2梨3');
    if (action === 'row-after') {
      expect(table.childCount).toBe(4);
      expect(table.lastChild?.textContent).toBe('');
    } else {
      expect(table.firstChild?.childCount).toBe(3);
      table.forEach(row => expect(row.lastChild?.textContent).toBe(''));
    }
  }
});

 it('拒绝合并单元格的行移动，防止跨行数据错列', () => {
  const p = (text: string) => schema.node('paragraph', null, schema.text(text));
  const cell = (text: string, rowspan = 1) => schema.node('table_cell', { rowspan }, p(text));
  const table = schema.node('table', null, [
    schema.node('table_header_row', null, ['A', 'B'].map(text => schema.node('table_header', null, p(text)))),
    schema.node('table_row', null, [cell('a', 2), cell('b')]),
    schema.node('table_row', null, [cell('d')]),
    schema.node('table_row', null, [cell('e'), cell('f')])
  ]);
  const doc = schema.node('doc', null, [table]);
  const state = EditorState.create({ doc, selection: TextSelection.create(doc, 15) });
  expect(moveTableRow(1, 3)(state)).toBe(false);
  expect(moveTableColumn(0, 1)(state)).toBe(false);
});
