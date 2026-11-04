import type { Note, WorkspaceServerData } from '@study-accelerator/web-core';
import { updateWorkspaceNoteInStore, type GetStore, type SetStore } from './workspaceSnapshotState';
import type { WorkspaceDependencies } from './types';

export interface CommandNoteLoadInput {
  noteId: string;
  spaceId: string;
  isCurrent(): boolean;
}

export interface CommandNoteLoadResult { note: Note; snapshot: WorkspaceServerData }

/** 未预载的正文命中先读完整详情；取消或资料快照变化时不写入新 scope。 */
export function createCommandNoteLoader(set: SetStore, get: GetStore, dependencies: WorkspaceDependencies) {
  return async ({ noteId, spaceId, isCurrent }: CommandNoteLoadInput): Promise<CommandNoteLoadResult | null> => {
    if (!isCurrent()) return null;
    const before = get();
    if (before.dataMode !== 'api' || before.workspaceLoadState !== 'ready') throw new Error('资料库尚未就绪，请重试加载。');
    if (!spaceId || before.serverData.currentSpaceId !== spaceId) throw new Error('搜索空间已切换，请重新搜索。');
    const current = before.serverData.notes.find(note => note.id === noteId);
    if (current) {
      if (current.deleted) throw new Error('这篇笔记已被删除，请重新搜索。');
      if (current.spaceId !== spaceId) throw new Error('笔记详情不属于当前空间，请重新搜索。');
      // 已预载的摘要沿用编辑路由的 loadNoteContent，已载正文与本地草稿保持原样。
      return { note: current, snapshot: before.serverData };
    }
    const stillCurrent = () => isCurrent() && get().serverData === before.serverData
      && get().dataMode === before.dataMode && get().workspaceLoadState === before.workspaceLoadState
      && get().knowledgeGeneration === before.knowledgeGeneration;
    let loaded: Note;
    try { loaded = await dependencies.api.getNote(noteId); }
    catch (error) { if (!stillCurrent()) return null; throw error; }
    if (!stillCurrent()) return null;
    if (!loaded || loaded.id !== noteId) throw new Error('笔记详情与搜索命中不一致，请重新搜索。');
    if (loaded.spaceId !== spaceId) throw new Error('笔记详情不属于当前空间，请重新搜索。');
    if (loaded.deleted) throw new Error('这篇笔记已被删除，请重新搜索。');
    if (loaded.deleted !== false || typeof loaded.rawMarkdown !== 'string' || typeof loaded.title !== 'string') {
      throw new Error('笔记详情不完整，请重试。');
    }
    updateWorkspaceNoteInStore(set, get, dependencies, { ...loaded, contentLoaded: true }, {}, { insertMissing: true });
    const snapshot = get().serverData;
    const note = snapshot.notes.find(note => note.id === noteId);
    return note ? { note, snapshot } : null;
  };
}
