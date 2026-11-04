import { selectColCommand, selectRowCommand } from '@milkdown/kit/preset/gfm';
import { callCommand } from '@milkdown/kit/utils';
import { setPinnedActionDisabled, waitForNextFrame } from './table-buttons.js';

export function updatePinnedActionAvailability(pinnedCell) {
  if (!pinnedCell?.tableBlock || !(pinnedCell.table instanceof HTMLTableElement)) {
    return;
  }

  const rowCount = pinnedCell.table.rows.length;
  const rowIndex = pinnedCell.rowIndex;
  const rowGroup = pinnedCell.tableBlock.querySelector('[data-role="row-drag-handle"] .button-group');
  if (rowGroup instanceof HTMLElement) {
    const addRowBeforeButton = rowGroup.querySelector('[data-table-pinned-action="table-add-row-before"]');
    const deleteRowButton = rowGroup.querySelector('[data-table-pinned-action="table-delete-row"]');
    setPinnedActionDisabled(addRowBeforeButton, rowIndex === 0);
    setPinnedActionDisabled(deleteRowButton, rowIndex === 0 || (rowCount === 2 && rowIndex === 1));
  }
}

export async function selectPinnedLine(host, pinnedCell, kind) {
  if (!pinnedCell || !host.editor) {
    return false;
  }

  const commandKey = kind === 'row' ? selectRowCommand.key : selectColCommand.key;
  const index = kind === 'row' ? pinnedCell.rowIndex : pinnedCell.colIndex;
  return host.editor.action(callCommand(commandKey, {
    pos: pinnedCell.tablePos,
    index
  }));
}

export async function runPinnedAction({ host, pinnedCell, kind, action }) {
  if (!pinnedCell) {
    return false;
  }

  const pinnedSnapshot = {
    tablePos: pinnedCell.tablePos,
    rowIndex: pinnedCell.rowIndex,
    colIndex: pinnedCell.colIndex
  };
  await selectPinnedLine(host, pinnedCell, kind);
  if (action === 'table-delete-row' || action === 'table-delete-col') {
    await waitForNextFrame();
  }
  const result = await host.run(action);
  if (result && (action === 'table-delete-row' || action === 'table-delete-col')) {
    host.repairTableAfterDelete(pinnedSnapshot);
  }
  return result;
}
