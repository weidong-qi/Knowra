import { closeHistory } from '@milkdown/kit/prose/history';
import { Fragment, type Node } from '@milkdown/kit/prose/model';
import type { EditorState, Command } from '@milkdown/kit/prose/state';
import { CellSelection, TableMap, addColumnBefore, addColumnAfter, deleteColumn, deleteRow, deleteTable, isInTable, selectedRect } from '@milkdown/kit/prose/tables';

export type TableAction = 'row-before' | 'row-after' | 'column-before' | 'column-after' | 'delete-row' | 'delete-column' | 'delete-table' | 'select-row' | 'select-column' | 'select-table' | 'align-left' | 'align-center' | 'align-right';
export interface TableControlsState {
  rows: number;
  columns: number;
  row: number;
  column: number;
  canDeleteRow: boolean;
  canDeleteColumn: boolean;
}

export function getTableControlsState(state: EditorState): TableControlsState | null {
  if (!isInTable(state)) return null;
  const { map, top, bottom, left, right } = selectedRect(state);
  return { rows: map.height, columns: map.width, row: top, column: left,
    canDeleteRow: top > 0 && map.height - (bottom - top) >= 2,
    canDeleteColumn: map.width > right - left };
}

export const TABLE_MAX_ROWS = 8;
export const TABLE_MAX_COLUMNS = 8;
export const TABLE_DEFAULT_SIZE = { row: 3, col: 3 } as const;

/** 插入表格的行列数（含表头行）限制在 2..TABLE_MAX_ROWS / 1..TABLE_MAX_COLUMNS。 */
export function clampTableSize(row: number, col: number) {
  const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, Math.trunc(Number.isFinite(value) ? value : min)));
  return { row: clamp(row, 2, TABLE_MAX_ROWS), col: clamp(col, 1, TABLE_MAX_COLUMNS) };
}

function moved<T>(items: T[], from: number, to: number): T[] {
  const next = items.slice();
  next.splice(to, 0, ...next.splice(from, 1));
  return next;
}

/** Markdown 行列移动只接受规则矩阵；合并单元格不能拆散后重新配对数据。 */
function isRegularTable(table: Node, map: TableMap) {
  let regular = !map.problems?.length;
  table.forEach(row => {
    if (row.childCount !== map.width) regular = false;
    row.forEach(cell => { if (cell.attrs.colspan !== 1 || cell.attrs.rowspan !== 1) regular = false; });
  });
  return regular;
}

/** 把数据行从 from 移到 to（均为行下标，表头行 0 固定）。选区落在移动后的整行。 */
export function moveTableRow(from: number, to: number): Command {
  return (state, dispatch) => {
    if (!isInTable(state)) return false;
    const rect = selectedRect(state);
    const { table, map, tableStart } = rect;
    if (!Number.isInteger(from) || !Number.isInteger(to) || !isRegularTable(table, map) || from === to || from < 1 || to < 1 || from >= map.height || to >= map.height) return false;
    const rows: Node[] = [];
    table.forEach(row => rows.push(row));
    if (rows.length !== map.height) return false;
    const next = table.copy(Fragment.from(moved(rows, from, to)));
    if (dispatch) {
      const tr = state.tr.replaceWith(tableStart - 1, tableStart - 1 + table.nodeSize, next);
      const nextMap = TableMap.get(next);
      const cell = (column: number) => tr.doc.resolve(tableStart + nextMap.map[to * nextMap.width + column]);
      tr.setSelection(CellSelection.rowSelection(cell(0), cell(nextMap.width - 1)));
      dispatch(closeHistory(tr.scrollIntoView()));
    }
    return true;
  };
}

/** 把整列从 from 移到 to；对齐属性随单元格一起移动。选区落在移动后的整列。 */
export function moveTableColumn(from: number, to: number): Command {
  return (state, dispatch) => {
    if (!isInTable(state)) return false;
    const rect = selectedRect(state);
    const { table, map, tableStart } = rect;
    if (!Number.isInteger(from) || !Number.isInteger(to) || !isRegularTable(table, map) || from === to || from < 0 || to < 0 || from >= map.width || to >= map.width) return false;
    const rows: Node[] = [];
    let regular = true;
    table.forEach(row => {
      if (row.childCount !== map.width) regular = false;
      const cells: Node[] = [];
      row.forEach(cell => cells.push(cell));
      rows.push(row.copy(Fragment.from(moved(cells, from, to))));
    });
    if (!regular) return false; // 含合并单元格的异常表格不做列移动。
    const next = table.copy(Fragment.from(rows));
    if (dispatch) {
      const tr = state.tr.replaceWith(tableStart - 1, tableStart - 1 + table.nodeSize, next);
      const nextMap = TableMap.get(next);
      const cell = (row: number) => tr.doc.resolve(tableStart + nextMap.map[row * nextMap.width + to]);
      tr.setSelection(CellSelection.colSelection(cell(0), cell(nextMap.height - 1)));
      dispatch(closeHistory(tr.scrollIntoView()));
    }
    return true;
  };
}

export function tableControlCommand(action: TableAction): Command {
  return (state, dispatch) => {
    const controls = getTableControlsState(state);
    if (!controls) return false;
    const rect = selectedRect(state);
    const commit: typeof dispatch = dispatch ? tr => dispatch(closeHistory(tr)) : undefined;
    if (action === 'column-before') return addColumnBefore(state, commit);
    if (action === 'column-after') return addColumnAfter(state, commit);
    if (action === 'delete-row') return controls.canDeleteRow && deleteRow(state, commit);
    if (action === 'delete-column') return controls.canDeleteColumn && deleteColumn(state, commit);
    if (action === 'delete-table') return deleteTable(state, commit);
    if (action === 'row-before' || action === 'row-after') {
      const row = action === 'row-before' ? rect.top : rect.bottom;
      if (row === 0) return false; // Markdown 保留唯一表头，不能在表头前插入数据行。
      const cells = Array.from({ length: rect.map.width }, (_, column) => {
        const header = rect.table.nodeAt(rect.map.map[column]);
        return state.schema.nodes.table_cell.createAndFill({ alignment: header?.attrs.alignment })!;
      });
      let offset = rect.tableStart;
      for (let index = 0; index < row; index++) offset += rect.table.child(index).nodeSize;
      commit?.(state.tr.insert(offset, state.schema.nodes.table_row.create(null, cells)).scrollIntoView());
      return true;
    }
    if (action.startsWith('align-')) {
      const alignment = action.slice('align-'.length);
      const tr = state.tr;
      for (let row = 0; row < rect.map.height; row++) {
        for (let column = rect.left; column < rect.right; column++) {
          const pos = rect.tableStart + rect.map.map[row * rect.map.width + column];
          const cell = tr.doc.nodeAt(pos)!;
          tr.setNodeMarkup(pos, null, { ...cell.attrs, alignment });
        }
      }
      commit?.(tr.scrollIntoView());
      return true;
    }
    const { map, tableStart } = rect;
    const cell = (row: number, column: number) => state.doc.resolve(tableStart + map.map[row * map.width + column]);
    const selection = action === 'select-row'
      ? CellSelection.rowSelection(cell(rect.top, 0), cell(rect.bottom - 1, map.width - 1))
      : action === 'select-column'
        ? CellSelection.colSelection(cell(0, rect.left), cell(map.height - 1, rect.right - 1))
        : new CellSelection(cell(0, 0), cell(map.height - 1, map.width - 1));
    dispatch?.(state.tr.setSelection(selection).setMeta('addToHistory', false));
    return true;
  };
}
