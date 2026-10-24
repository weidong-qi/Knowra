/** Local synchronous deletion: collaborators may return Promises, but this module never awaits them. */
export type DeletionValue = object | null | undefined;
export interface CleanupValue {
  readonly length: unknown;
}
export interface CleanupResult {
  attachmentCleanup: CleanupValue;
}
export interface NoteView {
  readonly id?: unknown;
  readonly deleted?: unknown;
}
export interface AnnotationView {
  readonly id?: unknown;
  readonly noteId?: unknown;
}
export interface MappableView<Item> {
  map: (callback: (item: Item) => unknown) => unknown[];
}
export interface FilterableView<Item> {
  filter: (callback: (item: Item) => unknown) => MappableView<Item>;
}
export interface NoteDeletionOptions<
  NoteResult extends DeletionValue = DeletionValue,
  RecycleResult extends DeletionValue = DeletionValue
> {
  noteService: {
    permanentlyDeleteNote: (noteId: unknown) => NoteResult;
    emptyRecycleBin: (spaceId: unknown) => RecycleResult;
  };
  noteRepository: {
    list: (options: { includeDeleted: true; spaceId: unknown }) => FilterableView<NoteView>;
  };
  noteVersionRepository?: { deleteByNoteIds?: ((noteIds: unknown[]) => unknown) | null | undefined } | null | undefined;
  contentAnnotationRepository?:
    | {
        list?: ((options: { includeDeleted: true }) => FilterableView<AnnotationView>) | null | undefined;
        deleteByNoteIds?: ((noteIds: unknown[]) => unknown) | null | undefined;
      }
    | null
    | undefined;
  annotationExclusionRepository?:
    { deleteByAnnotationIds?: ((annotationIds: unknown[]) => unknown) | null | undefined } | null | undefined;
  annotationRevisionRepository?:
    { deleteByAnnotationIds?: ((annotationIds: unknown[]) => unknown) | null | undefined } | null | undefined;
  attachmentStore?:
    | {
        detachAttachmentsForNotes?: ((noteIds: unknown[]) => unknown) | null | undefined;
        removeDetachedAttachmentFiles?: ((attachments: unknown) => CleanupValue | null | undefined) | null | undefined;
      }
    | null
    | undefined;
  runTransaction?: (<Value>(operation: () => Value) => Value) | undefined;
}
export interface NoteDeletionCoordinator<
  NoteResult extends DeletionValue = DeletionValue,
  RecycleResult extends DeletionValue = DeletionValue
> {
  permanentlyDeleteNote: (noteId: unknown) => NoteResult | CleanupResult;
  emptyRecycleBin: (spaceId?: unknown) => RecycleResult | CleanupResult;
}

export function createNoteDeletionCoordinator<
  NoteResult extends DeletionValue = DeletionValue,
  RecycleResult extends DeletionValue = DeletionValue
>({
  noteService,
  noteRepository,
  noteVersionRepository,
  contentAnnotationRepository,
  annotationExclusionRepository,
  annotationRevisionRepository,
  attachmentStore,
  runTransaction = operation => operation()
}: NoteDeletionOptions<NoteResult, RecycleResult>): NoteDeletionCoordinator<NoteResult, RecycleResult> {
  function removeDependents(noteIds: unknown[]): unknown {
    const annotationIds =
      typeof contentAnnotationRepository?.list === 'function'
        ? contentAnnotationRepository
            .list({ includeDeleted: true })
            .filter(annotation => noteIds.includes(annotation.noteId))
            .map(annotation => annotation.id)
        : [];
    annotationExclusionRepository?.deleteByAnnotationIds?.(annotationIds);
    annotationRevisionRepository?.deleteByAnnotationIds?.(annotationIds);
    contentAnnotationRepository?.deleteByNoteIds?.(noteIds);
    noteVersionRepository?.deleteByNoteIds?.(noteIds);
    return attachmentStore?.detachAttachmentsForNotes?.(noteIds) ?? [];
  }

  function finishAttachmentCleanup(attachments: unknown): CleanupValue {
    return attachmentStore?.removeDetachedAttachmentFiles?.(attachments) ?? [];
  }

  function permanentlyDeleteNote(noteId: unknown): NoteResult | CleanupResult {
    let detachedAttachments: unknown = [];
    const deletedNote = runTransaction(() => {
      const result = noteService.permanentlyDeleteNote(noteId);
      detachedAttachments = removeDependents([noteId]);
      return result;
    });

    const attachmentCleanup = finishAttachmentCleanup(detachedAttachments);
    return attachmentCleanup.length ? { ...deletedNote, attachmentCleanup } : deletedNote;
  }

  function emptyRecycleBin(spaceId: unknown = null): RecycleResult | CleanupResult {
    const noteIds = noteRepository
      .list({ includeDeleted: true, spaceId })
      .filter(note => note.deleted)
      .map(note => note.id);
    let detachedAttachments: unknown = [];
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
