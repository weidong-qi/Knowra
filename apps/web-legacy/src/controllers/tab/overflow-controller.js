import {
  partitionTabsForOverflow,
  resolveTabCapacity
} from '../../../lib/editor/tab-overflow.js';
import { renderTabOverflowMenu } from '../../../lib/editor/tab-renderers.js';
import { buildNoteTabPath } from '../../../lib/editor/tab-workspace.js';

export function createTabOverflowController({
  state,
  elements,
  closeContextMenu,
  closeSectionMenu,
  closeTabMenu,
  renderTabs,
  selectTab
}) {
  function resolve(openNotes) {
    const styles = globalThis.getComputedStyle?.(elements.noteTabs);
    const capacity = resolveTabCapacity({
      containerWidth: elements.noteTabs?.clientWidth,
      minimumTabWidth: Number.parseFloat(styles?.getPropertyValue('--document-tab-min-width')),
      overflowControlWidth: Number.parseFloat(styles?.getPropertyValue('--document-tab-overflow-width')),
      tabCount: openNotes.length
    });
    return partitionTabsForOverflow(openNotes, state.selectedNoteId, capacity);
  }

  function renderMenu(notes) {
    if (!elements.noteTabOverflowMenu) return;
    if (!state.tabOverflowMenuOpen || !notes.length) {
      elements.noteTabOverflowMenu.hidden = true;
      elements.noteTabOverflowMenu.innerHTML = '';
      return;
    }

    elements.noteTabOverflowMenu.hidden = false;
    elements.noteTabOverflowMenu.innerHTML = renderTabOverflowMenu({
      notes,
      selectedNoteId: state.selectedNoteId,
      foldersById: state.foldersById,
      buildNoteTabPath
    });
  }

  function toggle() {
    closeContextMenu();
    closeSectionMenu();
    closeTabMenu();
    state.tabOverflowMenuOpen = !state.tabOverflowMenuOpen;
    renderTabs();
  }

  function close({ restoreFocus = false } = {}) {
    if (!state.tabOverflowMenuOpen) return;
    state.tabOverflowMenuOpen = false;
    renderMenu([]);
    const overflowToggle = elements.noteTabOverflowToggleHost?.querySelector?.('[data-tab-overflow-toggle]')
      ?? elements.noteTabs?.querySelector?.('[data-tab-overflow-toggle]');
    overflowToggle?.setAttribute('aria-expanded', 'false');
    overflowToggle?.setAttribute('data-open', 'false');
    if (restoreFocus) {
      overflowToggle?.focus?.();
    }
  }

  async function select(noteId) {
    const result = await selectTab(noteId, { ensureTab: true });
    close();
    return result;
  }

  return { resolve, renderMenu, toggle, close, select };
}
