import type { AppStore, NotesIndexScope, NotesIndexSlice } from '../types';

type SetStore = (partial: Partial<AppStore> | ((state: AppStore) => Partial<AppStore>)) => void;
type GetStore = () => AppStore;

export function createNotesIndexSlice(
  set: SetStore,
  get: GetStore,
  searchNoteIds: (input: { query?: string; spaceId?: string }) => Promise<string[]>
): NotesIndexSlice {
  let activeSearch = 0;

  return {
    notesIndex: {
      scope: 'all',
      selectedTagId: null,
      query: '',
      matchingNoteIds: null,
      searchState: 'idle'
    },
    selectNotesScope(scope) {
      setSelection(set, get, { scope, selectedTagId: null, selectedFolderId: null });
    },
    selectNotesFolder(folderId) {
      const validFolderId = folderId && get().serverData.foldersById[folderId] ? folderId : null;
      setSelection(set, get, {
        scope: 'all',
        selectedTagId: null,
        selectedFolderId: validFolderId
      });
    },
    selectNotesTag(tagId) {
      const validTagId = tagId && get().serverData.tags.some((tag) => tag.id === tagId) ? tagId : null;
      setSelection(set, get, {
        scope: 'all',
        selectedTagId: validTagId,
        selectedFolderId: null
      });
    },
    setNotesQuery(query) {
      activeSearch += 1;
      set((state) => ({
        notesIndex: {
          ...state.notesIndex,
          query,
          matchingNoteIds: query.trim() ? null : [],
          searchState: query.trim() ? 'loading' : 'idle'
        }
      }));
    },
    async searchNotes(query) {
      const normalizedQuery = query.trim();
      const searchId = ++activeSearch;
      if (!normalizedQuery) {
        set((state) => ({
          notesIndex: {
            ...state.notesIndex,
            query,
            matchingNoteIds: [],
            searchState: 'idle'
          }
        }));
        return;
      }
      set((state) => ({
        notesIndex: { ...state.notesIndex, query, searchState: 'loading' }
      }));
      try {
        const matchingNoteIds = await searchNoteIds({
          query: normalizedQuery,
          spaceId: get().serverData.currentSpaceId ?? undefined
        });
        if (searchId !== activeSearch) return;
        set((state) => ({
          notesIndex: {
            ...state.notesIndex,
            query,
            matchingNoteIds,
            searchState: 'ready'
          }
        }));
      } catch (error) {
        if (searchId !== activeSearch) return;
        set((state) => ({
          notesIndex: {
            ...state.notesIndex,
            query,
            matchingNoteIds: null,
            searchState: 'error'
          },
          statusMessage: error instanceof Error ? error.message : '笔记搜索失败'
        }));
      }
    }
  };
}

function setSelection(
  set: SetStore,
  get: GetStore,
  selection: {
    scope: NotesIndexScope;
    selectedTagId: string | null;
    selectedFolderId: string | null;
  }
) {
  const state = get();
  set({
    notesIndex: {
      ...state.notesIndex,
      scope: selection.scope,
      selectedTagId: selection.selectedTagId
    },
    navigation: {
      ...state.navigation,
      selectedFolderId: selection.selectedFolderId,
      selectedNoteId: null
    }
  });
}
