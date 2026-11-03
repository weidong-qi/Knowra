import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type RefObject } from 'react';
import type { EditorState } from '@milkdown/kit/prose/state';
import type { EditorView } from '@milkdown/kit/prose/view';
import { IconButton } from '../../components/ui';
import { getTableControlsState, moveTableColumn, moveTableRow, tableControlCommand, type TableAction } from './editorTableModel';
import { TABLE_CONTEXT_EVENT } from './editorTableBehavior';
import { findTableAtDom, normalizeRatios, resizeColumns, setTableColumnWidths, tableFingerprint } from './editorTableColumnWidths';
import { readTableHandleLayout, placeTableHandle, type TableHandleLayout } from './editorTableHandleLayout';
import { focusTableCell, isCurrentTableContext, startTableDrag, startTableResize, type TableDrag } from './editorTableInteractions';
import { EditorTableHandleMenu } from './EditorTableHandleMenu';
import styles from './EditorTableHandles.module.css';

type HandleKind = 'row' | 'column' | 'table';
interface MenuState { kind: HandleKind; point: { x: number; y: number }; view: EditorView; state: EditorState; layout: TableHandleLayout }
const near = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

const Grip = () => <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" fill="currentColor"><circle cx="4" cy="3" r="1" /><circle cx="8" cy="3" r="1" /><circle cx="4" cy="6" r="1" /><circle cx="8" cy="6" r="1" /><circle cx="4" cy="9" r="1" /><circle cx="8" cy="9" r="1" /></svg>;
const Plus = () => <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><path d="M6 2v8M2 6h8" /></svg>;

export function EditorTableHandles({ hostRef, getView }: { hostRef: RefObject<HTMLDivElement | null>; getView(): EditorView | null }) {
  const [layout, setLayout] = useState<TableHandleLayout | null>(null);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [drag, setDrag] = useState<TableDrag | null>(null);
  const hover = useRef<Element | null>(null);
  const layoutRef = useRef<TableHandleLayout | null>(null);
  const cancelDrag = useRef<(() => void) | null>(null);
  const suppressPress = useRef(false);
  const menuRef = useRef<MenuState | null>(null);
  menuRef.current = menu;
  const refresh = useRef<() => void>(() => {});

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let frame = 0;
    const update = () => {
      const view = getView();
      let next: TableHandleLayout | null = null;
      if (view && !view.isDestroyed && view.editable) {
        next = readTableHandleLayout(view, hover.current);
        const stage = view.dom.closest('[data-editor-scroll-root]')?.getBoundingClientRect();
        // 表格完全滚出可视工作区时不显示手柄。
        if (next && stage && (next.table.bottom < stage.top || next.table.top > stage.bottom)) next = null;
      }
      const geometry = (value: TableHandleLayout | null) => value && ({ ...value, element: undefined, boundaryElement: undefined });
      const same = layoutRef.current?.element === next?.element && JSON.stringify(geometry(layoutRef.current)) === JSON.stringify(geometry(next));
      layoutRef.current = next;
      if (!same) setLayout(next);
    };
    const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(update); };
    refresh.current = update;
    const onPointerMove = (event: globalThis.PointerEvent) => {
      if (event.pointerType === 'touch' || cancelDrag.current || menuRef.current) return;
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest('[data-table-handles]')) return;
      const cell = target && host.contains(target) ? target.closest('td, th') : null;
      if (!cell && layoutRef.current) {
        const { table, size } = layoutRef.current;
        // 跨过单元格与外侧手柄之间的间隙仍属于同一交互区域。
        if (event.clientX >= table.left - size - 4 && event.clientX <= table.right + size + 4
          && event.clientY >= table.top - size - 4 && event.clientY <= table.bottom + size + 4) return;
      }
      if (cell === hover.current) return;
      hover.current = cell;
      schedule();
    };
    document.addEventListener('pointermove', onPointerMove);
    document.addEventListener('selectionchange', schedule);
    host.addEventListener(TABLE_CONTEXT_EVENT, schedule);
    host.addEventListener('keyup', schedule);
    host.addEventListener('pointerup', schedule);
    window.addEventListener('scroll', schedule, true);
    window.addEventListener('resize', schedule);
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedule);
    observer?.observe(host);
    update();
    return () => {
      cancelAnimationFrame(frame);
      cancelDrag.current?.();
      observer?.disconnect();
      document.removeEventListener('pointermove', onPointerMove);
      document.removeEventListener('selectionchange', schedule);
      host.removeEventListener(TABLE_CONTEXT_EVENT, schedule);
      host.removeEventListener('keyup', schedule);
      host.removeEventListener('pointerup', schedule);
      window.removeEventListener('scroll', schedule, true);
      window.removeEventListener('resize', schedule);
    };
  }, [hostRef, getView]);

  const liveView = () => {
    const view = getView();
    return view && !view.isDestroyed && view.editable ? view : null;
  };
  const restoreFocus = (view: EditorView) => {
    const focused = document.activeElement;
    requestAnimationFrame(() => {
      const now = document.activeElement;
      if (now !== focused && now !== document.body && now && !view.dom.contains(now) && !now.closest('[data-table-handles]')) return;
      if (getView() === view && !view.isDestroyed && view.editable) view.focus();
      refresh.current();
    });
  };

  const openMenu = (kind: HandleKind, anchor: Element) => {
    const view = liveView();
    const current = layoutRef.current;
    if (!view || !current) return;
    if (!focusTableCell(view, current.element, kind === 'row' ? current.row : 0, kind === 'column' ? current.column : 0)) return;
    if (kind !== 'table') tableControlCommand(kind === 'row' ? 'select-row' : 'select-column')(view.state, view.dispatch);
    else tableControlCommand('select-table')(view.state, view.dispatch);
    const rect = anchor.getBoundingClientRect();
    setMenu({ kind, point: { x: rect.left, y: rect.bottom + 4 }, view, state: view.state, layout: current });
  };
  const runAction = (action: TableAction | 'move-up' | 'move-down' | 'move-left' | 'move-right') => {
    const view = liveView();
    const current = layoutRef.current;
    setMenu(null);
    if (!view || !current || !menu || !isCurrentTableContext(getView, menu)) return;
    const state = getTableControlsState(view.state);
    if (!state) return;
    if (action === 'move-up') moveTableRow(state.row, state.row - 1)(view.state, view.dispatch);
    else if (action === 'move-down') moveTableRow(state.row, state.row + 1)(view.state, view.dispatch);
    else if (action === 'move-left') moveTableColumn(state.column, state.column - 1)(view.state, view.dispatch);
    else if (action === 'move-right') moveTableColumn(state.column, state.column + 1)(view.state, view.dispatch);
    else tableControlCommand(action)(view.state, view.dispatch);
    restoreFocus(view);
  };
  const quickInsert = (action: 'row-after' | 'column-after') => {
    const view = liveView();
    const current = layoutRef.current;
    if (!view || !current) return;
    const ok = action === 'row-after' ? focusTableCell(view, current.element, current.rowCount - 1, 0) : focusTableCell(view, current.element, 0, current.columnCount - 1);
    if (ok) tableControlCommand(action)(view.state, view.dispatch);
    restoreFocus(view);
  };

  const startDrag = (kind: 'row' | 'column') => (event: PointerEvent) => {
    const current = layoutRef.current;
    if (!current) return;
    cancelDrag.current?.();
    cancelDrag.current = startTableDrag(event.nativeEvent, {
      getView, table: current.element, kind, from: kind === 'row' ? current.row : current.column,
      onDrag: setDrag,
      onEnd: (active, view) => {
        cancelDrag.current = null;
        if (active) { suppressPress.current = true; setTimeout(() => { suppressPress.current = false; }, 0); }
        if (view) restoreFocus(view);
        refresh.current();
      }
    });
  };
  const startResize = (index: number) => (event: PointerEvent) => {
    const current = layoutRef.current;
    if (!current) return;
    cancelDrag.current?.();
    cancelDrag.current = startTableResize(event.nativeEvent, { getView, table: current.element, index,
      onEnd: () => { cancelDrag.current = null; refresh.current(); } });
  };
  const tableElement = (view: EditorView) => {
    const element = layoutRef.current?.element;
    return element && view.dom.contains(element) ? element : null;
  };
  const resizeByKey = (index: number) => (event: KeyboardEvent) => {
    const step = event.key === 'ArrowLeft' ? -16 : event.key === 'ArrowRight' ? 16 : 0;
    const current = layoutRef.current;
    const view = liveView();
    const element = view && tableElement(view);
    const found = view && element && findTableAtDom(view, element);
    if (!step || !current || !view || !found) return;
    event.preventDefault();
    const tablePx = current.table.right - current.table.left;
    const ratios = resizeColumns(normalizeRatios(current.columns.map(item => item.right - item.left), tablePx), index, step, tablePx);
    setTableColumnWidths(view, { tablePos: found.pos, fingerprint: tableFingerprint(found.node), ratios, commit: true });
    refresh.current();
  };
  const resetWidths = () => {
    const view = liveView();
    const element = view && tableElement(view);
    const found = view && element && findTableAtDom(view, element);
    if (!view || !found) return;
    setTableColumnWidths(view, { tablePos: found.pos, fingerprint: tableFingerprint(found.node), ratios: null, commit: true });
    refresh.current();
  };

  if (!layout) return null;
  const { table } = layout;
  const rowBox = layout.rows[layout.row];
  const columnBox = layout.columns[layout.column];
  const size = layout.size;
  const inView = (top: number) => top >= layout.clip.top && top + size <= layout.clip.bottom;
  const place = (left: number, top: number) => placeTableHandle(left, top, size);
  const line = drag && (() => {
    const boxes = drag.kind === 'row' ? layout.rows : layout.columns;
    const item = boxes[drag.target];
    if (!item) return null;
    const after = drag.target > drag.from;
    return drag.kind === 'row'
      ? { left: table.left, top: after ? item.bottom : item.top, width: table.right - table.left, height: 2 }
      : { left: after ? item.right : item.left, top: table.top, width: 2, height: table.bottom - table.top };
  })();

  return <div className={styles.layer} data-table-handles="true" data-pdf-exclude="true">
    {inView(table.top - size - 2) ? <div className={styles.handle} data-kind="table" style={place(table.left - size - 2, table.top - size - 2)}>
      <IconButton aria-label="表格整体操作" size={24} onPress={e => { if (!suppressPress.current) openMenu('table', e.target as Element); }}><Grip /></IconButton>
    </div> : null}
    {rowBox && inView((rowBox.top + rowBox.bottom) / 2 - size / 2) ? <div className={styles.handle} data-kind="row" style={place(table.left - size - 2, (rowBox.top + rowBox.bottom) / 2 - size / 2)} onPointerDownCapture={startDrag('row')}>
      <IconButton aria-label={`第 ${layout.row + 1} 行操作`} size={24} onPress={e => { if (!suppressPress.current) openMenu('row', e.target as Element); }}><Grip /></IconButton>
    </div> : null}
    {columnBox && inView(table.top - size - 2) ? <div className={styles.handle} data-kind="column" style={place((columnBox.left + columnBox.right) / 2 - size / 2, table.top - size - 2)} onPointerDownCapture={startDrag('column')}>
      <IconButton aria-label={`第 ${layout.column + 1} 列操作`} size={24} onPress={e => { if (!suppressPress.current) openMenu('column', e.target as Element); }}><Grip /></IconButton>
    </div> : null}
    {inView(table.bottom + 2) ? <div className={styles.handle} data-kind="add-row" style={place(table.left - size - 2, table.bottom + 2)}>
      <IconButton aria-label="在表格末尾添加行" size={24} onPress={() => quickInsert('row-after')}><Plus /></IconButton>
    </div> : null}
    {inView(Math.min(Math.max((table.top + table.bottom) / 2, layout.clip.top + size), layout.clip.bottom - size * 2) - size / 2) ? <div className={styles.handle} data-kind="add-column"
      style={place(table.right + 2, Math.min(Math.max((table.top + table.bottom) / 2, layout.clip.top + size), layout.clip.bottom - size * 2) - size / 2)}>
      <IconButton aria-label="在表格末尾添加列" size={24} onPress={() => quickInsert('column-after')}><Plus /></IconButton>
    </div> : null}
    {layout.columnCount > 1 ? layout.columns.slice(0, -1).map((item, index) => {
      const top = Math.max(table.top, layout.clip.top);
      const bottom = Math.min(table.bottom, layout.clip.bottom);
      return bottom - top > 8 ? <div key={index} className={styles.resizer} role="separator" aria-orientation="vertical" aria-label={`调整第 ${index + 1} 列宽度`} tabIndex={0}
        style={{ left: item.right - 3, top, height: bottom - top }}
        onPointerDown={startResize(index)} onDoubleClick={resetWidths} onKeyDown={resizeByKey(index)} /> : null;
    }) : null}
    {line ? <div className={styles.dropLine} style={line} aria-hidden="true" /> : null}
    <EditorTableHandleMenu menu={menu} layout={layout} close={() => setMenu(null)} runAction={runAction} />
  </div>;
}
