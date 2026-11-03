import { ensureOpenTab } from '../editor/tab-workspace.js';

export function toggleFolderOpen(openFolders = {}, folderId) {
  if (!folderId) {
    return { ...openFolders };
  }

  return {
    ...openFolders,
    [folderId]: !(openFolders[folderId] ?? true)
  };
}

export function openFolderBranch({ openFolders = {}, foldersById = {}, folderId = null } = {}) {
  const nextOpenFolders = { ...openFolders };
  let cursor = folderId ? foldersById[folderId] ?? null : null;

  while (cursor) {
    nextOpenFolders[cursor.id] = true;
    cursor = cursor.parentId ? foldersById[cursor.parentId] ?? null : null;
  }

  return nextOpenFolders;
}

export function buildFolderPath({ folderId = null, foldersById = {}, rootLabel = '资料', emptyLabel = '未分类' } = {}) {
  const rootSegment = String(rootLabel ?? '').trim();
  const emptySegment = String(emptyLabel ?? '').trim();

  if (!folderId) {
    return [rootSegment, emptySegment].filter(Boolean).join(' / ');
  }

  const segments = [];
  let currentFolder = foldersById[folderId] ?? null;

  while (currentFolder) {
    segments.unshift(currentFolder.name);
    currentFolder = currentFolder.parentId ? foldersById[currentFolder.parentId] ?? null : null;
  }

  if (!segments.length) {
    return [rootSegment, emptySegment].filter(Boolean).join(' / ');
  }

  return [rootSegment, ...segments].filter(Boolean).join(' / ');
}

export function buildNotePath({ note = null, foldersById = {}, rootLabel = '资料库' } = {}) {
  if (!note) {
    return '';
  }

  const folderPath = buildFolderPath({
    folderId: note.folderId,
    foldersById,
    rootLabel: '',
    emptyLabel: ''
  });
  const noteTitle = String(note.title ?? '').trim();
  return [String(rootLabel ?? '').trim(), folderPath, noteTitle].filter(Boolean).join(' / ');
}

export function resolveNavigationSelection({
  selectedFolderId = null,
  foldersById = {},
  activeNotes = [],
  visibleNotes = [],
  selectedNoteId = null,
  openNoteTabs = []
} = {}) {
  const nextSelectedFolderId = selectedFolderId && !foldersById[selectedFolderId]
    ? null
    : selectedFolderId;
  const existingNoteIds = new Set(activeNotes.map((note) => note.id));
  const filteredTabs = openNoteTabs.filter((noteId) => existingNoteIds.has(noteId));

  if (visibleNotes.length === 0) {
    return {
      selectedFolderId: nextSelectedFolderId,
      selectedNoteId: null,
      openNoteTabs: [],
      draftMarkdown: '',
      draftTitle: '',
      noteTagDraft: '',
      saveState: 'idle',
      lastSavedAt: null,
      shouldClearSideData: true
    };
  }

  const currentNoteStillVisible = visibleNotes.some((note) => note.id === selectedNoteId);
  const selectedNote = currentNoteStillVisible
    ? visibleNotes.find((note) => note.id === selectedNoteId)
    : visibleNotes[0];

  return {
    selectedFolderId: nextSelectedFolderId,
    selectedNoteId: selectedNote?.id ?? null,
    openNoteTabs: ensureOpenTab(filteredTabs, selectedNote?.id ?? null),
    draftMarkdown: selectedNote?.rawMarkdown ?? '',
    draftTitle: selectedNote?.title ?? '',
    noteTagDraft: currentNoteStillVisible ? undefined : '',
    saveState: selectedNote ? 'saved' : 'idle',
    lastSavedAt: selectedNote?.updatedAt ?? null,
    shouldClearSideData: false
  };
}

export function resolveFolderSelection({
  folderId = null,
  selectedNoteId = null,
  visibleNotes = [],
  openNoteTabs = []
} = {}) {
  if (visibleNotes.length === 0) {
    return {
      selectedFolderId: folderId,
      selectedNoteId: null,
      openNoteTabs,
      draftMarkdown: '',
      draftTitle: '',
      shouldClearSideData: true,
      shouldLoadSideData: false
    };
  }

  const currentNoteStillVisible = visibleNotes.some((note) => note.id === selectedNoteId);
  if (currentNoteStillVisible) {
    return {
      selectedFolderId: folderId,
      selectedNoteId,
      openNoteTabs,
      shouldClearSideData: false,
      shouldLoadSideData: false
    };
  }

  const nextNote = visibleNotes[0];
  return {
    selectedFolderId: folderId,
    selectedNoteId: nextNote.id,
    openNoteTabs: ensureOpenTab(openNoteTabs, nextNote.id),
    draftMarkdown: nextNote.rawMarkdown ?? '',
    draftTitle: nextNote.title ?? '',
    shouldClearSideData: false,
    shouldLoadSideData: true
  };
}
