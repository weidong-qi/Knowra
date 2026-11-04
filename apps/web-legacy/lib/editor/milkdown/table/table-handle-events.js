import { closestFromEventTarget, getEventTargetElement } from '../../../dom/event-target.js';

export const TABLE_POINTER_GRACE_MS = 280;

export function clearTablePointerGrace(controller) {
  if (controller.pointerGraceTimer) {
    window.clearTimeout(controller.pointerGraceTimer);
    controller.pointerGraceTimer = 0;
  }
}

export function handleTableRootClick(controller, event) {
  const target = getEventTargetElement(event.target);
  if (!target) {
    return;
  }

  if (closestFromEventTarget(event.target, '.milkdown-table-block .button-group button')) {
    return;
  }

  if (closestFromEventTarget(event.target, '.milkdown-table-block [data-role="row-drag-handle"], .milkdown-table-block [data-role="col-drag-handle"]')) {
    return;
  }

  const cell = closestFromEventTarget(event.target, '.milkdown-table-block table.children td, .milkdown-table-block table.children th');
  if (cell instanceof HTMLElement) {
    controller.pinCell(cell);
    return;
  }

  if (!closestFromEventTarget(event.target, '.milkdown-table-block')) {
    controller.clearPinnedTable();
  }
}

export function handleTableDocumentPointerDown(controller, event) {
  const target = getEventTargetElement(event.target);
  if (!target) {
    return;
  }

  if (closestFromEventTarget(event.target, '.milkdown-table-block .button-group button')) {
    return;
  }

  const rowHandle = closestFromEventTarget(event.target, '.milkdown-table-block [data-role="row-drag-handle"]');
  if (rowHandle instanceof HTMLElement && rowHandle.closest('.milkdown-table-block')?.dataset.pinned === 'true') {
    event.preventDefault();
    event.stopPropagation();
    void controller.togglePinnedMenu('row');
    return;
  }

  const colHandle = closestFromEventTarget(event.target, '.milkdown-table-block [data-role="col-drag-handle"]');
  if (colHandle instanceof HTMLElement && colHandle.closest('.milkdown-table-block')?.dataset.pinned === 'true') {
    event.preventDefault();
    event.stopPropagation();
    void controller.togglePinnedMenu('col');
    return;
  }

  if (!controller.root.contains(target)) {
    controller.clearPinnedTable();
    return;
  }

  if (!closestFromEventTarget(event.target, '.milkdown-table-block')) {
    controller.clearPinnedTable();
  }
}

export function handleTableRootPointerOver(controller, event) {
  const kind = controller.getPinnedMenuKindFromTarget(event.target);
  if (!kind && controller.pointerGraceTimer) {
    return;
  }

  clearTablePointerGrace(controller);
  if (kind === controller.hoverMenuKind) {
    return;
  }

  controller.hoverMenuKind = kind;
  controller.applyPinnedMenuState();
}

export function handleTableRootPointerOut(controller, event) {
  const currentKind = controller.getPinnedMenuKindFromTarget(event.target);
  if (!currentKind) {
    return;
  }

  const nextKind = controller.getPinnedMenuKindFromTarget(event.relatedTarget);
  if (nextKind === currentKind) {
    return;
  }

  if (nextKind) {
    clearTablePointerGrace(controller);
    controller.hoverMenuKind = nextKind;
    controller.applyPinnedMenuState();
    return;
  }

  clearTablePointerGrace(controller);
  controller.pointerGraceTimer = window.setTimeout(() => {
    controller.pointerGraceTimer = 0;
    if (controller.hoverMenuKind !== currentKind) {
      return;
    }
    controller.hoverMenuKind = null;
    controller.applyPinnedMenuState();
  }, TABLE_POINTER_GRACE_MS);
}
