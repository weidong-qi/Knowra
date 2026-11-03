import { getContextMenuItems as getNavigationContextMenuItems } from '../../../../lib/navigation/context-menu.js';
import { renderContextMenuItems } from '../../../../lib/navigation/context-menu-renderers.js';
import {
  SECONDARY_SECTION_ITEMS,
  renderSectionMenuItems
} from '../../../../lib/navigation/section-menu-renderers.js';

export function createNavigationMenuRenderController(deps) {
  const {
    state,
    elements,
    getRecycleNotes
  } = deps;

  function renderHeaderToggle() {
    if (!elements.secondaryNavToggle) {
      return;
    }

    elements.secondaryNavToggle.dataset.open = String(state.sectionMenuOpen);
  }

  function renderContextMenu() {
    if (!elements.contextMenu) {
      return;
    }

    if (!state.contextMenu.open) {
      elements.contextMenu.hidden = true;
      elements.contextMenu.innerHTML = '';
      return;
    }

    const items = getContextMenuItems();
    if (items.length === 0) {
      elements.contextMenu.hidden = true;
      elements.contextMenu.innerHTML = '';
      return;
    }

    elements.contextMenu.hidden = false;
    elements.contextMenu.innerHTML = renderContextMenuItems(items);
    positionContextMenu();
  }

  function positionContextMenu() {
    if (!elements.contextMenu) {
      return;
    }

    const margin = 10;
    const viewportWidth = typeof window !== 'undefined' ? window.innerWidth : 0;
    const viewportHeight = typeof window !== 'undefined' ? window.innerHeight : 0;
    const { width, height } = elements.contextMenu.getBoundingClientRect();

    const maxLeft = Math.max(margin, viewportWidth - width - margin);
    const maxTop = Math.max(margin, viewportHeight - height - margin);

    const left = viewportWidth > 0
      ? Math.min(Math.max(state.contextMenu.x, margin), maxLeft)
      : state.contextMenu.x;
    const top = viewportHeight > 0
      ? Math.min(Math.max(state.contextMenu.y, margin), maxTop)
      : state.contextMenu.y;

    elements.contextMenu.style.left = `${left}px`;
    elements.contextMenu.style.top = `${top}px`;
  }

  function getContextMenuItems() {
    const currentNote = state.allNotes.find((note) => note.id === state.selectedNoteId);

    return getNavigationContextMenuItems({
      targetKind: state.contextMenu.targetKind,
      targetId: state.contextMenu.targetId,
      notes: state.allNotes,
      recycleNotes: getRecycleNotes(),
      attachments: state.attachments,
      markdown: state.draftMarkdown || currentNote?.rawMarkdown || ''
    });
  }

  function renderSectionMenu() {
    if (!elements.sectionMenu || !elements.secondaryNavToggle) {
      return;
    }

    if (!state.sectionMenuOpen) {
      elements.sectionMenu.hidden = true;
      elements.sectionMenu.innerHTML = '';
      return;
    }

    const rect = elements.secondaryNavToggle.getBoundingClientRect();
    elements.sectionMenu.hidden = false;
    elements.sectionMenu.style.left = `${Math.max(8, rect.right - 188)}px`;
    elements.sectionMenu.style.top = `${rect.bottom + 6}px`;
    elements.sectionMenu.innerHTML = renderSectionMenuItems({
      items: SECONDARY_SECTION_ITEMS,
      sections: state.secondarySections
    });
  }

  return {
    renderHeaderToggle,
    renderContextMenu,
    getContextMenuItems,
    renderSectionMenu
  };
}
