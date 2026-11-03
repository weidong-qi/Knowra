import {
  clearTablePointerGrace,
  handleTableDocumentPointerDown,
  handleTableRootClick,
  handleTableRootPointerOut,
  handleTableRootPointerOver
} from './table-handle-events.js';
import {
  runPinnedAction,
  selectPinnedLine
} from './table-pinned-actions.js';
import {
  clearPinnedMenuRecovery,
  schedulePinnedMenuRecovery
} from './table-pinned-menu-recovery.js';
import {
  applyPinnedMenuState,
  clearPinnedTable,
  findCellFromCurrentSelection,
  pinCell,
  syncPinnedHandleFromSelection,
  syncPinnedHandles
} from './table-pinned-state.js';
import { resolvePinnedMenuKindFromTarget } from './table-targets.js';

export class TableHandleController {
  constructor(host) {
    this.host = host;
    this.root = host.root;
    this.pinnedCell = null;
    this.openMenuKind = null;
    this.hoverMenuKind = null;
    this.syncFrame = 0;
    this.menuRecoveryTimer = 0;
    this.menuRecoveryKind = null;
    this.menuRecoveryAttempt = 0;
    this.pointerGraceTimer = 0;
  }

  attach() {
    this.root.addEventListener('click', this.handleRootClick, true);
    this.root.addEventListener('pointerover', this.handleRootPointerOver, true);
    this.root.addEventListener('pointerout', this.handleRootPointerOut, true);
    this.root.addEventListener('mouseup', this.queueSelectionSync, true);
    this.root.addEventListener('keyup', this.queueSelectionSync, true);
    document.addEventListener('pointerdown', this.handleDocumentPointerDown, true);
    document.addEventListener('selectionchange', this.handleSelectionChange, true);
    window.addEventListener('resize', this.queueSyncPinnedHandles);
    this.root.addEventListener('scroll', this.queueSyncPinnedHandles, true);
  }

  destroy() {
    this.clearPinnedTable();
    this.clearPinnedMenuRecovery();
    this.clearPointerGrace();
    if (this.syncFrame) {
      window.cancelAnimationFrame(this.syncFrame);
      this.syncFrame = 0;
    }
    this.root.removeEventListener('click', this.handleRootClick, true);
    this.root.removeEventListener('pointerover', this.handleRootPointerOver, true);
    this.root.removeEventListener('pointerout', this.handleRootPointerOut, true);
    this.root.removeEventListener('mouseup', this.queueSelectionSync, true);
    this.root.removeEventListener('keyup', this.queueSelectionSync, true);
    document.removeEventListener('pointerdown', this.handleDocumentPointerDown, true);
    document.removeEventListener('selectionchange', this.handleSelectionChange, true);
    window.removeEventListener('resize', this.queueSyncPinnedHandles);
    this.root.removeEventListener('scroll', this.queueSyncPinnedHandles, true);
  }

  handleRootClick = (event) => {
    handleTableRootClick(this, event);
  };

  handleDocumentPointerDown = (event) => {
    handleTableDocumentPointerDown(this, event);
  };

  handleSelectionChange = () => {
    this.queueSelectionSync();
  };

  getPinnedMenuKindFromTarget(target) {
    return resolvePinnedMenuKindFromTarget(target, this.pinnedCell?.tableBlock);
  }

  handleRootPointerOver = (event) => {
    handleTableRootPointerOver(this, event);
  };

  handleRootPointerOut = (event) => {
    handleTableRootPointerOut(this, event);
  };

  clearPointerGrace() {
    clearTablePointerGrace(this);
  }

  clearPinnedMenuRecovery() {
    clearPinnedMenuRecovery(this);
  }

  schedulePinnedMenuRecovery(kind = this.openMenuKind, attempt = 0) {
    schedulePinnedMenuRecovery(this, kind, attempt);
  }

  queueSyncPinnedHandles = () => {
    if (!this.pinnedCell || this.syncFrame) {
      return;
    }

    this.syncFrame = window.requestAnimationFrame(() => {
      this.syncFrame = 0;
      this.syncPinnedHandles();
    });
  };

  queueSelectionSync = () => {
    if (this.syncFrame) {
      return;
    }

    this.syncFrame = window.requestAnimationFrame(() => {
      this.syncFrame = 0;
      this.syncPinnedHandleFromSelection();
    });
  };

  findCellFromCurrentSelection() {
    return findCellFromCurrentSelection(this);
  }

  syncPinnedHandleFromSelection() {
    syncPinnedHandleFromSelection(this);
  }

  clearPinnedTable() {
    clearPinnedTable(this);
  }

  pinCell(cell) {
    pinCell(this, cell);
  }

  applyPinnedMenuState() {
    applyPinnedMenuState(this);
  }

  syncPinnedHandles() {
    syncPinnedHandles(this);
  }

  async selectPinnedLine(kind) {
    return selectPinnedLine(this.host, this.pinnedCell, kind);
  }

  async togglePinnedMenu(kind) {
    if (!this.pinnedCell) {
      return;
    }

    this.openMenuKind = this.openMenuKind === kind ? null : kind;
    this.applyPinnedMenuState();
    if (!this.openMenuKind) {
      this.clearPinnedMenuRecovery();
      return;
    }
    await this.selectPinnedLine(kind);
    this.syncPinnedHandles();
    window.requestAnimationFrame(() => {
      this.applyPinnedMenuState();
    });
    this.schedulePinnedMenuRecovery(kind);
  }

  async runPinnedAction(kind, action) {
    const result = await runPinnedAction({
      host: this.host,
      pinnedCell: this.pinnedCell,
      kind,
      action
    });
    this.queueSyncPinnedHandles();
    return result;
  }
}

