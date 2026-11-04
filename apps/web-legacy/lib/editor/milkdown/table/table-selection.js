export function findTableCellFromSelection(root) {
  if (!(root instanceof HTMLElement)) {
    return null;
  }

  const selection = window.getSelection?.();
  const anchorNode = selection?.anchorNode;
  const anchorElement = anchorNode instanceof Element ? anchorNode : anchorNode?.parentElement;
  const directCell = anchorElement?.closest?.('.milkdown-table-block table.children td, .milkdown-table-block table.children th');
  if (directCell instanceof HTMLElement && root.contains(directCell)) {
    return directCell;
  }

  const selectedCell = root.querySelector('.milkdown-table-block table.children td.selectedCell, .milkdown-table-block table.children th.selectedCell');
  return selectedCell instanceof HTMLElement ? selectedCell : null;
}
