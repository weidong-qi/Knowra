import { editorViewCtx } from '@milkdown/kit/core';
import { findAncestorOfType } from '../utils/prosemirror-ranges.js';
import { syncTableHandleLabels } from './table-buttons.js';
import { updatePinnedActionAvailability } from './table-pinned-actions.js';
import { findTableCellFromSelection } from './table-selection.js';

export function findCellFromCurrentSelection(controller) {
  return findTableCellFromSelection(controller.root);
}

export function syncPinnedHandleFromSelection(controller) {
  const cell = findCellFromCurrentSelection(controller);
  if (cell instanceof HTMLElement) {
    pinCell(controller, cell);
    return;
  }

  if (controller.openMenuKind && controller.pinnedCell) {
    syncPinnedHandles(controller);
    return;
  }

  const activeElement = document.activeElement;
  if (
    activeElement instanceof Element
    && activeElement.closest('.milkdown-table-block [data-role="row-drag-handle"], .milkdown-table-block [data-role="col-drag-handle"], .milkdown-table-block .button-group')
  ) {
    return;
  }

  if (controller.pinnedCell) {
    clearPinnedTable(controller);
  }
}

export function clearPinnedTable(controller) {
  controller.clearPinnedMenuRecovery();
  controller.clearPointerGrace?.();
  if (controller.pinnedCell?.tableBlock instanceof HTMLElement) {
    const { tableBlock } = controller.pinnedCell;
    tableBlock.dataset.pinned = 'false';
    delete tableBlock.dataset.pinnedMenuVisible;
    tableBlock.querySelectorAll('[data-role="row-drag-handle"], [data-role="col-drag-handle"]').forEach((handle) => {
      if (handle instanceof HTMLElement) {
        handle.dataset.show = 'false';
        const buttonGroup = handle.querySelector('.button-group');
        if (buttonGroup instanceof HTMLElement) {
          buttonGroup.dataset.show = 'false';
        }
      }
    });
  }

  controller.pinnedCell = null;
  controller.openMenuKind = null;
  controller.hoverMenuKind = null;
}

export function pinCell(controller, cell) {
  if (!(cell instanceof HTMLElement) || !controller.host.editor) {
    return;
  }

  const tableBlock = cell.closest('.milkdown-table-block');
  const table = cell.closest('table.children');
  const row = cell.closest('tr');
  if (!(tableBlock instanceof HTMLElement) || !(table instanceof HTMLTableElement) || !(row instanceof HTMLTableRowElement)) {
    return;
  }

  const rows = Array.from(table.rows);
  const rowIndex = rows.indexOf(row);
  const colIndex = Array.from(row.cells).indexOf(cell);
  if (rowIndex < 0 || colIndex < 0) {
    return;
  }

  if (
    controller.pinnedCell?.tableBlock === tableBlock
    && controller.pinnedCell?.rowIndex === rowIndex
    && controller.pinnedCell?.colIndex === colIndex
  ) {
    syncPinnedHandles(controller);
    return;
  }

  const view = controller.host.editor.ctx.get(editorViewCtx);
  const cellPos = view.posAtDOM(cell, 0);
  if (typeof cellPos !== 'number') {
    return;
  }

  const tableMatch = findAncestorOfType(view.state.doc.resolve(cellPos), ['table']);
  if (!tableMatch) {
    return;
  }

  controller.root.querySelectorAll('.milkdown-table-block[data-pinned="true"]').forEach((node) => {
    if (node instanceof HTMLElement) {
      node.dataset.pinned = 'false';
    }
  });

  controller.pinnedCell = {
    tableBlock,
    table,
    rowIndex,
    colIndex,
    tablePos: tableMatch.pos + 1
  };
  tableBlock.dataset.pinned = 'true';
  syncPinnedHandles(controller);
}

export function applyPinnedMenuState(controller) {
  if (!controller.pinnedCell?.tableBlock) {
    return;
  }

  const visibleKind = controller.openMenuKind ?? controller.hoverMenuKind ?? null;
  const rowGroup = controller.pinnedCell.tableBlock.querySelector('[data-role="row-drag-handle"] .button-group');
  const colGroup = controller.pinnedCell.tableBlock.querySelector('[data-role="col-drag-handle"] .button-group');

  if (visibleKind) {
    controller.pinnedCell.tableBlock.dataset.pinnedMenuVisible = visibleKind;
  } else {
    delete controller.pinnedCell.tableBlock.dataset.pinnedMenuVisible;
  }

  if (rowGroup instanceof HTMLElement) {
    rowGroup.dataset.show = visibleKind === 'row' ? 'true' : 'false';
  }
  if (colGroup instanceof HTMLElement) {
    colGroup.dataset.show = visibleKind === 'col' ? 'true' : 'false';
  }
}

export function tryRebindPinnedCell(controller) {
  const reboundCell = findCellFromCurrentSelection(controller);
  if (!(reboundCell instanceof HTMLElement)) {
    return false;
  }

  pinCell(controller, reboundCell);
  return true;
}

export function syncPinnedHandles(controller) {
  if (!controller.pinnedCell) {
    return;
  }

  const { tableBlock, table } = controller.pinnedCell;
  if (!(tableBlock instanceof HTMLElement) || !(table instanceof HTMLTableElement) || !tableBlock.isConnected || !table.isConnected) {
    if (tryRebindPinnedCell(controller)) {
      return;
    }
    clearPinnedTable(controller);
    return;
  }

  const rows = Array.from(table.rows);
  if (!rows.length) {
    if (tryRebindPinnedCell(controller)) {
      return;
    }
    clearPinnedTable(controller);
    return;
  }

  controller.pinnedCell.rowIndex = Math.min(controller.pinnedCell.rowIndex, rows.length - 1);
  const row = rows[controller.pinnedCell.rowIndex];
  const cells = Array.from(row.cells);
  if (!cells.length) {
    clearPinnedTable(controller);
    return;
  }

  controller.pinnedCell.colIndex = Math.min(controller.pinnedCell.colIndex, cells.length - 1);
  const cell = cells[controller.pinnedCell.colIndex];
  const colHeaderCell = rows[0]?.cells?.[controller.pinnedCell.colIndex] ?? cell;

  const rowHandle = tableBlock.querySelector('[data-role="row-drag-handle"]');
  const colHandle = tableBlock.querySelector('[data-role="col-drag-handle"]');
  const xLineHandle = tableBlock.querySelector('[data-role="x-line-drag-handle"]');
  const yLineHandle = tableBlock.querySelector('[data-role="y-line-drag-handle"]');

  if (!(rowHandle instanceof HTMLElement) || !(colHandle instanceof HTMLElement)) {
    if (tryRebindPinnedCell(controller)) {
      return;
    }
    clearPinnedTable(controller);
    return;
  }

  syncTableHandleLabels(controller.root, controller.host);

  const blockRect = tableBlock.getBoundingClientRect();
  const tableRect = table.getBoundingClientRect();
  const rowCellRect = cell.getBoundingClientRect();
  const colCellRect = colHeaderCell.getBoundingClientRect();

  rowHandle.dataset.show = 'true';
  colHandle.dataset.show = 'true';
  if (xLineHandle instanceof HTMLElement) {
    xLineHandle.dataset.show = 'false';
  }
  if (yLineHandle instanceof HTMLElement) {
    yLineHandle.dataset.show = 'false';
  }

  const rowWidth = rowHandle.getBoundingClientRect().width || 28;
  const rowHeight = rowHandle.getBoundingClientRect().height || 28;
  const colWidth = colHandle.getBoundingClientRect().width || 28;
  const colHeight = colHandle.getBoundingClientRect().height || 28;

  rowHandle.style.left = `${Math.round(tableRect.left - blockRect.left - rowWidth / 2 - 8)}px`;
  rowHandle.style.top = `${Math.round(rowCellRect.top - blockRect.top + rowCellRect.height / 2 - rowHeight / 2)}px`;
  colHandle.style.left = `${Math.round(colCellRect.left - blockRect.left + colCellRect.width / 2 - colWidth / 2)}px`;
  colHandle.style.top = `${Math.round(tableRect.top - blockRect.top - colHeight / 2 - 8)}px`;
  updatePinnedActionAvailability(controller.pinnedCell);
  applyPinnedMenuState(controller);
}
