import { isComposingEvent } from '../dom/composition.js';
import { closestFromEventTarget, getEventTargetElement } from '../dom/event-target.js';

// search-events.js
// 搜索 / 二级导航折叠 / Markdown 导入事件绑定。
// 由 client.js 的 bindEvents() 在初始化时一次性注册。
// 选择器、事件名、闭包引用与原实现保持一致。

export function bindSearchEvents({ state, elements, deps }) {
  const {
    toggleSearchTagFilter,
    focusSearchInput,
    renderSearchShell,
    clearSearchFilters,
    getSearchResultNotes,
    selectNote,
    closeContextMenu,
    renderFolders,
    scheduleSearchMatches,
    reconcileSelection,
    renderAll,
    importMarkdownFiles,
    flashStatus
  } = deps;

  elements.globalSearchShell?.addEventListener('click', (event) => {
    event.stopPropagation();
    const chipRemoveButton = closestFromEventTarget(event.target, '[data-search-chip-remove]');
    if (chipRemoveButton?.dataset.searchChipRemove) {
      toggleSearchTagFilter(chipRemoveButton.dataset.searchChipRemove);
      focusSearchInput();
      return;
    }

    const tagButton = closestFromEventTarget(event.target, '[data-search-tag-id]');
    if (tagButton?.dataset.searchTagId) {
      toggleSearchTagFilter(tagButton.dataset.searchTagId);
      focusSearchInput();
      return;
    }

    const noteButton = closestFromEventTarget(event.target, '[data-search-note-id]');
    if (noteButton?.dataset.searchNoteId) {
      state.search.isOpen = false;
      void selectNote(noteButton.dataset.searchNoteId, { syncFolder: true });
      return;
    }

    const clearButton = closestFromEventTarget(event.target, '[data-search-clear]');
    if (clearButton) {
      clearSearchFilters();
      return;
    }

    if (!state.search.isOpen) {
      state.search.isOpen = true;
      renderSearchShell();
    }

    focusSearchInput();
  });

  elements.globalSearchShell?.addEventListener('input', (event) => {
    const input = closestFromEventTarget(event.target, '[data-search-input]');
    if (!input) {
      return;
    }

    state.search.keyword = input.value.trim().toLowerCase();
    state.search.matchingNoteIds = null;
    state.search.isOpen = true;
    if (state.libraryIndex) state.libraryIndex.page = 1;
    reconcileSelection();
    renderAll();
    scheduleSearchMatches?.();
  });

  elements.globalSearchShell?.addEventListener('keydown', (event) => {
    const input = closestFromEventTarget(event.target, '[data-search-input]');
    if (!input) {
      return;
    }

    if (isComposingEvent(event)) {
      return;
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      state.search.isOpen = false;
      renderSearchShell();
      return;
    }

    if (event.key !== 'Enter') {
      return;
    }

    const results = getSearchResultNotes();
    if (!results.length) {
      return;
    }

    event.preventDefault();
    state.search.isOpen = false;
    void selectNote(results[0].id, { syncFolder: true });
  });

  elements.secondaryNavToggle?.addEventListener('click', (event) => {
    event.stopPropagation();
    state.sectionMenuOpen = !state.sectionMenuOpen;
    closeContextMenu();
    renderFolders();
  });

  elements.markdownImportInput?.addEventListener('change', async (event) => {
    const input = getEventTargetElement(event.target) ?? event.target;
    const files = Array.from(input?.files ?? []);
    if (input) {
      input.value = '';
    }

    if (!files.length) {
      return;
    }

    try {
      await importMarkdownFiles(files);
    } catch (error) {
      flashStatus(error?.message || 'Markdown 导入失败');
    }
  });
}
