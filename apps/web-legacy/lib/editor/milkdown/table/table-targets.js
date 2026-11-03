import { closestFromEventTarget } from '../../../dom/event-target.js';

export function resolvePinnedMenuKindFromTarget(target, tableBlock) {
  if (!(tableBlock instanceof HTMLElement)) {
    return null;
  }

  const handle = closestFromEventTarget(
    target,
    '.milkdown-table-block [data-role="row-drag-handle"], .milkdown-table-block [data-role="col-drag-handle"]'
  );
  if (!(handle instanceof HTMLElement) || handle.closest('.milkdown-table-block') !== tableBlock) {
    return null;
  }

  return handle.dataset.role === 'row-drag-handle' ? 'row' : 'col';
}
