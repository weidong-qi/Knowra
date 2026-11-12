import { prepareAnnotationChange } from './annotation-change-context.ts';
import { Note } from '../domain/note.ts';
import { buildCreateNoteDto, buildUpdateNoteDto } from './dto/note.dto.ts';
import { createNoteSummary } from './note-summary.ts';
import { createInMemoryNoteRepository } from '../infrastructure/note-repository.ts';
import { conflictError, notFoundError, validationError } from './knowledge-errors.ts';
import { createNoteAssociationOperations } from './note-association-operations.ts';
import { addedNoteLinkTargets, assertNoteLinkTarget, buildNoteLinkRelations } from './note-link-relations.ts';

import type { NoteRecord, NoteRepository, NoteListOptions } from '../infrastructure/note-repository.ts';
import type { ContentAnnotationRepository } from '../infrastructure/content-annotation-repository.ts';
import type { NoteDtoInput, CreateNoteDto, UpdateNoteDto } from './dto/note.dto.ts';
import type { NoteVersionRecord } from '../infrastructure/note-version-repository.ts';
import type { NavigationReferencePolicy } from './navigation-reference-policy.ts';
import type { SiblingNameInput } from './postgres-async/service-dependencies.ts';
type AnnotationChange = ReturnType<typeof prepareAnnotationChange>;
export interface NoteServiceInput extends NoteDtoInput {
  annotationMapping?: Parameters<typeof prepareAnnotationChange>[2];
}
// DTO 边界视图沿用 Note/仓储契约；正文和标题由原 DTO 校验，其余值仍原样透传。
export type CreateNoteDtoView = Omit<CreateNoteDto<NoteServiceInput>, 'contentKind' | 'pdfSource'> &
  Pick<NoteRecord, 'title' | 'rawMarkdown' | 'tagIds' | 'aiVisibility' | 'contentKind' | 'pdfSource'>;
export type UpdateNoteDtoView = UpdateNoteDto<NoteServiceInput> &
  Partial<Pick<NoteRecord, 'title' | 'rawMarkdown' | 'tagIds' | 'aiVisibility'>>;
interface NoteServiceDependencies {
  repository?: NoteRepository;
  validateSiblingNameConflict?:
    ((input: Omit<SiblingNameInput, 'spaceId'> & { spaceId?: string | null }) => void) | null;
  validateNoteReferences?: NavigationReferencePolicy['assertNoteReferences'] | null;
  normalizeTagIds?: NavigationReferencePolicy['normalizeTagIds'];
  noteVersionService?: { ensureForNote(note: NoteRecord): NoteVersionRecord } | null;
  annotationRepository?: Pick<ContentAnnotationRepository, 'list'> | null;
  runTransaction?: <Result>(operation: () => Result) => Result;
  onNoteContentChanged?:
    ((note: NoteRecord, version: NoteVersionRecord, change: AnnotationChange | null) => void) | null;
  onNoteDeleted?: ((id: string) => void) | null;
  onBeforePermanentDelete?: ((id: string) => void) | null;
}
type NoteOptions = { includeDeleted?: boolean };
type ListOptions = NoteListOptions & { summaryOnly?: boolean | string };
type ReferenceFields = Pick<NoteRecord, 'spaceId' | 'folderId'> & { tagIds?: unknown[] };

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
}: NoteServiceDependencies = {}) {
  function persistNote(
    note: NoteRecord,
    {
      createVersion = false,
      annotationChange = null
    }: { createVersion?: boolean; annotationChange?: AnnotationChange | null } = {}
  ) {
    return runTransaction(() => {
      const saved = repository.save(note);
      if (createVersion && noteVersionService && note.contentKind !== 'pdf') {
        const version = noteVersionService.ensureForNote(saved);
        onNoteContentChanged?.(saved, version, annotationChange);
      }
      return saved;
    });
  }
  function requireNote(noteId: string | undefined, options: NoteOptions = {}) {
    const note = repository.findById(noteId);

    if (!note) {
      throw notFoundError('NOTE_NOT_FOUND', 'Note not found');
    }

    if (note.deleted && !options.includeDeleted) {
      throw notFoundError('NOTE_NOT_FOUND', 'Note not found');
    }

    return note;
  }

  function requireNoteIds(noteIds: unknown): string[] {
    if (!Array.isArray(noteIds) || noteIds.length === 0) {
      throw validationError('NOTE_IDS_REQUIRED', 'noteIds must contain at least one note id');
    }

    return noteIds as string[];
  }

  function assertNewNoteId(noteId: string) {
    if (repository.findById(noteId)) {
      throw conflictError('NOTE_ID_CONFLICT', 'A note with the same id already exists');
    }
  }

  function assertReferences(note: ReferenceFields) {
    validateNoteReferences?.({
      spaceId: note.spaceId,
      folderId: note.folderId ?? null,
      tagIds: note.tagIds ?? []
    });
  }

  function assertPermanentDeletionAllowed(noteIds: string[]) {
    noteIds.forEach(noteId => onBeforePermanentDelete?.(noteId));
  }

  const associationOperations = createNoteAssociationOperations({
    repository,
    requireNote,
    requireNoteIds,
    assertReferences,
    normalizeTagIds: normalizeTagIds as (ids: unknown[] | undefined) => string[]
  });

  return {
    createNote(input: NoteServiceInput) {
      const dto = buildCreateNoteDto(input) as CreateNoteDtoView;
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
    importMarkdown(input: NoteServiceInput) {
      return this.createNote({
        ...input,
        sourceType: input.sourceType ?? 'markdown-import'
      });
    },
    importMarkdownBatch(items: NoteServiceInput[] = []) {
      if (!Array.isArray(items) || items.length === 0) {
        throw validationError('MARKDOWN_IMPORT_ITEMS_REQUIRED', 'Markdown import batch must contain at least one item');
      }

      return items.map(item => this.importMarkdown(item));
    },
    getNote(noteId: string | undefined, options: NoteOptions = {}) {
      return requireNote(noteId, options);
    },
    getLinkedNotes(noteId: string) {
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
    getNoteLinkRelations(noteId: string) {
      const note = requireNote(noteId);
      return buildNoteLinkRelations(note, repository.list({ spaceId: note.spaceId, includeDeleted: true }));
    },
    updateNote(noteId: string, updates: NoteServiceInput) {
      const currentNote = requireNote(noteId, { includeDeleted: true });
      if (currentNote.contentKind === 'pdf' && updates.rawMarkdown !== undefined)
        throw validationError('PDF_IMMUTABLE', 'PDF 原文件不能作为 Markdown 正文修改。');
      const dto = buildUpdateNoteDto(updates) as UpdateNoteDtoView;
      if (dto.rawMarkdown !== undefined)
        addedNoteLinkTargets(dto.rawMarkdown, currentNote.rawMarkdown).forEach(id =>
          assertNoteLinkTarget(repository.findById(id), dto.spaceId ?? currentNote.spaceId)
        );
      // 原生 Date 接受未知值并可能抛错或产生 Invalid Date；此局部签名不声明输入已校验。
      if (
        dto.expectedUpdatedAt &&
        dto.expectedUpdatedAt !==
          new (Date as new (value: NoteRecord['updatedAt']) => Date)(currentNote.updatedAt).toISOString()
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
    deleteNote(noteId: string) {
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
    deleteNotes(noteIds: unknown) {
      const validatedIds = requireNoteIds(noteIds);
      validatedIds.forEach(noteId => requireNote(noteId, { includeDeleted: true }));
      return validatedIds.map(noteId => this.deleteNote(noteId));
    },
    restoreNote(noteId: string) {
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
    permanentlyDeleteNote(noteId: string) {
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
    emptyRecycleBin(spaceId: string | null = null) {
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
    setFavorite(noteId: string, favorite: unknown = true) {
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
    listNotes(options: ListOptions = {}) {
      const notes = repository.list(options);
      return options.summaryOnly === true || options.summaryOnly === 'true' ? notes.map(createNoteSummary) : notes;
    }
  };
}
