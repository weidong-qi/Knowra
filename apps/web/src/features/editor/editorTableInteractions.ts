import { TextSelection, type EditorState } from '@milkdown/kit/prose/state';
import type { EditorView } from '@milkdown/kit/prose/view';
import { moveTableColumn, moveTableRow } from './editorTableModel';
import { findTableAtDom, getTableColumnWidths, normalizeRatios, resizeColumns, setTableColumnWidths, tableFingerprint } from './editorTableColumnWidths';

export interface TableActionContext { view: EditorView; state: EditorState }
export function isCurrentTableContext(getView: () => EditorView | null, context: TableActionContext, selection = true) {
  const view = getView();
  return view === context.view && !view.isDestroyed && view.editable && view.state.doc.eq(context.state.doc)
    && (!selection || view.state.selection.eq(context.state.selection));
}
export function focusTableCell(view: EditorView, table: HTMLTableElement, row: number, column: number) {
  if (!view.dom.contains(table)) return false;
  const cell = table.rows[row]?.cells[column];
  if (!cell) return false;
  view.dispatch(view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(view.posAtDOM(cell, 0)), 1)).setMeta('addToHistory', false));
  return true;
}

interface PointerSession {
  move(event: PointerEvent): void;
  end(commit: boolean): void;
}
/** 一次手势只接受起始指针；取消、失焦和 Escape 均释放全局监听。 */
export function trackTablePointer(pointerId: number, session: PointerSession) {
  let done = false;
  const move = (event: PointerEvent) => { if (event.pointerId === pointerId) session.move(event); };
  const end = (commit: boolean) => {
    if (done) return;
    done = true;
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    window.removeEventListener('pointercancel', cancel);
    window.removeEventListener('blur', blur);
    window.removeEventListener('keydown', key);
    session.end(commit);
  };
  const up = (event: PointerEvent) => { if (event.pointerId === pointerId) end(true); };
  const cancel = (event: PointerEvent) => { if (event.pointerId === pointerId) end(false); };
  const blur = () => end(false);
  const key = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); end(false); } };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
  window.addEventListener('pointercancel', cancel);
  window.addEventListener('blur', blur);
  window.addEventListener('keydown', key);
  return () => end(false);
}

export interface TableDrag { kind: 'row' | 'column'; from: number; target: number }
interface DragOptions {
  getView(): EditorView | null;
  table: HTMLTableElement;
  kind: TableDrag['kind'];
  from: number;
  onDrag(drag: TableDrag | null): void;
  onEnd(active: boolean, view: EditorView | null): void;
}
const DRAG_THRESHOLD = 4;
export function startTableDrag(event: PointerEvent, options: DragOptions): (() => void) | null {
  const { getView, table, kind, from, onDrag, onEnd } = options;
  const view = getView();
  if (event.button !== 0 || !view || !view.editable || view.isDestroyed || (kind === 'row' && from === 0)) return null;
  const context = { view, state: view.state };
  const cells = Array.from(table.rows[0]?.cells ?? []);
  const items = kind === 'row' ? Array.from(table.rows) : cells;
  let active = false;
  let target = from;
  return trackTablePointer(event.pointerId, {
    move(e) {
      if (!isCurrentTableContext(getView, context, false) || !view.dom.contains(table)) { onDrag(null); return; }
      if (!active && Math.hypot(e.clientX - event.clientX, e.clientY - event.clientY) < DRAG_THRESHOLD) return;
      active = true;
      const pointer = kind === 'row' ? e.clientY : e.clientX;
      let index = items.findIndex(item => pointer < (kind === 'row' ? item.getBoundingClientRect().bottom : item.getBoundingClientRect().right));
      if (index < 0) index = items.length - 1;
      target = Math.max(kind === 'row' ? 1 : 0, Math.min(index, items.length - 1));
      onDrag({ kind, from, target });
    },
    end(commit) {
      onDrag(null);
      const valid = commit && active && target !== from && isCurrentTableContext(getView, context, false);
      // 始终使用起始表 DOM；跨过另一张表也不能把它当作移动目标。
      if (valid && focusTableCell(view, table, kind === 'row' ? from : 0, kind === 'column' ? from : 0)) {
        (kind === 'row' ? moveTableRow(from, target) : moveTableColumn(from, target))(view.state, view.dispatch);
        onEnd(active, view);
      } else onEnd(active, null);
    }
  });
}

interface ResizeOptions { getView(): EditorView | null; table: HTMLTableElement; index: number; onEnd(): void }
export function startTableResize(event: PointerEvent, { getView, table, index, onEnd }: ResizeOptions): (() => void) | null {
  const view = getView();
  const found = view && !view.isDestroyed && view.editable && findTableAtDom(view, table);
  if (event.button !== 0 || !view || !found) return null;
  event.preventDefault();
  const context = { view, state: view.state };
  const fingerprint = tableFingerprint(found.node);
  const tablePos = found.pos;
  const before = getTableColumnWidths(view, tablePos);
  const tablePx = table.getBoundingClientRect().width;
  const start = normalizeRatios(Array.from(table.rows[0].cells, cell => cell.getBoundingClientRect().width), tablePx);
  let latest = start;
  let changed = false;
  return trackTablePointer(event.pointerId, {
    move(e) {
      if (!isCurrentTableContext(getView, context, false)) return;
      changed = true;
      latest = resizeColumns(start, index, e.clientX - event.clientX, tablePx);
      setTableColumnWidths(view, { tablePos, fingerprint, ratios: latest, commit: false });
    },
    end(commit) {
      if (!view.isDestroyed && changed) {
        const valid = commit && isCurrentTableContext(getView, context, false);
        const currentTable = view.dom.contains(table) ? findTableAtDom(view, table) : null;
        if (currentTable && tableFingerprint(currentTable.node) === fingerprint) {
          setTableColumnWidths(view, { tablePos: currentTable.pos, fingerprint, ratios: valid ? latest : before, commit: valid });
        }
      }
      onEnd();
    }
  });
}
