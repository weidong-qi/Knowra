import { prepareAnnotationChange } from './annotation-change-context.js';
import { Note } from '../domain/note.js';
import { buildCreateNoteDto, buildUpdateNoteDto } from './dto/note.dto.js';
import { createNoteSummary } from './note-summary.js';
import { createInMemoryNoteRepository } from '../infrastructure/note-repository.js';
import { conflictError, notFoundError, validationError } from './knowledge-errors.js';
import { createNoteAssociationOperations } from './note-association-operations.js';
import { addedNoteLinkTargets, assertNoteLinkTarget, buildNoteLinkRelations } from './note-link-relations.js';

export function createNoteService({
  repository = createInMemoryNoteRepository(),
  validateSiblingNameConflict = null,
  validateNoteReferences = null,
  normalizeTagIds = tagIds => [...new Set(tagIds)],
  noteVersionService = null,
  annotationRepository = null,
  runTransaction = operation => operation(),
  onNoteContentChanged = null,
  onNoteDeleted = null,
  onBeforePermanentDelete = null
} = {}) {
  function persistNote(note, { createVersion = false, annotationChange = null } = {}) {
    return runTransaction(() => {
      const saved = repository.save(note);
      if (createVersion && noteVersionService) {
        const version = noteVersionService.ensureForNote(saved);
        onNoteContentChanged?.(saved, version, annotationChange);
      }
      return saved;
    });
  }
  function requireNote(noteId, options = {}) {
    const note = repository.findById(noteId);

    if (!note) {
      throw notFoundError('NOTE_NOT_FOUND', 'Note not found');
    }

    if (note.deleted && !options.includeDeleted) {
      throw notFoundError('NOTE_NOT_FOUND', 'Note not found');
    }

    return note;
  }

  function requireNoteIds(noteIds) {
    if (!Array.isArray(noteIds) || noteIds.length === 0) {
      throw validationError('NOTE_IDS_REQUIRED', 'noteIds must contain at least one note id');
    }

    return noteIds;
  }

  function assertNewNoteId(noteId) {
    if (repository.findById(noteId)) {
      throw conflictError('NOTE_ID_CONFLICT', 'A note with the same id already exists');
    }
  }

  function assertReferences(note) {
    validateNoteReferences?.({
      spaceId: note.spaceId,
      folderId: note.folderId ?? null,
      tagIds: note.tagIds ?? []
    });
  }

  function assertPermanentDeletionAllowed(noteIds) {
    noteIds.forEach(noteId => onBeforePermanentDelete?.(noteId));
  }

  const associationOperations = createNoteAssociationOperations({
    repository,
    requireNote,
    requireNoteIds,
    assertReferences,
    normalizeTagIds
  });

  return {
    createNote(input) {
      const dto = buildCreateNoteDto(input);
      addedNoteLinkTargets(dto.rawMarkdown).forEach(id => assertNoteLinkTarget(repository.findById(id), dto.spaceId));
      assertNewNoteId(dto.id);
      assertReferences(dto);
      validateSiblingNameConflict?.({
        spaceId: dto.spaceId,
        folderId: dto.folderId ?? null,
        title: dto.title,
        currentNoteId: null
      });
      const note = new Note(dto);
      return persistNote(note, { createVersion: true });
    },
    importMarkdown(input) {
      return this.createNote({
        ...input,
        sourceType: input.sourceType ?? 'markdown-import'
      });
    },
    importMarkdownBatch(items = []) {
      if (!Array.isArray(items) || items.length === 0) {
        throw validationError('MARKDOWN_IMPORT_ITEMS_REQUIRED', 'Markdown import batch must contain at least one item');
      }

      return items.map(item => this.importMarkdown(item));
    },
    getNote(noteId, options = {}) {
      return requireNote(noteId, options);
    },
    getLinkedNotes(noteId) {
      const note = requireNote(noteId, { includeDeleted: true });
      const internalLinks = Array.isArray(note.internalLinks) ? note.internalLinks : [];
      const linkedNotes = [];

      for (const linkedId of internalLinks) {
        const linkedNote = repository.findById(linkedId);

        if (linkedNote && !linkedNote.deleted) {
          linkedNotes.push(linkedNote);
        }
      }

      return linkedNotes;
    },
    getNoteLinkRelations(noteId) {
      const note = requireNote(noteId);
      return buildNoteLinkRelations(note, repository.list({ spaceId: note.spaceId, includeDeleted: true }));
    },
    updateNote(noteId, updates) {
      const currentNote = requireNote(noteId, { includeDeleted: true });
      const dto = buildUpdateNoteDto(updates);
      if (dto.rawMarkdown !== undefined)
        addedNoteLinkTargets(dto.rawMarkdown, currentNote.rawMarkdown).forEach(id =>
          assertNoteLinkTarget(repository.findById(id), dto.spaceId ?? currentNote.spaceId)
        );
      // 原生 Date 接受未知值并可能抛错或产生 Invalid Date；此局部签名不声明输入已校验。
      if (
        dto.expectedUpdatedAt &&
        dto.expectedUpdatedAt !==
          new /** @type {new (value: unknown) => Date} */ (Date)(currentNote.updatedAt).toISOString()
      ) {
        throw conflictError('NOTE_UPDATE_CONFLICT', 'Note has changed since it was loaded');
      }
      const nextFolderId = Object.prototype.hasOwnProperty.call(dto, 'folderId') ? dto.folderId : currentNote.folderId;
      const nextNote = {
        spaceId: dto.spaceId ?? currentNote.spaceId,
        folderId: nextFolderId,
        tagIds: dto.tagIds ?? currentNote.tagIds
      };
      assertReferences(nextNote);
      validateSiblingNameConflict?.({
        spaceId: nextNote.spaceId,
        folderId: nextFolderId ?? null,
        title: dto.title ?? currentNote.title,
        currentNoteId: currentNote.id
      });
      const annotationChange =
        dto.rawMarkdown !== undefined
          ? prepareAnnotationChange(
              currentNote,
              dto.rawMarkdown,
              dto.expectedUpdatedAt ? null : updates.annotationMapping
            )
          : null;
      const updatedNote = new Note({
        ...currentNote,
        annotationStructure: annotationChange?.structure ?? currentNote.annotationStructure,
        ...dto,
        id: currentNote.id,
        spaceId: dto.spaceId ?? currentNote.spaceId,
        folderId: nextFolderId,
        favorite: dto.favorite ?? currentNote.favorite,
        deleted: currentNote.deleted,
        tagIds: dto.tagIds ?? currentNote.tagIds,
        plainText: dto.rawMarkdown !== undefined ? undefined : currentNote.plainText,
        internalLinks: dto.rawMarkdown !== undefined ? undefined : currentNote.internalLinks,
        contentHash: dto.rawMarkdown !== undefined ? null : currentNote.contentHash,
        createdAt: currentNote.createdAt,
        updatedAt: dto.updatedAt ?? new Date().toISOString()
      });

      return persistNote(updatedNote, {
        annotationChange,
        createVersion: dto.rawMarkdown !== undefined && dto.rawMarkdown !== currentNote.rawMarkdown
      });
    },
    deleteNote(noteId) {
      const currentNote = requireNote(noteId, { includeDeleted: true });
      if (currentNote.deleted) return currentNote;
      const deletedAt = new Date().toISOString();
      const annotationStates =
        annotationRepository?.list({ noteId, includeDeleted: true }).map(annotation => ({
          id: annotation.id,
          lifecycleStatus: annotation.lifecycleStatus ?? 'active',
          revision: annotation.revision ?? 1
        })) ?? [];
      const deletedNote = new Note({
        ...currentNote,
        deleted: true,
        deletionPackage: { id: `note-${noteId}-${Date.now()}`, deletedAt, annotationStates },
        createdAt: currentNote.createdAt,
        updatedAt: deletedAt
      });

      return runTransaction(() => {
        const saved = repository.save(deletedNote);
        onNoteDeleted?.(saved.id);
        return saved;
      });
    },
    deleteNotes(noteIds) {
      const validatedIds = requireNoteIds(noteIds);
      validatedIds.forEach(noteId => requireNote(noteId, { includeDeleted: true }));
      return validatedIds.map(noteId => this.deleteNote(noteId));
    },
    restoreNote(noteId) {
      const currentNote = requireNote(noteId, { includeDeleted: true });
      if (!currentNote.deleted) return currentNote;
      validateSiblingNameConflict?.({
        spaceId: currentNote.spaceId,
        folderId: currentNote.folderId ?? null,
        title: currentNote.title,
        currentNoteId: currentNote.id
      });
      const restoredNote = new Note({
        ...currentNote,
        deleted: false,
        folderDeletionPackageId: null,
        createdAt: currentNote.createdAt,
        updatedAt: new Date().toISOString()
      });

      return repository.save(restoredNote);
    },
    permanentlyDeleteNote(noteId) {
      const currentNote = requireNote(noteId, { includeDeleted: true });
      if (!currentNote.deleted) {
        throw conflictError('NOTE_NOT_IN_RECYCLE_BIN', 'Note must be in recycle bin before permanent delete');
      }

      return runTransaction(() => {
        assertPermanentDeletionAllowed([currentNote.id]);
        const deletedNote = repository.delete(noteId);
        if (!deletedNote) {
          throw notFoundError('NOTE_NOT_FOUND', 'Note not found');
        }
        return deletedNote;
      });
    },
    emptyRecycleBin(spaceId = null) {
      return runTransaction(() => {
        const recycleBinNotes = repository.list({ includeDeleted: true, spaceId }).filter(note => note.deleted);
        assertPermanentDeletionAllowed(recycleBinNotes.map(note => note.id));

        const deletedNotes = repository.deleteWhere(
          note => note.deleted && (spaceId ? note.spaceId === spaceId : true)
        );
        deletedNotes.forEach(note => onNoteDeleted?.(note.id));

        return {
          deletedCount: deletedNotes.length,
          noteIds: deletedNotes.map(note => note.id)
        };
      });
    },
    setFavorite(noteId, favorite = true) {
      const currentNote = requireNote(noteId, { includeDeleted: true });
      const updatedNote = new Note({
        ...currentNote,
        favorite: Boolean(favorite),
        createdAt: currentNote.createdAt,
        updatedAt: new Date().toISOString()
      });

      repository.save(updatedNote);
      return updatedNote;
    },
    ...associationOperations,
    listNotes(options = {}) {
      const notes = repository.list(options);
      return options.summaryOnly === true || options.summaryOnly === 'true' ? notes.map(createNoteSummary) : notes;
    }
  };
}
