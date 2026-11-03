function updateNoteById(notes, noteId, updater) {
  return (notes ?? []).map((note) => (
    note.id === noteId
      ? updater(note)
      : note
  ));
}

export function createLocalManualNoteInput({
  title,
  folderId = null,
  spaceId = null,
  id = `note-${Date.now().toString(36)}`,
  updatedAt = new Date().toISOString()
}) {
  return {
    id,
    title,
    rawMarkdown: '',
    folderId,
    spaceId,
    favorite: false,
    status: 'draft',
    sourceType: 'manual',
    tagIds: [],
    internalLinks: [],
    updatedAt
  };
}

export function createLocalImportedNoteInput({
  item,
  folderId = null,
  spaceId = null,
  updatedAt = new Date().toISOString()
}) {
  return {
    id: item.id,
    title: item.title,
    rawMarkdown: item.rawMarkdown,
    folderId,
    spaceId,
    favorite: false,
    status: 'draft',
    sourceType: item.sourceType,
    tagIds: [],
    internalLinks: [],
    updatedAt
  };
}

export function renameLocalNote(notes, noteId, title, timestamp = new Date().toISOString()) {
  return updateNoteById(notes, noteId, (note) => ({
    ...note,
    title,
    updatedAt: timestamp
  }));
}

export function softDeleteLocalNote(notes, noteId, timestamp = new Date().toISOString()) {
  return updateNoteById(notes, noteId, (note) => ({
    ...note,
    deleted: true,
    updatedAt: timestamp
  }));
}

export function permanentlyDeleteLocalNote(notes, noteId) {
  return (notes ?? []).filter((note) => note.id !== noteId);
}

export function restoreLocalNote(notes, noteId, timestamp = new Date().toISOString()) {
  return updateNoteById(notes, noteId, (note) => ({
    ...note,
    deleted: false,
    updatedAt: timestamp
  }));
}

export function emptyLocalRecycleBin(notes) {
  return (notes ?? []).filter((note) => !note.deleted);
}

export function setLocalNoteFavorite(notes, noteId, favorite, timestamp = new Date().toISOString()) {
  return updateNoteById(notes, noteId, (note) => ({
    ...note,
    favorite: Boolean(favorite),
    updatedAt: timestamp
  }));
}

export function moveLocalNoteToFolder(notes, noteId, folderId, timestamp = new Date().toISOString()) {
  return updateNoteById(notes, noteId, (note) => ({
    ...note,
    folderId,
    updatedAt: timestamp
  }));
}
