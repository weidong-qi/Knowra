import {
  getSelectedSearchTags as selectSearchTags,
  getTagUsageCount as countTagUsage,
  getVisibleSearchTags as selectVisibleSearchTags,
  hasActiveSearchFilters as hasSearchFilters,
  matchesSearch as valueMatchesSearch,
  noteMatchesSelectedTags as noteHasSelectedSearchTags,
  toggleSearchTagId,
  withTagUsageCounts
} from '../../lib/search/state.js';
import {
  renderSearchPanel as renderSearchPanelMarkup,
  renderSearchShell as renderSearchShellMarkup,
  renderSelectedSearchChips
} from '../../lib/search/renderers.js';
import {
  getSearchResultNotes as selectSearchResultNotes,
  getVisibleNavigationNotes,
  matchesFolderSearch as folderMatchesNavigationSearch
} from '../../lib/navigation/visibility.js';

export function createSearchController(deps) {
  const {
    state,
    elements,
    knowledgeApi,
    searchDebounceDelayMs,
    getActiveNotes,
    flashStatus,
    reconcileSelection,
    renderAll
  } = deps;
  let searchTimer = null;
  let searchRequestSequence = 0;

function getVisibleNotes({ selectedFolderId = state.selectedFolderId } = {}) {
  return getVisibleNavigationNotes({
    notes: state.allNotes,
    foldersById: state.foldersById,
    selectedFolderId,
    search: state.search
  });
}

function getSearchResultNotes() {
  return selectSearchResultNotes({
    notes: state.allNotes,
    foldersById: state.foldersById,
    selectedFolderId: state.selectedFolderId,
    search: state.search
  });
}

function getSelectedSearchTags() {
  return withTagUsageCounts(selectSearchTags(state.tags, state.search), getActiveNotes());
}

function getVisibleSearchTags() {
  return withTagUsageCounts(selectVisibleSearchTags(state.tags, state.search), getActiveNotes());
}

function getTagUsageCount(tagId) {
  return countTagUsage(getActiveNotes(), tagId);
}

function hasActiveSearchFilters() {
  return hasSearchFilters(state.search);
}

function noteMatchesSelectedTags(note) {
  return noteHasSelectedSearchTags(note, state.search);
}

function matchesSearch(value) {
  return valueMatchesSearch(value, state.search);
}

function matchesFolderSearch(folder) {
  return folderMatchesNavigationSearch({
    folder,
    notes: state.allNotes,
    search: state.search
  });
}

function toggleSearchTagFilter(tagId) {
  if (!tagId) {
    return;
  }

  state.search.selectedTagIds = toggleSearchTagId(state.search.selectedTagIds, tagId);
  state.search.isOpen = true;
  if (state.libraryIndex) state.libraryIndex.page = 1;
  reconcileSelection();
  renderAll();
}

function clearSearchFilters() {
  cancelPendingSearch();
  state.search.keyword = '';
  state.search.selectedTagIds = [];
  state.search.matchingNoteIds = null;
  state.search.isOpen = false;
  if (state.libraryIndex) state.libraryIndex.page = 1;
  reconcileSelection();
  renderAll();
}

function scheduleSearchMatches() {
  cancelPendingSearch();
  state.search.matchingNoteIds = null;
  const query = state.search.keyword;
  if (!query || state.dataMode !== 'api') {
    return;
  }

  const requestSequence = ++searchRequestSequence;
  searchTimer = globalThis.setTimeout(async () => {
    searchTimer = null;
    try {
      const noteIds = await knowledgeApi.searchNoteIds({
        query,
        spaceId: state.currentSpaceId
      });
      if (requestSequence !== searchRequestSequence || query !== state.search.keyword) {
        return;
      }
      state.search.matchingNoteIds = noteIds;
      reconcileSelection();
      renderAll();
    } catch (error) {
      if (requestSequence === searchRequestSequence) {
        state.search.matchingNoteIds = null;
        flashStatus('全文搜索暂时不可用，已改用本地标题与摘要结果');
      }
    }
  }, searchDebounceDelayMs);
}

function cancelPendingSearch() {
  searchRequestSequence += 1;
  if (searchTimer !== null) {
    globalThis.clearTimeout(searchTimer);
    searchTimer = null;
  }
}

function focusSearchInput() {
  const input = elements.globalSearchShell?.querySelector('[data-search-input]');
  if (!input) {
    return;
  }

  input.focus();
  const cursor = input.value.length;
  input.setSelectionRange(cursor, cursor);
}

function renderSearchShell() {
  if (!elements.globalSearchShell) {
    return;
  }

  const hasFilters = hasActiveSearchFilters();
  const selectedTags = getSelectedSearchTags();

  if (!elements.globalSearchShell.querySelector('.top-bar-search-control')) {
    elements.globalSearchShell.innerHTML = renderSearchShellMarkup();
  }

  elements.globalSearchShell.dataset.open = String(state.search.isOpen);

  const control = elements.globalSearchShell.querySelector('.top-bar-search-control');
  const input = elements.globalSearchShell.querySelector('[data-search-input]');
  const chipTrack = elements.globalSearchShell.querySelector('[data-search-chip-track]');
  const clearButton = elements.globalSearchShell.querySelector('[data-search-clear]');
  const panelHost = elements.globalSearchShell.querySelector('.search-panel-host');

  if (control) {
    control.dataset.open = String(state.search.isOpen);
  }

  if (input && input.value !== state.search.keyword) {
    input.value = state.search.keyword;
  }

  if (chipTrack) {
    chipTrack.innerHTML = renderSelectedSearchChips(selectedTags);
  }

  if (clearButton) {
    clearButton.hidden = !hasFilters;
  }

  if (panelHost) {
    panelHost.innerHTML = state.search.isOpen ? renderSearchPanel() : '';
  }
}

function renderSearchPanel() {
  const selectedTags = getSelectedSearchTags();
  const visibleTags = getVisibleSearchTags();
  return renderSearchPanelMarkup({
    selectedTags,
    visibleTags,
    selectedTagIds: state.search.selectedTagIds,
    hasFilters: hasActiveSearchFilters(),
    isOpen: state.search.isOpen
  });
}

  return {
    getVisibleNotes,
    getSearchResultNotes,
    getSelectedSearchTags,
    getVisibleSearchTags,
    getTagUsageCount,
    hasActiveSearchFilters,
    noteMatchesSelectedTags,
    matchesSearch,
    matchesFolderSearch,
    toggleSearchTagFilter,
    clearSearchFilters,
    scheduleSearchMatches,
    focusSearchInput,
    renderSearchShell,
    renderSearchPanel
  };
}
