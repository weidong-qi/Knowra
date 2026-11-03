import { createBackendSnapshot, writeWorkspaceCache } from '@study-accelerator/web-core';
import type { AppStore, NavigationSlice, WorkspaceDependencies } from '../types';

type SetStore = (partial: Partial<AppStore> | ((state: AppStore) => Partial<AppStore>)) => void;
type GetStore = () => AppStore;

export function createNavigationSlice(
  set: SetStore,
  get: GetStore,
  dependencies: WorkspaceDependencies
): NavigationSlice {
  const commitNavigation = (navigation: AppStore['navigation']) => {
    set({ navigation });
    const state = get();
    writeWorkspaceCache(dependencies.storage, dependencies.cacheKey, createBackendSnapshot({
      spaces: state.serverData.spaces,
      currentSpaceId: state.serverData.currentSpaceId,
      folderTree: state.serverData.folderTree,
      tags: state.serverData.tags,
      tagGroups: state.serverData.tagGroups,
      allNotes: state.serverData.notes,
      selectedFolderId: navigation.selectedFolderId,
      selectedNoteId: navigation.selectedNoteId,
      openFolders: navigation.openFolders,
      openNoteTabs: navigation.openNoteTabs
    }));
  };
  return {
    navigation: {
      activeWorkDomain: 'materials',
      activeDomainView: 'overview',
      selectedFolderId: null,
      selectedNoteId: null,
      openFolders: {},
      openNoteTabs: []
    },
    selectFolder(folderId) {
      const state = get();
      const selectedFolderId = folderId && state.serverData.foldersById[folderId] ? folderId : null;
      const visibleNotes = state.serverData.notes.filter((note) => (
        !note.deleted && (!selectedFolderId || note.folderId === selectedFolderId)
      ));
      const selectedNoteId = visibleNotes.some((note) => note.id === state.navigation.selectedNoteId)
        ? state.navigation.selectedNoteId
        : visibleNotes[0]?.id ?? null;
      commitNavigation({
          ...state.navigation,
          selectedFolderId,
          selectedNoteId,
          openNoteTabs: ensureSelectedTab(state.navigation.openNoteTabs, selectedNoteId)
      });
    },
    selectNote(noteId) {
      const state = get();
      const selectedNoteId = state.serverData.notes.some((note) => !note.deleted && note.id === noteId)
        ? noteId
        : null;
      commitNavigation({
          ...state.navigation,
          selectedNoteId,
          openNoteTabs: ensureSelectedTab(state.navigation.openNoteTabs, selectedNoteId)
      });
    },
    closeNoteTab(noteId) {
      const state = get();
      const currentIndex = state.navigation.openNoteTabs.indexOf(noteId);
      if (currentIndex < 0) return state.navigation.selectedNoteId;
      const openNoteTabs = state.navigation.openNoteTabs.filter((id) => id !== noteId);
      const selectedNoteId = state.navigation.selectedNoteId === noteId
        ? openNoteTabs[Math.min(currentIndex, openNoteTabs.length - 1)] ?? null
        : state.navigation.selectedNoteId;
      commitNavigation({
          ...state.navigation,
          selectedNoteId,
          openNoteTabs
      });
      return selectedNoteId;
    },
    closeOtherNoteTabs(noteId) {
      const state = get();
      if (!state.navigation.openNoteTabs.includes(noteId)) return;
      commitNavigation({
        ...state.navigation,
        selectedNoteId: noteId,
        openNoteTabs: [noteId]
      });
    },
    reorderNoteTabs(sourceNoteId, targetNoteId) {
      const state = get();
      const sourceIndex = state.navigation.openNoteTabs.indexOf(sourceNoteId);
      const targetIndex = state.navigation.openNoteTabs.indexOf(targetNoteId);
      if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) return;
      const openNoteTabs = [...state.navigation.openNoteTabs];
      const [moved] = openNoteTabs.splice(sourceIndex, 1);
      openNoteTabs.splice(targetIndex, 0, moved);
      commitNavigation({ ...state.navigation, openNoteTabs });
    },
    toggleFolder(folderId) {
      const state = get();
      if (!state.serverData.foldersById[folderId]) return;
      commitNavigation({
          ...state.navigation,
          openFolders: {
            ...state.navigation.openFolders,
            [folderId]: !state.navigation.openFolders[folderId]
          }
      });
    },
    setActiveWorkDomain(domain) {
      const state = get();
      if (state.navigation.activeWorkDomain === domain) return;
      commitNavigation({
          ...state.navigation,
          activeWorkDomain: domain,
          activeDomainView: 'overview'
      });
    }
  };
}

function ensureSelectedTab(openTabs: string[], selectedNoteId: string | null): string[] {
  if (!selectedNoteId || openTabs.includes(selectedNoteId)) return openTabs;
  return [...openTabs, selectedNoteId];
}
