/** Local synchronous deletion: collaborators may return Promises, but this module never awaits them. */
export type DeletionValue = object | null | undefined;
export interface CleanupValue {
  readonly length: unknown;
}
export interface CleanupResult {
  attachmentCleanup: CleanupValue;
}
export interface NoteView<Id = unknown> {
  readonly id: Id;
  readonly deleted?: unknown;
}
export interface AnnotationView {
  readonly id?: unknown;
  readonly noteId?: unknown;
}
export interface MappableView<Item> {
  map: <Value>(callback: (item: Item) => Value) => Value[];
}
export interface FilterableView<Item> {
  filter: (callback: (item: Item) => unknown) => MappableView<Item>;
}
export interface NoteDeletionOptions<
  NoteResult extends DeletionValue = DeletionValue,
  RecycleResult extends DeletionValue = DeletionValue,
  NoteId = unknown,
  Detached = unknown
> {
  noteService: {
    permanentlyDeleteNote: (noteId: NoteId) => NoteResult;
    emptyRecycleBin: (spaceId: string | null | undefined) => RecycleResult;
  };
  noteRepository: {
    list: (options: { includeDeleted: true; spaceId: string | null | undefined }) => FilterableView<NoteView<NoteId>>;
  };
  noteVersionRepository?: { deleteByNoteIds?: ((noteIds: NoteId[]) => unknown) | null | undefined } | null | undefined;
  contentAnnotationRepository?:
    | {
        list?: ((options: { includeDeleted: true }) => FilterableView<AnnotationView>) | null | undefined;
        deleteByNoteIds?: ((noteIds: NoteId[]) => unknown) | null | undefined;
      }
    | null
    | undefined;
  annotationExclusionRepository?:
    { deleteByAnnotationIds?: ((annotationIds: unknown[]) => unknown) | null | undefined } | null | undefined;
  annotationRevisionRepository?:
    { deleteByAnnotationIds?: ((annotationIds: unknown[]) => unknown) | null | undefined } | null | undefined;
  attachmentStore?:
    | {
        detachAttachmentsForNotes?: ((noteIds: NoteId[]) => Detached) | null | undefined;
        removeDetachedAttachmentFiles?:
          ((attachments: Detached | never[]) => CleanupValue | null | undefined) | null | undefined;
      }
    | null
    | undefined;
  removePdfAnnotations?: (noteIds: NoteId[]) => void;
  runTransaction?: (<Value>(operation: () => Value) => Value) | undefined;
}
export interface NoteDeletionCoordinator<
  NoteResult extends DeletionValue = DeletionValue,
  RecycleResult extends DeletionValue = DeletionValue,
  NoteId = unknown
> {
  permanentlyDeleteNote: (noteId: NoteId) => NoteResult | CleanupResult;
  emptyRecycleBin: (spaceId?: string | null) => RecycleResult | CleanupResult;
}

export function createNoteDeletionCoordinator<
  NoteResult extends DeletionValue = DeletionValue,
  RecycleResult extends DeletionValue = DeletionValue,
  NoteId = unknown,
  Detached = unknown
>({
  noteService,
  noteRepository,
  noteVersionRepository,
  contentAnnotationRepository,
  annotationExclusionRepository,
  annotationRevisionRepository,
  attachmentStore,
  removePdfAnnotations = _noteIds => {},
  runTransaction = operation => operation()
}: NoteDeletionOptions<NoteResult, RecycleResult, NoteId, Detached>): NoteDeletionCoordinator<
  NoteResult,
  RecycleResult,
  NoteId
> {
  function removeDependents(noteIds: NoteId[]): Detached | never[] {
    removePdfAnnotations(noteIds);
    const annotationIds =
      typeof contentAnnotationRepository?.list === 'function'
        ? contentAnnotationRepository
            .list({ includeDeleted: true })
            .filter(annotation => noteIds.includes(annotation.noteId as NoteId))
            .map(annotation => annotation.id)
        : [];
    annotationExclusionRepository?.deleteByAnnotationIds?.(annotationIds);
    annotationRevisionRepository?.deleteByAnnotationIds?.(annotationIds);
    contentAnnotationRepository?.deleteByNoteIds?.(noteIds);
    noteVersionRepository?.deleteByNoteIds?.(noteIds);
    return attachmentStore?.detachAttachmentsForNotes?.(noteIds) ?? [];
  }

  function finishAttachmentCleanup(attachments: Detached | never[]): CleanupValue {
    return attachmentStore?.removeDetachedAttachmentFiles?.(attachments) ?? [];
  }

  function permanentlyDeleteNote(noteId: NoteId): NoteResult | CleanupResult {
    let detachedAttachments: Detached | never[] = [];
    const deletedNote = runTransaction(() => {
      const result = noteService.permanentlyDeleteNote(noteId);
      detachedAttachments = removeDependents([noteId]);
      return result;
    });

    const attachmentCleanup = finishAttachmentCleanup(detachedAttachments);
    return attachmentCleanup.length ? { ...deletedNote, attachmentCleanup } : deletedNote;
  }

  function emptyRecycleBin(spaceId: string | null | undefined = null): RecycleResult | CleanupResult {
    const noteIds = noteRepository
      .list({ includeDeleted: true, spaceId })
      .filter(note => note.deleted)
      .map(note => note.id);
    let detachedAttachments: Detached | never[] = [];
    const result = runTransaction(() => {
      const deletion = noteService.emptyRecycleBin(spaceId);
      detachedAttachments = removeDependents(noteIds);
      return deletion;
    });

    const attachmentCleanup = finishAttachmentCleanup(detachedAttachments);
    return attachmentCleanup.length ? { ...result, attachmentCleanup } : result;
  }

  return {
    permanentlyDeleteNote,
    emptyRecycleBin
  };
}
