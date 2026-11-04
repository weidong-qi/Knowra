import type { EditorView } from '@milkdown/kit/prose/view';
import { getTableControlsState } from './editorTableModel';

export interface Box { left: number; top: number; right: number; bottom: number }
export interface TableHandleLayout {
  element: HTMLTableElement;
  boundaryElement: HTMLElement | undefined;
  size: number;
  table: Box;
  rows: Box[];
  columns: Box[];
  row: number;
  column: number;
  rowCount: number;
  columnCount: number;
  /** 手柄允许出现的垂直范围：工作区内且不被吸顶格式栏遮住。 */
  clip: { top: number; bottom: number };
}

const box = (element: Element): Box => {
  const { left, top, right, bottom } = element.getBoundingClientRect();
  return { left, top, right, bottom };
};
export const tableHandleSize = () => (typeof window.matchMedia === 'function' ? window.matchMedia('(max-width: 767px), (any-pointer: coarse)').matches : window.innerWidth <= 767) ? 44 : 24;

export function placeTableHandle(left: number, top: number, size: number, viewportWidth = window.innerWidth) {
  return { left: Math.min(Math.max(left, 4), Math.max(4, viewportWidth - size - 4)), top: Math.max(4, top) };
}

/** 菜单与手柄都避开可见格式栏，尚未吸顶时也不能上翻盖住它。 */
export function tableHandleClip(stage: Pick<DOMRect, 'top' | 'bottom'> | undefined, toolbar: Pick<DOMRect, 'bottom'> | undefined, viewportHeight: number) {
  return { top: Math.max(stage?.top ?? 0, toolbar?.bottom ?? 0), bottom: Math.min(stage?.bottom ?? viewportHeight, viewportHeight) };
}

/** 只读 DOM 几何：行列边界来自真实渲染，手柄不占文档布局。 */
export function readTableHandleLayout(view: EditorView, hover: Element | null): TableHandleLayout | null {
  const state = view.state;
  let cell: Element | null = hover && view.dom.contains(hover) ? hover.closest('td, th') : null;
  if (!cell) {
    if (!getTableControlsState(state)) return null;
    const { $from } = state.selection;
    const dom = view.domAtPos($from.pos).node;
    cell = (dom instanceof Element ? dom : dom.parentElement)?.closest('td, th') ?? null;
  }
  const table = cell?.closest('table');
  if (!cell || !table || !view.dom.contains(table)) return null;
  const rows = Array.from(table.rows);
  const first = rows[0];
  if (!first) return null;
  const row = (cell.parentElement as HTMLTableRowElement).rowIndex;
  const boundaryElement = view.dom.closest<HTMLElement>('[data-editor-scroll-root]') ?? undefined;
  const stage = boundaryElement?.getBoundingClientRect();
  const stack = view.dom.closest('[data-editor-workspace]')?.querySelector('[data-editor-toolbar-stack]')?.getBoundingClientRect();
  const clip = tableHandleClip(stage, stack, window.innerHeight);
  return { element: table, boundaryElement, size: tableHandleSize(), table: box(table), rows: rows.map(box), columns: Array.from(first.cells).map(box),
    row, column: (cell as HTMLTableCellElement).cellIndex, rowCount: rows.length, columnCount: first.cells.length, clip };
}
