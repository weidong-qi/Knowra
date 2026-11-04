import { flattenFolderTree, normalizeFolderTree, normalizeNotes } from '@study-accelerator/web-core';
import type { WorkspaceDependencies } from './types';
import { loadWorkspaceState, type GetStore, type SetStore } from './workspaceSnapshotState';

/** 每次重试或空间选择取得独立所有权；过期读取不能发布快照或解除新请求。 */
export function createWorkspaceLoadController(set: SetStore, get: GetStore, dependencies: WorkspaceDependencies) {
  let generation = 0;
  let active: { promise: Promise<void> } | null = null;

  function start(operation: (isCurrent: () => boolean) => Promise<void>): Promise<void> {
    const requestGeneration = ++generation;
    let resolve!: () => void;
    let reject!: (error: unknown) => void;
    const request = { promise: new Promise<void>((yes, no) => { resolve = yes; reject = no; }) };
    active = request;
    const isCurrent = () => generation === requestGeneration;
    void operation(isCurrent).finally(() => {
      if (active === request) active = null;
    }).then(resolve, reject);
    return request.promise;
  }

  return {
    isLoading: () => active !== null,
    generation: () => generation,
    load(force = false): Promise<void> {
      if (active && !force) return active.promise;
      const preferredSpaceId = get().serverData.currentSpaceId;
      return start(isCurrent => loadWorkspaceState(dependencies, set, preferredSpaceId, isCurrent));
    },
    async select(id: string): Promise<void> {
      if (!get().serverData.spaces.some(space => space.id === id)) throw new Error('目标空间不存在。');
      const previousSpaceId = get().serverData.currentSpaceId;
      return start(async isCurrent => {
        // 保留目标空间预读取：失败不提交目标空间，必要时恢复被中断的原空间加载。
        let resources;
        try { resources = await dependencies.api.loadWorkspaceResources(id); }
        catch (error) {
          if (!isCurrent()) return;
          // 切换取得所有权时可能打断了正在恢复的资料库；预读取失败仍需完成该加载。
          if (get().workspaceLoadState === 'loading') {
            await loadWorkspaceState(dependencies, set, previousSpaceId, isCurrent);
          }
          if (!isCurrent()) return;
          throw error;
        }
        if (!isCurrent()) return;
        const folderTree = normalizeFolderTree(resources.folderTree);
        set({ serverData: { ...get().serverData, currentSpaceId: id, folderTree, foldersById: flattenFolderTree(folderTree), notes: normalizeNotes(resources.notes), tags: resources.tags, tagGroups: resources.tagGroups ?? [] } });
        await loadWorkspaceState(dependencies, set, id, isCurrent);
      });
    }
  };
}
