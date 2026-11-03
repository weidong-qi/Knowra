import { knowledgeBaseSeed } from '../../lib/mock-knowledge-base.js';
import { buildMockWorkspaceState } from '../../lib/mock-workspace.js';
import { flattenFolderTree } from '../../lib/tree-workspace.js';
import { createClearedNoteSideData } from '../../lib/sidebar/state.js';
import {
  createBackendSnapshot,
  mergeWorkspaceSnapshots,
  selectInitialWorkspaceSource,
  selectLoadRecovery
} from '../../lib/workspace-loading.js';
import {
  clearWorkspaceCache,
  readInitialWorkspaceSnapshot as readInitialWorkspaceSnapshotFromSource,
  readWorkspaceCache,
  writeWorkspaceCache
} from '../../lib/workspace-cache.js';
import {
  mergeNoteSummariesWithLoadedContent,
  normalizeFolderTree,
  normalizeNotes
} from '../../lib/workspace-normalization.js';
import {
  getHomeStatusMessage,
  getWorkDomainStatusMessage
} from '../../lib/status/messages.js';

export function createWorkspaceController(deps) {
  const {
    state,
    knowledgeApi,
    cacheKey,
    flashStatus,
    loadCurrentNoteSideData,
    loadLocalNoteSideData,
    persistScrollPositions,
    reconcileSelection,
    renderAll,
    saveCurrentEditorScrollPosition
  } = deps;

  const getStorage = () => deps.storage ?? globalThis.window?.localStorage;
  const getWindow = () => deps.browserWindow ?? globalThis.window;

function startWorkspaceLoad() {
  const initialSnapshot = readInitialWorkspaceSnapshot();
  const cachedSnapshot = readBackendCache();
  let startupSnapshot = mergeWorkspaceSnapshots(initialSnapshot, cachedSnapshot);

  if (selectInitialWorkspaceSource({ cachedSnapshot: startupSnapshot }) === 'cache') {
    state.dataMode = 'cache';
    state.statusMessage = initialSnapshot ? '后端资料已同步' : '正在同步后端资料...';
    try {
      loadCachedWorkspaceData(startupSnapshot);

      if (initialSnapshot) {
        persistBackendCache();
      }
    } catch (error) {
      clearBackendCache();
      startupSnapshot = null;
      resetWorkspaceDataForStartupRecovery();
      flashStatus('本地缓存已失效，正在重新加载资料...');
    }
  } else {
    renderAll();
  }

  void loadWorkspaceData({ cachedSnapshot: startupSnapshot });
}

function resetWorkspaceDataForStartupRecovery() {
  state.dataMode = 'loading';
  state.spaces = [];
  state.currentSpaceId = null;
  state.folderTree = [];
  state.foldersById = {};
  state.tags = [];
  state.allNotes = [];
  state.selectedFolderId = null;
  state.selectedNoteId = null;
  state.openFolders = {};
  state.openNoteTabs = [];
  Object.assign(state, createClearedNoteSideData());
  renderAll();
}

async function loadWorkspaceData({ cachedSnapshot = null } = {}) {
  let backendLoaded = false;

  try {
    const spaceId = await ensureSpaceId();
    await refreshKnowledgeData(spaceId);
    state.dataMode = 'api';
    backendLoaded = true;
    persistBackendCache();
    renderAll();
    flashStatus(resolveWorkspaceStatusMessage(state, '知识库已连接到后端数据'));
  } catch (error) {
    const recoverySnapshot = cachedSnapshot ?? readBackendCache();
    const recoveryMode = selectLoadRecovery({
      backendAvailable: backendLoaded,
      cachedSnapshot: recoverySnapshot
    });

    if (recoveryMode === 'cache') {
      try {
        loadCachedWorkspaceData(recoverySnapshot);
        state.dataMode = 'cache';
        flashStatus('后端暂时不可用，已显示最近一次成功加载的资料');
        return;
      } catch (cacheError) {
        clearBackendCache();
        resetWorkspaceDataForStartupRecovery();
      }
    }

    loadMockWorkspaceData();
    state.dataMode = 'local';
    flashStatus('未检测到后端，已切换到前端本地演示模式');
  }
}

function resolveWorkspaceStatusMessage(state, fallback) {
  const domain = state.navigation?.activeWorkDomain;
  if (domain === 'materials' && state.view?.screen === 'home') {
    return getHomeStatusMessage();
  }
  if (domain && domain !== 'materials') {
    return getWorkDomainStatusMessage(domain);
  }
  return fallback;
}

async function ensureSpaceId() {
  const spaces = await knowledgeApi.listKnowledgeSpaces();

  if (spaces.length > 0) {
    state.spaces = spaces;
    state.currentSpaceId = spaces[0].id;
    return state.currentSpaceId;
  }

  const createdSpace = await knowledgeApi.createDefaultKnowledgeSpace();
  state.spaces = [createdSpace];
  state.currentSpaceId = createdSpace.id;
  return state.currentSpaceId;
}

async function refreshKnowledgeData(spaceId = state.currentSpaceId) {
  const resources = await knowledgeApi.loadWorkspaceResources(spaceId);

  state.folderTree = normalizeFolderTree(resources.folderTree);
  state.foldersById = flattenFolderTree(state.folderTree);
  state.tags = resources.tags;
  state.allNotes = mergeNoteSummariesWithLoadedContent(resources.notes, state.allNotes);
  state.openFolders = {
    ...Object.fromEntries(Object.keys(state.foldersById).map((folderId) => [folderId, true])),
    ...state.openFolders
  };

  reconcileSelection();
  await loadCurrentNoteSideData();
  renderAll();
}

function persistBackendCache() {
  const storage = getStorage();
  if (!storage) {
    return;
  }

  writeWorkspaceCache(storage, cacheKey, createBackendSnapshot(state));
  saveCurrentEditorScrollPosition();
  persistScrollPositions();
}

function readBackendCache() {
  const storage = getStorage();
  return storage ? readWorkspaceCache(storage, cacheKey) : null;
}

function clearBackendCache() {
  const storage = getStorage();
  if (storage) {
    clearWorkspaceCache(storage, cacheKey);
  }
}

function readInitialWorkspaceSnapshot() {
  return readInitialWorkspaceSnapshotFromSource(getWindow());
}

function loadCachedWorkspaceData(snapshot) {
  state.spaces = Array.isArray(snapshot.spaces) ? snapshot.spaces : [];
  state.currentSpaceId = snapshot.currentSpaceId ?? null;
  state.folderTree = normalizeFolderTree(snapshot.folderTree ?? []);
  state.foldersById = flattenFolderTree(state.folderTree);
  state.tags = Array.isArray(snapshot.tags) ? snapshot.tags : [];
  state.allNotes = normalizeNotes(snapshot.allNotes ?? []);
  state.openFolders = {
    ...Object.fromEntries(Object.keys(state.foldersById).map((folderId) => [folderId, true])),
    ...(snapshot.openFolders ?? {})
  };
  state.openNoteTabs = Array.isArray(snapshot.openNoteTabs) ? snapshot.openNoteTabs : [];
  state.selectedFolderId = snapshot.selectedFolderId ?? null;
  state.selectedNoteId = snapshot.selectedNoteId ?? null;
  reconcileSelection();
  loadLocalNoteSideData(state.selectedNoteId);
  renderAll();
}

function loadMockWorkspaceData() {
  const mockState = buildMockWorkspaceState(knowledgeBaseSeed);
  state.spaces = mockState.spaces;
  state.currentSpaceId = mockState.currentSpaceId;
  state.folderTree = mockState.folderTree;
  state.foldersById = mockState.foldersById;
  state.tags = mockState.tags;
  state.allNotes = normalizeNotes(mockState.allNotes);
  state.openFolders = mockState.openFolders;

  reconcileSelection();
  loadLocalNoteSideData(state.selectedNoteId);
  renderAll();
}

  return {
    startWorkspaceLoad,
    resetWorkspaceDataForStartupRecovery,
    loadWorkspaceData,
    ensureSpaceId,
    refreshKnowledgeData,
    persistBackendCache,
    readBackendCache,
    readInitialWorkspaceSnapshot,
    loadCachedWorkspaceData,
    loadMockWorkspaceData
  };
}
