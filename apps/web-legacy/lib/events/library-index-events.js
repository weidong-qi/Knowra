import { closestFromEventTarget } from '../dom/event-target.js';

const LIBRARY_INDEX_TAB_KEYS = ['all', 'recent', 'favorites', 'recycle'];

function getLibraryIndexTabButtons(elements) {
  return Array.from(elements.libraryIndexView?.querySelectorAll?.('[data-index-tab]') ?? [])
    .filter((button) => button?.dataset?.indexTab);
}

function getLibraryIndexTabKeys(elements) {
  const tabKeys = getLibraryIndexTabButtons(elements).map((button) => button.dataset.indexTab);
  return tabKeys.length ? tabKeys : LIBRARY_INDEX_TAB_KEYS;
}

function getLibraryIndexKeyboardTarget(currentKey, pressedKey, tabKeys) {
  const currentIndex = tabKeys.indexOf(currentKey);
  if (currentIndex < 0) return null;

  if (pressedKey === 'Home') return tabKeys[0];
  if (pressedKey === 'End') return tabKeys[tabKeys.length - 1];

  const direction = ['ArrowRight', 'ArrowDown'].includes(pressedKey) ? 1
    : ['ArrowLeft', 'ArrowUp'].includes(pressedKey) ? -1
      : 0;
  if (!direction) return null;

  return tabKeys[(currentIndex + direction + tabKeys.length) % tabKeys.length];
}

function focusLibraryIndexTab(elements, tabKey) {
  getLibraryIndexTabButtons(elements)
    .find((button) => button.dataset.indexTab === tabKey)
    ?.focus?.();
}

function focusLibraryIndexReopen(elements, selector, root = elements.libraryIndexView) {
  const reopenButton = root?.querySelector?.(selector)
    ?? elements.libraryIndexView?.querySelector?.(selector);
  reopenButton?.focus?.();
}

export function bindLibraryIndexEvents({ state, elements, deps }) {
  let rowSelectionTimer = null;
  const openNote = async (noteId) => {
    if (!noteId) return;
    await deps.selectNote(noteId, { syncFolder: true, ensureTab: true });
  };

  elements.libraryIndexView?.addEventListener('click', (event) => {
    const filterOption = closestFromEventTarget(event.target, '[data-index-filter-option]');
    if (filterOption?.dataset.filterKind && filterOption?.dataset.filterValue) {
      const { filterKind, filterValue } = filterOption.dataset;
      state.libraryIndex.filters[filterKind] = filterValue;
      state.libraryIndex.filterMenu = null;
      state.libraryIndex.selectedNoteId = null;
      state.libraryIndex.page = 1;
      deps.renderLibraryIndex();
      return;
    }

    const filterButton = closestFromEventTarget(event.target, '[data-index-filter]');
    if (filterButton?.dataset.indexFilter) {
      const nextMenu = filterButton.dataset.indexFilter;
      state.libraryIndex.filterMenu = state.libraryIndex.filterMenu === nextMenu ? null : nextMenu;
      deps.renderLibraryIndex();
      return;
    }

    const closedFilterMenu = Boolean(
      state.libraryIndex.filterMenu
      && !closestFromEventTarget(event.target, '[data-index-filter-shell]')
    );
    if (closedFilterMenu) {
      state.libraryIndex.filterMenu = null;
    }

    const restoreButton = closestFromEventTarget(event.target, '[data-index-restore]');
    if (restoreButton?.dataset.indexRestore) {
      event.stopPropagation();
      void deps.restoreNote(restoreButton.dataset.indexRestore).then(() => deps.renderAll());
      return;
    }

    const pageSizeButton = closestFromEventTarget(event.target, '[data-index-page-size]');
    if (pageSizeButton?.dataset.indexPageSize) {
      state.libraryIndex.pageSize = Number(pageSizeButton.dataset.indexPageSize);
      state.libraryIndex.page = 1;
      state.libraryIndex.selectedNoteId = null;
      deps.renderLibraryIndex();
      return;
    }

    const pageButton = closestFromEventTarget(event.target, '[data-index-page]');
    if (pageButton?.dataset.indexPage) {
      state.libraryIndex.page = Number(pageButton.dataset.indexPage);
      state.libraryIndex.selectedNoteId = null;
      deps.renderLibraryIndex();
      return;
    }

    const openButton = closestFromEventTarget(event.target, '[data-index-open]');
    if (openButton?.dataset.indexOpen) {
      event.stopPropagation();
      void openNote(openButton.dataset.indexOpen);
      return;
    }

    const attachmentButton = closestFromEventTarget(event.target, '[data-attachment-open]');
    if (attachmentButton?.dataset.attachmentOpen) {
      event.stopPropagation();
      void deps.openAttachment?.(attachmentButton.dataset.attachmentOpen);
      return;
    }

    const tabButton = closestFromEventTarget(event.target, '[data-index-tab]');
    if (tabButton?.dataset.indexTab) {
      selectLibraryIndexTab({ state, deps, tabKey: tabButton.dataset.indexTab });
      return;
    }

    if (closestFromEventTarget(event.target, '[data-index-clear]')) {
      state.libraryIndex.tab = 'all';
      state.libraryIndex.filterMenu = null;
      state.libraryIndex.page = 1;
      state.libraryIndex.filters = {
        type: 'all',
        status: 'all',
        time: 'updated-desc'
      };
      state.libraryIndex.localKeyword = '';
      state.selectedFolderId = null;
      deps.clearSearchFilters();
      deps.renderLibraryIndex();
      return;
    }

    if (closestFromEventTarget(event.target, '[data-index-new-note]')) {
      void deps.handleFileMenuAction('new-note');
      return;
    }

    if (closestFromEventTarget(event.target, '[data-index-inspector-close]')) {
      state.libraryIndex.inspectorOpen = false;
      deps.renderLibraryIndex();
      focusLibraryIndexReopen(elements, '[data-index-inspector-open]', elements.libraryIndexInspector);
      return;
    }

    if (closestFromEventTarget(event.target, '[data-index-inspector-open]')) {
      state.libraryIndex.inspectorOpen = true;
      deps.renderLibraryIndex();
      return;
    }

    const row = closestFromEventTarget(event.target, '[data-index-note-select]');
    if (row?.dataset.indexNoteSelect) {
      globalThis.clearTimeout(rowSelectionTimer);
      rowSelectionTimer = globalThis.setTimeout(() => {
        state.libraryIndex.selectedNoteId = row.dataset.indexNoteSelect;
        state.libraryIndex.inspectorOpen = true;
        deps.renderLibraryIndex();
      }, 180);
      return;
    }

    if (closedFilterMenu) deps.renderLibraryIndex();
  });

  elements.libraryIndexView?.addEventListener('input', (event) => {
    const input = closestFromEventTarget(event.target, '[data-index-local-search]');
    if (!input) return;

    state.libraryIndex.localKeyword = String(input.value ?? '').trim().toLowerCase();
    state.libraryIndex.page = 1;
    state.libraryIndex.selectedNoteId = null;
    deps.reconcileSelection?.();
    deps.renderAll();
    const nextInput = elements.libraryIndexView.querySelector?.('[data-index-local-search]');
    nextInput?.focus?.();
    nextInput?.setSelectionRange?.(nextInput.value.length, nextInput.value.length);
  });

  elements.libraryIndexView?.addEventListener('dblclick', (event) => {
    if (closestFromEventTarget(event.target, 'button, input, textarea')) return;
    const row = closestFromEventTarget(event.target, '[data-index-note-select]');
    if (row?.dataset.indexNoteSelect) {
      globalThis.clearTimeout(rowSelectionTimer);
      rowSelectionTimer = null;
      event.preventDefault();
      void openNote(row.dataset.indexNoteSelect);
    }
  });

  elements.libraryIndexView?.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && state.libraryIndex.filterMenu) {
      state.libraryIndex.filterMenu = null;
      deps.renderLibraryIndex();
      return;
    }

    const tabButton = closestFromEventTarget(event.target, '[data-index-tab]');
    if (tabButton?.dataset.indexTab && !event.altKey && !event.ctrlKey && !event.metaKey) {
      const nextTabKey = getLibraryIndexKeyboardTarget(
        tabButton.dataset.indexTab,
        event.key,
        getLibraryIndexTabKeys(elements)
      );
      if (nextTabKey) {
        event.preventDefault();
        selectLibraryIndexTab({ state, deps, tabKey: nextTabKey });
        focusLibraryIndexTab(elements, nextTabKey);
        return;
      }
    }

    if (event.key !== 'Enter') return;
    const row = closestFromEventTarget(event.target, '[data-index-note-select]');
    if (row?.dataset.indexNoteSelect) {
      event.preventDefault();
      void openNote(row.dataset.indexNoteSelect);
    }
  });

  elements.workspaceShell?.addEventListener('click', (event) => {
    const directoryToggle = closestFromEventTarget(event.target, '[data-index-directory-toggle]');
    if (directoryToggle) {
      const isEditor = state.view?.screen === 'editor';
      const wasDirectoryOpen = isEditor
        ? state.view.showLeftSidebar
        : state.libraryIndex.directoryOpen;
      if (isEditor) {
        state.view.showLeftSidebar = !state.view.showLeftSidebar;
      } else {
        state.libraryIndex.directoryOpen = !state.libraryIndex.directoryOpen;
      }
      deps.renderAll();
      const isDirectoryOpen = isEditor
        ? state.view.showLeftSidebar
        : state.libraryIndex.directoryOpen;
      if (wasDirectoryOpen && !isDirectoryOpen) {
        elements.libraryIndexDirectoryReopen?.focus?.();
      } else if (!wasDirectoryOpen && isDirectoryOpen) {
        elements.libraryIndexDirectoryToggle?.focus?.();
      }
      return;
    }

    if (closestFromEventTarget(event.target, '[data-index-directory-create]')) {
      void deps.handleFileMenuAction('new-folder');
      return;
    }

    const homeNavigation = closestFromEventTarget(event.target, '[data-nav-item="home"]');
    if (homeNavigation) {
      event.preventDefault();
      void deps.openHome?.();
      return;
    }

    const homeButton = closestFromEventTarget(event.target, '[data-library-home]');
    if (homeButton) {
      void deps.returnToLibraryIndex({
        global: homeButton.dataset.libraryHome === 'global'
      });
      return;
    }

    if (closestFromEventTarget(event.target, '[data-editor-aside-toggle]')) {
      const wasRightSidebarOpen = state.view.showRightSidebar;
      state.view.showRightSidebar = !state.view.showRightSidebar;
      deps.renderAll();
      if (wasRightSidebarOpen && !state.view.showRightSidebar) {
        elements.editorAsideReopen?.focus?.();
      } else if (!wasRightSidebarOpen && state.view.showRightSidebar) {
        elements.editorAsideToggle?.focus?.();
      }
      return;
    }

    const moduleButton = closestFromEventTarget(event.target, '[data-module-key]');
    if (!moduleButton?.dataset.moduleKey) return;
    deps.selectWorkDomain?.(moduleButton.dataset.moduleKey);
  });
}

function selectLibraryIndexTab({ state, deps, tabKey }) {
  state.libraryIndex.tab = tabKey;
  state.libraryIndex.filterMenu = null;
  state.libraryIndex.selectedNoteId = null;
  state.libraryIndex.page = 1;
  state.selectedFolderId = null;
  deps.renderAll();
}
