import type { PostgresRepositories } from './service-dependencies.ts';
type NoteRecord = Awaited<ReturnType<PostgresRepositories['noteRepository']['list']>>[number];
type NoteChanges = { folderId?: string | null; tagIds?: unknown[] };
type NoteReferences = Omit<NoteRecord, 'tagIds'> & { tagIds: unknown[] };
interface NoteAssociationDependencies {
  repository: Pick<PostgresRepositories['noteRepository'], 'list' | 'save'>;
  requireNote(id: string, options: { includeDeleted: boolean }): Promise<NoteRecord>;
  requireNoteIds(ids: unknown): string[];
  assertReferences(note: NoteReferences): Promise<void>;
  normalizeTagIds(ids: unknown[] | undefined): Promise<unknown[]>;
}
import { Note } from '../../domain/note.ts';
import { buildUpdateNoteDto } from '../dto/note.dto.ts';
import { validationError } from '../knowledge-errors.ts';

export function createAsyncNoteAssociationOperations({
  repository,
  requireNote,
  requireNoteIds,
  assertReferences,
  normalizeTagIds
}: NoteAssociationDependencies) {
  async function saveWithChanges(note: NoteRecord, changes: NoteChanges) {
    return repository.save(
      new Note({
        ...note,
        ...changes,
        createdAt: note.createdAt,
        updatedAt: new Date().toISOString()
      })
    );
  }

  function normalizeTagId(tagId: unknown) {
    const normalized = typeof tagId === 'string' ? tagId.trim() : '';
    if (!normalized) throw validationError('NOTE_TAG_REQUIRED', 'tagId is required');
    return normalized;
  }

  async function assignTagToNote(noteId: string, tagId: unknown) {
    const currentNote = await requireNote(noteId, { includeDeleted: true });
    const normalizedTagId = normalizeTagId(tagId);
    const tagIds = await normalizeTagIds([...currentNote.tagIds!, normalizedTagId]);
    await assertReferences({ ...currentNote, tagIds });
    return saveWithChanges(currentNote, { tagIds });
  }

  return {
    assignTagToNote,
    async assignTagToNotes(noteIds: unknown, tagId: unknown) {
      const normalizedTagId = normalizeTagId(tagId);
      const validatedIds = requireNoteIds(noteIds);
      const notes = await Promise.all(validatedIds.map(id => requireNote(id, { includeDeleted: true })));
      await Promise.all(
        notes.map(async note =>
          assertReferences({
            ...note,
            tagIds: await normalizeTagIds([...note.tagIds!, normalizedTagId])
          })
        )
      );
      return Promise.all(validatedIds.map(id => assignTagToNote(id, normalizedTagId)));
    },
    async removeTagFromNote(noteId: string, tagId: string) {
      const currentNote = await requireNote(noteId, { includeDeleted: true });
      return saveWithChanges(currentNote, {
        tagIds: currentNote.tagIds!.filter(currentTagId => currentTagId !== tagId)
      });
    },
    async clearFolderFromNotes(folderId: string) {
      const notes = (await repository.list({ includeDeleted: true })).filter(note => note.folderId === folderId);
      return Promise.all(notes.map(note => saveWithChanges(note, { folderId: null })));
    },
    async removeTagFromAllNotes(tagId: string) {
      const notes = (await repository.list({ includeDeleted: true })).filter(note => note.tagIds!.includes(tagId));
      return Promise.all(
        notes.map(note =>
          saveWithChanges(note, {
            tagIds: note.tagIds!.filter(currentTagId => currentTagId !== tagId)
          })
        )
      );
    },
    async replaceTagInAllNotes(sourceTagId: string, targetTagId: string) {
      const notes = (await repository.list({ includeDeleted: true })).filter(note =>
        note.tagIds!.includes(sourceTagId)
      );
      return Promise.all(
        notes.map(async note =>
          saveWithChanges(note, {
            tagIds: await normalizeTagIds(note.tagIds!.map(id => (id === sourceTagId ? targetTagId : id)))
          })
        )
      );
    },
    async updateTagsForNotes(noteIds: unknown, addTagIds: string[] = [], removeTagIds: string[] = []) {
      const validatedIds = requireNoteIds(noteIds);
      return Promise.all(
        validatedIds.map(async noteId => {
          const note = await requireNote(noteId, { includeDeleted: true });
          const removed = new Set(removeTagIds);
          const tagIds = await normalizeTagIds([...note.tagIds!.filter(id => !removed.has(id)), ...addTagIds]);
          await assertReferences({ ...note, tagIds });
          return saveWithChanges(note, { tagIds });
        })
      );
    },
    async setNoteTags(noteId: string, tagIds: unknown) {
      const currentNote = await requireNote(noteId, { includeDeleted: true });
      const dto = buildUpdateNoteDto({ tagIds });
      const normalizedTagIds = await normalizeTagIds(dto.tagIds);
      await assertReferences({ ...currentNote, tagIds: normalizedTagIds });
      return saveWithChanges(currentNote, { tagIds: normalizedTagIds });
    }
  };
}
