import { createStore } from 'zustand/vanilla';
import { createNavigationSlice } from './slices/navigationSlice';
import { createNotesIndexSlice } from './slices/notesIndexSlice';
import { createStatusSlice } from './slices/statusSlice';
import { createWorkspaceSlice } from './slices/workspaceSlice';
import { createKnowledgeSlice } from './slices/knowledgeSlice';
import { createTrainingSlice } from './slices/trainingSlice';
import { bindCommandNoteSearch } from './commandNoteSearch';
import type { AppStore, WorkspaceDependencies } from './types';

export function createAppStore(dependencies: WorkspaceDependencies) {
  return createStore<AppStore>()((set, get) => ({
    ...createStatusSlice(set),
    ...createNavigationSlice(set, get, dependencies),
    ...createNotesIndexSlice(set, get, dependencies.api.searchNoteIds),
    ...createWorkspaceSlice(set, get, dependencies),
    ...createKnowledgeSlice(get, dependencies),
    ...createTrainingSlice(get, dependencies),
    searchCommandNotes: bindCommandNoteSearch(dependencies.api.searchCommandNotes, () => get().serverData.currentSpaceId)
  }));
}

export type AppStoreApi = ReturnType<typeof createAppStore>;
