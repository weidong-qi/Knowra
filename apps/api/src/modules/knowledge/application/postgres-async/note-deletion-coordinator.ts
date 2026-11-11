import type { createPostgresAttachmentStore } from '../../../../infrastructure/postgres-attachment-store.ts';
import type { createAsyncNoteService } from './note-service.ts';
import type { createPostgresNoteRepository } from '../../infrastructure/postgres/note-repository.ts';
type Awaitable<Value> = Value | PromiseLike<Value>;
type AttachmentStore = ReturnType<typeof createPostgresAttachmentStore>;
type AttachmentList = Awaited<ReturnType<AttachmentStore['listAttachments']>>;
type CleanupValue = Awaited<ReturnType<AttachmentStore['removeDetachedAttachmentFiles']>>;
export interface AsyncNoteDeletionOptions {
  noteService: Pick<ReturnType<typeof createAsyncNoteService>, 'permanentlyDeleteNote' | 'emptyRecycleBin'>;
  noteRepository: Pick<ReturnType<typeof createPostgresNoteRepository>, 'list'>;
  attachmentStore: Pick<AttachmentStore, 'inspectAttachmentDeletion'> &
    Partial<Pick<AttachmentStore, 'listAttachments' | 'prepareAttachmentCleanup' | 'removeDetachedAttachmentFiles'>>;
  runTransaction?: <Value>(operation: () => Promise<Value>) => Awaitable<Value>;
}

import { createAppError } from '../../../../errors/app-error.ts';

export function createAsyncNoteDeletionCoordinator({
  noteService,
  noteRepository,
  attachmentStore,
  runTransaction = operation => operation()
}: AsyncNoteDeletionOptions) {
  async function collectAttachments(noteIds: Iterable<string>): Promise<AttachmentList> {
    const noteIdSet = new Set(noteIds);
    const attachments = (await attachmentStore?.listAttachments?.()) ?? [];
    return attachments.filter(attachment => noteIdSet.has(attachment.noteId));
  }

  async function assertNoRetainedAttachmentReferences(
    attachments: AttachmentList,
    noteIds: Iterable<string>
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

  async function permanentlyDeleteNote(noteId: string) {
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

  async function emptyRecycleBin(spaceId: string | null = null) {
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
