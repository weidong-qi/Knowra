function normalizeComparableName(value) {
  return String(value ?? '').trim();
}

export function validateSiblingName({
  candidateName,
  siblingFolders = [],
  siblingNotes = [],
  currentFolderId = null,
  currentNoteId = null
}) {
  const candidate = normalizeComparableName(candidateName);
  if (!candidate) {
    return;
  }

  const conflictingFolder = siblingFolders.find((folder) => (
    folder.id !== currentFolderId
    && normalizeComparableName(folder.name) === candidate
  ));
  if (conflictingFolder) {
    throw new Error('A file or folder with the same name already exists');
  }

  const conflictingNote = siblingNotes.find((note) => (
    !note.deleted
    && note.id !== currentNoteId
    && normalizeComparableName(note.title) === candidate
  ));
  if (conflictingNote) {
    throw new Error('A file or folder with the same name already exists');
  }
}
