/** A bounded static contract, not runtime validation of dynamic JavaScript values. */
export type Awaitable<Value> = Value | PromiseLike<Value>;
export type DeletionValue = object | null | undefined;
export interface CleanupValue {
  readonly length: unknown;
}
export interface NoteView {
  readonly id?: unknown;
  readonly deleted?: unknown;
}
export interface NoteIds extends Iterable<unknown, unknown, unknown> {
  readonly length: unknown;
  some: (callback: (id: unknown) => unknown) => unknown;
  includes: (id: unknown) => unknown;
}
export interface NoteList {
  filter: (callback: (note: NoteView) => unknown) => {
    map: (callback: (note: NoteView) => unknown) => NoteIds;
  };
}
export interface AttachmentView {
  readonly id?: unknown;
  readonly noteId?: unknown;
  readonly storagePath?: unknown;
  readonly fileName?: unknown;
}
export interface AttachmentList extends Iterable<AttachmentView, unknown, unknown> {
  readonly length: unknown;
  map: (
    callback: (attachment: AttachmentView) => readonly [unknown, string]
  ) => Iterable<readonly [unknown, string], unknown, unknown>;
  some: (callback: (attachment: AttachmentView) => unknown) => unknown;
}
export interface AttachmentFilterable {
  filter: (callback: (attachment: AttachmentView) => unknown) => AttachmentList;
}
export interface ReferenceView {
  readonly collection: string;
  readonly id?: unknown;
  readonly noteId?: unknown;
}
export interface PreflightView {
  readonly references: {
    filter: (callback: (reference: ReferenceView) => unknown) => { readonly length: unknown };
  };
}
export interface AttachmentStore {
  listAttachments?: (() => Awaitable<AttachmentFilterable | null | undefined>) | null | undefined;
  inspectAttachmentDeletion: (id: unknown) => Awaitable<PreflightView>;
  prepareAttachmentCleanup?: ((attachments: AttachmentList) => unknown) | null | undefined;
  removeDetachedAttachmentFiles?:
    ((attachments: AttachmentList) => Awaitable<CleanupValue | null | undefined>) | null | undefined;
}
export interface AsyncNoteDeletionOptions {
  noteService: {
    permanentlyDeleteNote: (noteId: unknown) => Awaitable<DeletionValue>;
    emptyRecycleBin: (spaceId: unknown) => Awaitable<DeletionValue>;
  };
  noteRepository: { list: (options: { includeDeleted: true; spaceId: unknown }) => Awaitable<NoteList> };
  attachmentStore: AttachmentStore;
  runTransaction?: (<Value>(operation: () => Promise<Value>) => Awaitable<Value>) | undefined;
}
/** Async return/spread may assimilate dynamic then properties, so the resolved result is deliberately unknown. */
export interface AsyncNoteDeletionCoordinator {
  permanentlyDeleteNote: (noteId: unknown) => Promise<unknown>;
  emptyRecycleBin: (spaceId?: unknown) => Promise<unknown>;
}

import { createAppError } from '../../../../errors/app-error.js';

export function createAsyncNoteDeletionCoordinator({
  noteService,
  noteRepository,
  attachmentStore,
  runTransaction = operation => operation()
}: AsyncNoteDeletionOptions): AsyncNoteDeletionCoordinator {
  async function collectAttachments(noteIds: Iterable<unknown, unknown, unknown>): Promise<AttachmentList> {
    const noteIdSet = new Set(noteIds);
    const attachments = (await attachmentStore?.listAttachments?.()) ?? [];
    return attachments.filter(attachment => noteIdSet.has(attachment.noteId));
  }

  async function assertNoRetainedAttachmentReferences(
    attachments: AttachmentList,
    noteIds: Iterable<unknown, unknown, unknown>
  ): Promise<void> {
    const noteIdSet = new Set(noteIds);
    for (const attachment of attachments) {
      const preflight = await attachmentStore.inspectAttachmentDeletion(attachment.id);
      const retained = preflight.references.filter(
        reference =>
          !(
            ['notes', 'noteVersions', 'contentAnnotations', 'pdfAnnotations'].includes(reference.collection) &&
            noteIdSet.has(reference.noteId ?? reference.id)
          )
      );
      if (retained.length) {
        throw createAppError('ATTACHMENT_REFERENCED', '保留的资产仍引用此附件，不能删除。', 409);
      }
    }
  }

  async function finishAttachmentCleanup(attachments: AttachmentList): Promise<CleanupValue> {
    return (await attachmentStore?.removeDetachedAttachmentFiles?.(attachments)) ?? [];
  }

  function assertSameAttachments(queued: AttachmentList, current: AttachmentList): void {
    const expected = new Map(queued.map(item => [item.id, `${item.storagePath}\u0000${item.fileName}`]));
    if (
      current.length !== expected.size ||
      current.some(item => expected.get(item.id) !== `${item.storagePath}\u0000${item.fileName}`)
    ) {
      throw createAppError('NOTE_DELETE_PREVIEW_STALE', '笔记附件已变化，请重新预检。', 409);
    }
  }

  async function permanentlyDeleteNote(noteId: unknown): Promise<unknown> {
    const queuedAttachments = await collectAttachments([noteId]);
    await attachmentStore?.prepareAttachmentCleanup?.(queuedAttachments);
    let detachedAttachments: AttachmentList = [];
    const deletedNote = await runTransaction(async () => {
      detachedAttachments = await collectAttachments([noteId]);
      assertSameAttachments(queuedAttachments, detachedAttachments);
      await assertNoRetainedAttachmentReferences(detachedAttachments, [noteId]);
      return noteService.permanentlyDeleteNote(noteId);
    });
    const cleanup = await finishAttachmentCleanup(detachedAttachments);
    return cleanup.length ? { ...deletedNote, attachmentCleanup: cleanup } : deletedNote;
  }

  async function emptyRecycleBin(spaceId: unknown = null): Promise<unknown> {
    const queuedNotes = await noteRepository.list({ includeDeleted: true, spaceId });
    const queuedNoteIds = queuedNotes.filter(note => note.deleted).map(note => note.id);
    const queuedAttachments = await collectAttachments(queuedNoteIds);
    await attachmentStore?.prepareAttachmentCleanup?.(queuedAttachments);
    let detachedAttachments: AttachmentList = [];
    const result = await runTransaction(async () => {
      const deletedNotes = await noteRepository.list({ includeDeleted: true, spaceId });
      const noteIds = deletedNotes.filter(note => note.deleted).map(note => note.id);
      if (noteIds.length !== queuedNoteIds.length || noteIds.some(id => !queuedNoteIds.includes(id))) {
        throw createAppError('NOTE_DELETE_PREVIEW_STALE', '回收站内容已变化，请重新预检。', 409);
      }
      detachedAttachments = await collectAttachments(noteIds);
      assertSameAttachments(queuedAttachments, detachedAttachments);
      await assertNoRetainedAttachmentReferences(detachedAttachments, noteIds);
      return noteService.emptyRecycleBin(spaceId);
    });
    const cleanup = await finishAttachmentCleanup(detachedAttachments);
    return cleanup.length ? { ...result, attachmentCleanup: cleanup } : result;
  }

  return { permanentlyDeleteNote, emptyRecycleBin };
}
