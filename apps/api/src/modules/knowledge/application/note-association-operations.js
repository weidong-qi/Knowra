import { Note } from '../domain/note.ts';
import { buildUpdateNoteDto } from './dto/note.dto.ts';
import { validationError } from './knowledge-errors.js';

export function createNoteAssociationOperations({
  repository,
  requireNote,
  requireNoteIds,
  assertReferences,
  normalizeTagIds
}) {
  function saveWithChanges(note, changes) {
    const updatedNote = new Note({
      ...note,
      ...changes,
      createdAt: note.createdAt,
      updatedAt: new Date().toISOString()
    });
    repository.save(updatedNote);
    return updatedNote;
  }

  function normalizeTagId(tagId) {
    const normalized = typeof tagId === 'string' ? tagId.trim() : '';
    if (!normalized) {
      throw validationError('NOTE_TAG_REQUIRED', 'tagId is required');
    }
    return normalized;
  }

  function assignTagToNote(noteId, tagId) {
    const currentNote = requireNote(noteId, { includeDeleted: true });
    const normalizedTagId = normalizeTagId(tagId);
    const tagIds = normalizeTagIds([...currentNote.tagIds, normalizedTagId]);
    assertReferences({ ...currentNote, tagIds });
    return saveWithChanges(currentNote, { tagIds });
  }

  return {
    assignTagToNote,
    assignTagToNotes(noteIds, tagId) {
      const normalizedTagId = normalizeTagId(tagId);
      const validatedIds = requireNoteIds(noteIds);
      validatedIds.forEach(noteId => {
        const note = requireNote(noteId, { includeDeleted: true });
        assertReferences({
          ...note,
          tagIds: normalizeTagIds([...note.tagIds, normalizedTagId])
        });
      });
      return validatedIds.map(noteId => assignTagToNote(noteId, normalizedTagId));
    },
    removeTagFromNote(noteId, tagId) {
      const currentNote = requireNote(noteId, { includeDeleted: true });
      return saveWithChanges(currentNote, {
        tagIds: currentNote.tagIds.filter(currentTagId => currentTagId !== tagId)
      });
    },
    clearFolderFromNotes(folderId) {
      return repository
        .list({ includeDeleted: true })
        .filter(note => note.folderId === folderId)
        .map(note => saveWithChanges(note, { folderId: null }));
    },
    removeTagFromAllNotes(tagId) {
      return repository
        .list({ includeDeleted: true })
        .filter(note => note.tagIds.includes(tagId))
        .map(note =>
          saveWithChanges(note, {
            tagIds: note.tagIds.filter(currentTagId => currentTagId !== tagId)
          })
        );
    },
    replaceTagInAllNotes(sourceTagId, targetTagId) {
      return repository
        .list({ includeDeleted: true })
        .filter(note => note.tagIds.includes(sourceTagId))
        .map(note =>
          saveWithChanges(note, {
            tagIds: normalizeTagIds(note.tagIds.map(id => (id === sourceTagId ? targetTagId : id)))
          })
        );
    },
    updateTagsForNotes(noteIds, addTagIds = [], removeTagIds = []) {
      const validatedIds = requireNoteIds(noteIds);
      return validatedIds.map(noteId => {
        const note = requireNote(noteId, { includeDeleted: true });
        const removed = new Set(removeTagIds);
        const tagIds = normalizeTagIds([...note.tagIds.filter(id => !removed.has(id)), ...addTagIds]);
        assertReferences({ ...note, tagIds });
        return saveWithChanges(note, { tagIds });
      });
    },
    setNoteTags(noteId, tagIds) {
      const currentNote = requireNote(noteId, { includeDeleted: true });
      const dto = buildUpdateNoteDto({ tagIds });
      const normalizedTagIds = normalizeTagIds(dto.tagIds);
      assertReferences({ ...currentNote, tagIds: normalizedTagIds });
      return saveWithChanges(currentNote, { tagIds: normalizedTagIds });
    }
  };
}
