import { Note } from '../../domain/note.ts';
import { buildUpdateNoteDto } from '../dto/note.dto.ts';
import { validationError } from '../knowledge-errors.js';

export function createAsyncNoteAssociationOperations({
  repository,
  requireNote,
  requireNoteIds,
  assertReferences,
  normalizeTagIds
}) {
  async function saveWithChanges(note, changes) {
    return repository.save(
      new Note({
        ...note,
        ...changes,
        createdAt: note.createdAt,
        updatedAt: new Date().toISOString()
      })
    );
  }

  function normalizeTagId(tagId) {
    const normalized = typeof tagId === 'string' ? tagId.trim() : '';
    if (!normalized) throw validationError('NOTE_TAG_REQUIRED', 'tagId is required');
    return normalized;
  }

  async function assignTagToNote(noteId, tagId) {
    const currentNote = await requireNote(noteId, { includeDeleted: true });
    const normalizedTagId = normalizeTagId(tagId);
    const tagIds = await normalizeTagIds([...currentNote.tagIds, normalizedTagId]);
    await assertReferences({ ...currentNote, tagIds });
    return saveWithChanges(currentNote, { tagIds });
  }

  return {
    assignTagToNote,
    async assignTagToNotes(noteIds, tagId) {
      const normalizedTagId = normalizeTagId(tagId);
      const validatedIds = requireNoteIds(noteIds);
      const notes = await Promise.all(validatedIds.map(id => requireNote(id, { includeDeleted: true })));
      await Promise.all(
        notes.map(async note =>
          assertReferences({
            ...note,
            tagIds: await normalizeTagIds([...note.tagIds, normalizedTagId])
          })
        )
      );
      return Promise.all(validatedIds.map(id => assignTagToNote(id, normalizedTagId)));
    },
    async removeTagFromNote(noteId, tagId) {
      const currentNote = await requireNote(noteId, { includeDeleted: true });
      return saveWithChanges(currentNote, {
        tagIds: currentNote.tagIds.filter(currentTagId => currentTagId !== tagId)
      });
    },
    async clearFolderFromNotes(folderId) {
      const notes = (await repository.list({ includeDeleted: true })).filter(note => note.folderId === folderId);
      return Promise.all(notes.map(note => saveWithChanges(note, { folderId: null })));
    },
    async removeTagFromAllNotes(tagId) {
      const notes = (await repository.list({ includeDeleted: true })).filter(note => note.tagIds.includes(tagId));
      return Promise.all(
        notes.map(note =>
          saveWithChanges(note, {
            tagIds: note.tagIds.filter(currentTagId => currentTagId !== tagId)
          })
        )
      );
    },
    async replaceTagInAllNotes(sourceTagId, targetTagId) {
      const notes = (await repository.list({ includeDeleted: true })).filter(note => note.tagIds.includes(sourceTagId));
      return Promise.all(
        notes.map(async note =>
          saveWithChanges(note, {
            tagIds: await normalizeTagIds(note.tagIds.map(id => (id === sourceTagId ? targetTagId : id)))
          })
        )
      );
    },
    async updateTagsForNotes(noteIds, addTagIds = [], removeTagIds = []) {
      const validatedIds = requireNoteIds(noteIds);
      return Promise.all(
        validatedIds.map(async noteId => {
          const note = await requireNote(noteId, { includeDeleted: true });
          const removed = new Set(removeTagIds);
          const tagIds = await normalizeTagIds([...note.tagIds.filter(id => !removed.has(id)), ...addTagIds]);
          await assertReferences({ ...note, tagIds });
          return saveWithChanges(note, { tagIds });
        })
      );
    },
    async setNoteTags(noteId, tagIds) {
      const currentNote = await requireNote(noteId, { includeDeleted: true });
      const dto = buildUpdateNoteDto({ tagIds });
      const normalizedTagIds = await normalizeTagIds(dto.tagIds);
      await assertReferences({ ...currentNote, tagIds: normalizedTagIds });
      return saveWithChanges(currentNote, { tagIds: normalizedTagIds });
    }
  };
}
