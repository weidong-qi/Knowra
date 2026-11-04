export const BACKEND_CACHE_KEY = 'study-accelerator.backend-workspace-cache';
export const AUTOSAVE_DELAY_MS = 700;
export const SEARCH_DEBOUNCE_DELAY_MS = 180;
export const SCROLL_POSITIONS_KEY = 'study-accelerator.editor-scroll-positions';

export function createInitialAppState() {
  return {
    dataMode: 'loading',
    spaces: [],
    currentSpaceId: null,
    navigation: {
      activeWorkDomain: 'materials',
      activeDomainView: 'overview'
    },
    folderTree: [],
    foldersById: {},
    allNotes: [],
    tags: [],
    selectedNoteId: null,
    selectedFolderId: null,
    navSections: {
      materials: true,
      favorites: false,
      recent: false,
      recycle: false
    },
    secondarySections: {
      favorites: true,
      recent: true,
      recycle: true
    },
    asideTab: 'info',
    openFolders: {},
    draftMarkdown: '',
    draftTitle: '',
    search: {
      keyword: '',
      selectedTagIds: [],
      matchingNoteIds: null,
      isOpen: false
    },
    noteTagComposer: {
      draft: '',
      isExpanded: false
    },
    linkedNotes: [],
    attachments: [],
    attachmentRenaming: null,
    annotations: [],
    annotationLoadState: 'idle',
    noteVersions: [],
    knowledgeItems: [],
    learningObjectives: [],
    questions: [],
    knowledgeDomainLoadState: 'idle',
    knowledgeWorkspace: {
      filters: {
        query: '',
        reviewStatus: 'all',
        knowledgeType: 'all',
        evidenceStatus: 'all',
        actionVerb: 'all',
        cognitiveLevel: 'all',
        missingObjectives: false,
        missingQuestions: false,
        hasQuestions: 'all'
      },
      selection: { kind: null, id: null },
      loadState: 'idle',
      overview: null,
      items: [],
      objectives: [],
      reviewQueue: [],
      pagination: null,
      error: null,
      drafts: {}
    },
    trainingWorkspace: {
      filters: {
        query: '',
        questionType: 'all',
        reviewStatus: 'all',
        difficulty: 'all',
        sourceStatus: 'all',
        learningObjectiveId: 'all'
      },
      selection: { kind: null, id: null },
      loadState: 'idle',
      overview: null,
      questions: [],
      profiles: [],
      objectiveOptions: [],
      pagination: null,
      error: null,
      drafts: {}
    },
    focusedAnnotationId: null,
    annotationFilter: { query: '', status: 'active' },
    outlineCollapsedHeadingIdsByNote: {},
    expandedAnnotationIds: {},
    openNoteTabs: [],
    editorMenuOpen: null,
    view: {
      screen: 'home',
      mode: 'edit',
      modeBeforeFocus: null,
      showLeftSidebar: true,
      showRightSidebar: true,
      showSourceEditor: false
    },
    libraryIndex: {
      tab: 'all',
      page: 1,
      pageSize: 10,
      selectedNoteId: null,
      inspectorOpen: true,
      directoryOpen: true,
      localKeyword: '',
      filterMenu: null,
      filters: {
        type: 'all',
        status: 'all',
        time: 'updated-desc'
      }
    },
    editorPanel: {
      open: false,
      mode: null,
      query: '',
      replacement: '',
      matchIndex: -1,
      matchCount: 0,
      autoFocusInput: false
    },
    editorTableDialog: {
      open: false,
      rows: '4',
      cols: '3',
      autoFocusInput: false
    },
    sectionMenuOpen: false,
    contextMenu: {
      open: false,
      x: 0,
      y: 0,
      targetKind: null,
      targetId: null
    },
    tabMenu: {
      open: false,
      x: 0,
      y: 0,
      noteId: null
    },
    tabOverflowMenuOpen: false,
    editorContextMenu: {
      open: false,
      x: 0,
      y: 0
    },
    treeEditor: null,
    deleteIntent: null,
    dragState: {
      activeKind: null,
      activeId: null,
      overKind: null,
      overId: null
    },
    tabDragState: {
      activeId: null,
      overId: null
    },
    saveState: 'idle',
    lastSavedAt: null,
    statusMessage: '正在加载资料工作台...'
  };
}

export function createRailItems() {
  return [
    { key: 'materials', active: true },
    { key: 'knowledge', active: false },
    { key: 'training', active: false },
    { key: 'learning', active: false }
  ];
}
