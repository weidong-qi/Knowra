export function clearPinnedMenuRecovery(controller) {
  if (controller.menuRecoveryTimer) {
    window.clearTimeout(controller.menuRecoveryTimer);
    controller.menuRecoveryTimer = 0;
  }
  controller.menuRecoveryKind = null;
  controller.menuRecoveryAttempt = 0;
}

export function schedulePinnedMenuRecovery(controller, kind = controller.openMenuKind, attempt = 0) {
  clearPinnedMenuRecovery(controller);
  if (!controller.pinnedCell || !kind || controller.openMenuKind !== kind) {
    return;
  }

  controller.menuRecoveryKind = kind;
  controller.menuRecoveryAttempt = attempt;
  const delay = attempt === 0 ? 120 : 80;
  controller.menuRecoveryTimer = window.setTimeout(() => {
    controller.menuRecoveryTimer = 0;
    if (!controller.pinnedCell || controller.openMenuKind !== kind) {
      clearPinnedMenuRecovery(controller);
      return;
    }

    controller.syncPinnedHandles();
    controller.applyPinnedMenuState();

    const buttonGroup = controller.pinnedCell.tableBlock?.querySelector(
      kind === 'row'
        ? '[data-role="row-drag-handle"] .button-group'
        : '[data-role="col-drag-handle"] .button-group'
    );
    const isVisible = buttonGroup instanceof HTMLElement
      && buttonGroup.dataset.show === 'true'
      && window.getComputedStyle(buttonGroup).pointerEvents !== 'none';

    if (isVisible || attempt >= 5) {
      clearPinnedMenuRecovery(controller);
      return;
    }

    schedulePinnedMenuRecovery(controller, kind, attempt + 1);
  }, delay);
}
