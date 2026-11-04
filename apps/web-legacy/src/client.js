import {
  AUTOSAVE_DELAY_MS,
  BACKEND_CACHE_KEY,
  SEARCH_DEBOUNCE_DELAY_MS,
  SCROLL_POSITIONS_KEY,
  createInitialAppState,
  createRailItems
} from './app/app-state.js';
import { createAppStateActions } from './app/app-state-actions.js';
import { assignWorkspaceElements } from './app/element-cache.js';
import { createEditorRuntime } from './app/editor-runtime.js';
import { escapeAttribute, escapeHtml, formatDate } from './app/formatting.js';
import { createAppControllers } from './controllers/app-controller-registry.js';
import { createControllerActionProxies } from './controllers/controller-action-proxies.js';
import { bindAppEvents } from './controllers/event-bindings-controller.js';
import { knowledgeApi } from './services/knowledge-api.js';

const state = createInitialAppState();
const railItems = createRailItems();
const elements = {};
const editorRuntime = createEditorRuntime();
const controllers = {
  navigationController: null,
  editorController: null,
  annotationController: null,
  assessmentController: null,
  sidebarController: null,
  searchController: null,
  tagController: null,
  tabController: null,
  workspaceController: null,
  shellController: null,
  scrollController: null,
  knowledgeWorkspaceController: null,
  trainingWorkspaceController: null,
  workDomainController: null
};

const actions = createControllerActionProxies(() => controllers);
const stateActions = createAppStateActions({
  state,
  getVisibleNotes: actions.getVisibleNotes,
  clearNoteSideData: actions.clearNoteSideData,
  loadLocalNoteSideData: actions.loadLocalNoteSideData,
  persistBackendCache: actions.persistBackendCache,
  renderAll: actions.renderAll,
  renderStatus: actions.renderStatus
});

initialize();

function initialize() {
  cacheElements();
  createControllers();
  bindRuntimeErrorHandlers();
  actions.renderRail();
  bindEvents();

  // 读取本地保存的编辑器滚动位置
  actions.loadScrollPositions();

  actions.startWorkspaceLoad();
}

function cacheElements() {
  assignWorkspaceElements(elements);
}

function createControllers() {
  Object.assign(controllers, createAppControllers({
    state,
    elements,
    editorRuntime,
    knowledgeApi,
    controllerActions: actions,
    constants: {
      autosaveDelayMs: AUTOSAVE_DELAY_MS,
      backendCacheKey: BACKEND_CACHE_KEY,
      searchDebounceDelayMs: SEARCH_DEBOUNCE_DELAY_MS,
      scrollPositionsKey: SCROLL_POSITIONS_KEY
    },
    helpers: {
      railItems,
      getActiveNotes: stateActions.getActiveNotes,
      getRecycleNotes: stateActions.getRecycleNotes,
      getNoteById: stateActions.getNoteById,
      noteMatchesSelectedTags: actions.noteMatchesSelectedTags,
      matchesSearch: actions.matchesSearch,
      matchesFolderSearch: actions.matchesFolderSearch,
      getCurrentNote: stateActions.getCurrentNote,
      getVisibleNotes: actions.getVisibleNotes,
      getEffectiveViewState: actions.getEffectiveViewState,
      reconcileSelection: stateActions.reconcileSelection,
      replaceNoteInState: stateActions.replaceNoteInState,
      refreshKnowledgeData: actions.refreshKnowledgeData,
      loadCurrentNoteSideData: actions.loadCurrentNoteSideData,
      loadLocalNoteSideData: actions.loadLocalNoteSideData,
      clearNoteSideData: actions.clearNoteSideData,
      syncLocalWorkspace: stateActions.syncLocalWorkspace,
      saveCurrentEditorScrollPosition: actions.saveCurrentEditorScrollPosition,
      persistScrollPositions: actions.persistScrollPositions,
      persistBackendCache: actions.persistBackendCache,
      persistDraft: actions.persistDraft,
      renderAll: actions.renderAll,
      renderFolders: actions.renderFolders,
      renderEditor: actions.renderEditor,
      renderEditorContextMenu: actions.renderEditorContextMenu,
      renderEditorMenuBar: actions.renderEditorMenuBar,
      renderSearchShell: actions.renderSearchShell,
      renderSidebar: actions.renderSidebar,
      renderStatus: actions.renderStatus,
      renderTabs: actions.renderTabs,
      openFolderBranch: actions.openFolderBranch,
      closeContextMenu: actions.closeContextMenu,
      closeSectionMenu: actions.closeSectionMenu,
      closeTabMenu: actions.closeTabMenu,
      selectNote: actions.selectNote,
      createAnnotationFromCurrentSelection: actions.createAnnotationFromCurrentSelection,
      syncAnnotationMarkers: actions.syncAnnotationMarkers,
      reportRuntimeError,
      flashStatus: stateActions.flashStatus,
      formatDate,
      escapeHtml,
      escapeAttribute
    }
  }));
}

function bindRuntimeErrorHandlers() {
  window.addEventListener('error', (event) => {
    reportRuntimeError('runtime', event.error || event.message);
  });
  window.addEventListener('unhandledrejection', (event) => {
    reportRuntimeError('promise', event.reason);
  });
}

function reportRuntimeError(scope, error) {
  const message = error?.message || String(error || '未知错误');
  state.statusMessage = `前端运行异常（${scope}）：${message}`;
  actions.renderStatus();
  console.error(`[study:${scope}]`, error);
}

function bindEvents() {
  bindAppEvents({
    state,
    elements,
    editorRuntime,
    controllers,
    helpers: {
      getCurrentNote: stateActions.getCurrentNote,
      reconcileSelection: stateActions.reconcileSelection,
      flashStatus: stateActions.flashStatus
    }
  });
}
