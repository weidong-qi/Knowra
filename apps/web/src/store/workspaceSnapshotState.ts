import {
  createBackendSnapshot,
  flattenFolderTree,
  mergeWorkspaceSnapshots,
  normalizeFolderTree,
  normalizeNotes,
  readWorkspaceCache,
  replaceNoteInCollection,
  writeWorkspaceCache,
  type WorkspaceDataMode,
  type WorkspaceServerData,
  type WorkspaceSnapshot
} from '@study-accelerator/web-core';
import type { AppStore, WorkspaceDependencies, WorkspaceSlice } from './types';

export type SetStore = (partial: Partial<AppStore> | ((state: AppStore) => Partial<AppStore>)) => void;
export type GetStore = () => AppStore;

export const EMPTY_WORKSPACE_SERVER_DATA: WorkspaceServerData = {
  spaces: [], currentSpaceId: null, folderTree: [], foldersById: {}, notes: [], tags: [], tagGroups: []
};

export function updateWorkspaceNoteInStore(
  set: SetStore,
  get: GetStore,
  dependencies: WorkspaceDependencies,
  updatedNote: unknown,
  fallbackFields: Record<string, unknown>,
  options: { insertMissing?: boolean } = {}
): void {
  const state = get();
  let notes = replaceNoteInCollection(state.serverData.notes, updatedNote, fallbackFields);
  if (options.insertMissing) {
    const inserted = normalizeNotes([updatedNote])[0];
    if (inserted && !notes.some(note => note.id === inserted.id)) notes = [...notes, inserted];
  }
  set({ serverData: { ...state.serverData, notes } });
  const nextState = get();
  writeWorkspaceCache(dependencies.storage, dependencies.cacheKey, createBackendSnapshot({
    spaces: nextState.serverData.spaces,
    currentSpaceId: nextState.serverData.currentSpaceId,
    folderTree: nextState.serverData.folderTree,
    tags: nextState.serverData.tags,
    tagGroups: nextState.serverData.tagGroups,
    allNotes: notes,
    ...nextState.navigation
  }));
}
export async function loadWorkspaceState(dependencies: WorkspaceDependencies, set: SetStore, preferredSpaceId: string | null, isCurrent: () => boolean): Promise<void> {
  if (!isCurrent()) return;
  const cachedSnapshot = readWorkspaceCache(dependencies.storage, dependencies.cacheKey);
  if (cachedSnapshot) {
    applyWorkspaceSnapshot(set, cachedSnapshot, 'cache', 'loading', null, '正在刷新最近一次资料缓存…');
  } else {
    set({ dataMode: 'loading', workspaceLoadState: 'loading', workspaceError: null, statusMessage: '正在连接资料服务…' });
  }

  try {
    let spaces = await dependencies.api.listKnowledgeSpaces();
    if (!isCurrent()) return;
    if (spaces.length === 0) spaces = [await dependencies.api.createDefaultKnowledgeSpace()];
    if (!isCurrent()) return;
    const currentSpaceId = spaces.find(space => space.id === preferredSpaceId)?.id
      ?? spaces.find(space => space.id === cachedSnapshot?.currentSpaceId)?.id
      ?? spaces.find(space => space.defaultFlag)?.id ?? spaces[0]?.id ?? null;
    if (!currentSpaceId) throw new Error('资料服务未返回可用知识空间。');
    const resources = await dependencies.api.loadWorkspaceResources(currentSpaceId);
    if (!isCurrent()) return;
    const liveSnapshot = createBackendSnapshot({
      spaces,
      currentSpaceId,
      folderTree: normalizeFolderTree(resources.folderTree),
      tags: resources.tags,
      tagGroups: resources.tagGroups ?? [],
      allNotes: normalizeNotes(resources.notes)
    });
    const mergedSnapshot = mergeWorkspaceSnapshots(liveSnapshot, cachedSnapshot) ?? liveSnapshot;
    applyWorkspaceSnapshot(set, mergedSnapshot, 'api', 'ready', null, dependencies.persistenceMode === 'desktop-local'
      ? '本地资料库已就绪' : '知识库已连接到后端数据');
    if (isCurrent()) writeWorkspaceCache(dependencies.storage, dependencies.cacheKey, mergedSnapshot);
  } catch (error) {
    if (!isCurrent()) return;
    const message = error instanceof Error ? error.message : '资料加载失败。';
    if (cachedSnapshot) {
      applyWorkspaceSnapshot(set, cachedSnapshot, 'cache', 'error', message, '后端暂时不可用，当前显示只读缓存');
      return;
    }
    applyWorkspaceSnapshot(set, dependencies.mockSnapshot, 'local', 'error', message, '未检测到后端，已切换到本地恢复模式');
  }
}

export function applyWorkspaceSnapshot(
  set: SetStore,
  snapshot: WorkspaceSnapshot,
  dataMode: WorkspaceDataMode,
  workspaceLoadState: WorkspaceSlice['workspaceLoadState'],
  workspaceError: string | null,
  statusMessage: string
): void {
  const folderTree = normalizeFolderTree(snapshot.folderTree);
  const foldersById = flattenFolderTree(folderTree);
  const notes = normalizeNotes(snapshot.allNotes);
  const activeNoteIds = new Set(notes.filter((note) => !note.deleted).map((note) => note.id));
  const selectedFolderId = snapshot.selectedFolderId && foldersById[snapshot.selectedFolderId]
    ? snapshot.selectedFolderId : null;
  const selectedNoteId = snapshot.selectedNoteId && activeNoteIds.has(snapshot.selectedNoteId)
    ? snapshot.selectedNoteId : notes.find((note) => !note.deleted)?.id ?? null;
  const openNoteTabs = snapshot.openNoteTabs.filter((noteId) => activeNoteIds.has(noteId));
  if (selectedNoteId && !openNoteTabs.includes(selectedNoteId)) openNoteTabs.push(selectedNoteId);

  set((state) => ({
    serverData: { spaces: snapshot.spaces, currentSpaceId: snapshot.currentSpaceId, folderTree, foldersById, notes, tags: snapshot.tags, tagGroups: snapshot.tagGroups ?? [] },
    navigation: { ...state.navigation, selectedFolderId, selectedNoteId, openFolders: { ...snapshot.openFolders }, openNoteTabs },
    dataMode, workspaceLoadState, workspaceError, statusMessage
  }));
}
