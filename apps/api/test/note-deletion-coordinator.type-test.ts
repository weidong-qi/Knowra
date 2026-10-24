import { createNoteDeletionCoordinator } from '../src/modules/knowledge/application/note-deletion-coordinator.ts';
import type {
  NoteDeletionOptions,
  NoteDeletionCoordinator,
  NoteView,
  AnnotationView,
  FilterableView,
  CleanupValue,
  CleanupResult,
  DeletionValue
} from '../src/modules/knowledge/application/note-deletion-coordinator.ts';
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Assert<T extends true> = T;
export type Checks = [
  Assert<Equal<Parameters<NoteDeletionCoordinator['permanentlyDeleteNote']>, [noteId: unknown]>>,
  Assert<Equal<Parameters<NoteDeletionCoordinator['emptyRecycleBin']>, [spaceId?: unknown]>>,
  Assert<Equal<ReturnType<NoteDeletionCoordinator['permanentlyDeleteNote']>, DeletionValue | CleanupResult>>,
  Assert<
    Equal<
      Parameters<NonNullable<NonNullable<NoteDeletionOptions['attachmentStore']>['detachAttachmentsForNotes']>>[0],
      unknown[]
    >
  >,
  Assert<Equal<NoteView['id'], unknown>>,
  Assert<Equal<NoteView['deleted'], unknown>>,
  Assert<Equal<AnnotationView['id'], unknown>>,
  Assert<Equal<AnnotationView['noteId'], unknown>>,
  Assert<Equal<CleanupValue['length'], unknown>>,
  Assert<
    Equal<
      ReturnType<NonNullable<NonNullable<NoteDeletionOptions['attachmentStore']>['detachAttachmentsForNotes']>>,
      unknown
    >
  >,
  Assert<
    Equal<
      Parameters<NonNullable<NonNullable<NoteDeletionOptions['attachmentStore']>['removeDetachedAttachmentFiles']>>[0],
      unknown
    >
  >,
  Assert<
    Equal<
      ReturnType<NonNullable<NonNullable<NoteDeletionOptions['noteVersionRepository']>['deleteByNoteIds']>>,
      unknown
    >
  >,
  Assert<Equal<NoteDeletionOptions['runTransaction'], (<T>(operation: () => T) => T) | undefined>>
];
declare const checks: Checks;
void checks;
declare const noteId: unknown;
declare const customNotes: FilterableView<NoteView>;
declare const customAnnotations: FilterableView<AnnotationView>;
const result = createNoteDeletionCoordinator({
  noteService: { permanentlyDeleteNote: () => ({ id: 'n', kept: 1 }), emptyRecycleBin: () => ({ deletedCount: 1 }) },
  noteRepository: { list: () => customNotes },
  contentAnnotationRepository: { list: () => customAnnotations, deleteByNoteIds: ids => ids.push(noteId) },
  annotationExclusionRepository: { deleteByAnnotationIds: ids => ids.splice(0, 1) },
  annotationRevisionRepository: { deleteByAnnotationIds: ids => (ids.length = 0) },
  noteVersionRepository: { deleteByNoteIds: ids => ids.push(Symbol()) },
  attachmentStore: {
    detachAttachmentsForNotes: ids => ({ ids }),
    removeDetachedAttachmentFiles: () => ({ length: 'yes', detail: 'custom truthy length' })
  },
  runTransaction: operation => operation()
});
export type Inference = [
  Assert<Equal<ReturnType<typeof result.permanentlyDeleteNote>, { id: string; kept: number } | CleanupResult>>,
  Assert<Equal<ReturnType<typeof result.emptyRecycleBin>, { deletedCount: number } | CleanupResult>>
];
declare const inference: Inference;
void inference;
result.permanentlyDeleteNote(Symbol());
result.emptyRecycleBin({ id: 'space' });
result.emptyRecycleBin();
createNoteDeletionCoordinator({
  noteService: { permanentlyDeleteNote: () => undefined, emptyRecycleBin: () => null },
  noteRepository: { list: () => [] },
  noteVersionRepository: undefined,
  contentAnnotationRepository: null,
  annotationExclusionRepository: undefined,
  annotationRevisionRepository: null,
  attachmentStore: { detachAttachmentsForNotes: () => null, removeDetachedAttachmentFiles: () => undefined },
  runTransaction: undefined
});
createNoteDeletionCoordinator({
  noteService: { permanentlyDeleteNote: () => Promise.resolve({ id: 'n' }), emptyRecycleBin: () => new Date() },
  noteRepository: { list: () => [] }
});

import { createNoteDeletionCoordinator as bridgeFactory } from '../src/modules/knowledge/application/note-deletion-coordinator.js';
import type { MappableView } from '../src/modules/knowledge/application/note-deletion-coordinator.ts';
type VersionPort = NonNullable<NoteDeletionOptions['noteVersionRepository']>;
type AnnotationPort = NonNullable<NoteDeletionOptions['contentAnnotationRepository']>;
type ExclusionPort = NonNullable<NoteDeletionOptions['annotationExclusionRepository']>;
type RevisionPort = NonNullable<NoteDeletionOptions['annotationRevisionRepository']>;
type AttachmentPort = NonNullable<NoteDeletionOptions['attachmentStore']>;
export type ContractChecks = [
  Assert<Equal<typeof bridgeFactory, typeof createNoteDeletionCoordinator>>,
  Assert<Equal<DeletionValue, object | null | undefined>>,
  Assert<Equal<ReturnType<NoteDeletionCoordinator['emptyRecycleBin']>, DeletionValue | CleanupResult>>,
  Assert<Equal<Parameters<NoteDeletionOptions['noteService']['permanentlyDeleteNote']>, [noteId: unknown]>>,
  Assert<Equal<Parameters<NoteDeletionOptions['noteService']['emptyRecycleBin']>, [spaceId: unknown]>>,
  Assert<Equal<ReturnType<NoteDeletionOptions['noteService']['permanentlyDeleteNote']>, DeletionValue>>,
  Assert<Equal<ReturnType<NoteDeletionOptions['noteService']['emptyRecycleBin']>, DeletionValue>>,
  Assert<
    Equal<
      Parameters<NoteDeletionOptions['noteRepository']['list']>,
      [options: { includeDeleted: true; spaceId: unknown }]
    >
  >,
  Assert<Equal<ReturnType<NoteDeletionOptions['noteRepository']['list']>, FilterableView<NoteView>>>,
  Assert<Equal<Parameters<NonNullable<AnnotationPort['list']>>, [options: { includeDeleted: true }]>>,
  Assert<Equal<ReturnType<NonNullable<AnnotationPort['list']>>, FilterableView<AnnotationView>>>,
  Assert<Equal<Parameters<NonNullable<VersionPort['deleteByNoteIds']>>, [noteIds: unknown[]]>>,
  Assert<Equal<Parameters<NonNullable<AnnotationPort['deleteByNoteIds']>>, [noteIds: unknown[]]>>,
  Assert<Equal<Parameters<NonNullable<ExclusionPort['deleteByAnnotationIds']>>, [annotationIds: unknown[]]>>,
  Assert<Equal<Parameters<NonNullable<RevisionPort['deleteByAnnotationIds']>>, [annotationIds: unknown[]]>>,
  Assert<Equal<ReturnType<NonNullable<AnnotationPort['deleteByNoteIds']>>, unknown>>,
  Assert<Equal<ReturnType<NonNullable<ExclusionPort['deleteByAnnotationIds']>>, unknown>>,
  Assert<Equal<ReturnType<NonNullable<RevisionPort['deleteByAnnotationIds']>>, unknown>>,
  Assert<
    Equal<ReturnType<NonNullable<AttachmentPort['removeDetachedAttachmentFiles']>>, CleanupValue | null | undefined>
  >,
  Assert<Equal<ReturnType<FilterableView<NoteView>['filter']>, MappableView<NoteView>>>,
  Assert<Equal<ReturnType<MappableView<NoteView>['map']>, unknown[]>>,
  Assert<Equal<Parameters<MappableView<NoteView>['map']>, [callback: (item: NoteView) => unknown]>>,
  Assert<Equal<ReturnType<Parameters<FilterableView<NoteView>['filter']>[0]>, unknown>>,
  Assert<Equal<CleanupResult, { attachmentCleanup: CleanupValue }>>
];
const nullResults = createNoteDeletionCoordinator({
  noteService: { permanentlyDeleteNote: () => null, emptyRecycleBin: () => undefined },
  noteRepository: { list: () => [] }
});
const objectResults = createNoteDeletionCoordinator({
  noteService: { permanentlyDeleteNote: () => Promise.resolve({ id: 'n' }), emptyRecycleBin: () => new Date() },
  noteRepository: { list: () => [] }
});
export type NullObjectChecks = [
  Assert<Equal<ReturnType<typeof nullResults.permanentlyDeleteNote>, null | CleanupResult>>,
  Assert<Equal<ReturnType<typeof nullResults.emptyRecycleBin>, undefined | CleanupResult>>,
  Assert<Equal<ReturnType<typeof objectResults.permanentlyDeleteNote>, Promise<{ id: string }> | CleanupResult>>,
  Assert<Equal<ReturnType<typeof objectResults.emptyRecycleBin>, Date | CleanupResult>>
];
const optionalNulls: NoteDeletionOptions = {
  noteService: { permanentlyDeleteNote: () => null, emptyRecycleBin: () => null },
  noteRepository: {
    list: () => ({
      filter: callback => {
        callback({ id: Symbol(), deleted: 'truthy' });
        return { map: mapper => [mapper({ id: {} })] };
      }
    })
  },
  noteVersionRepository: { deleteByNoteIds: null },
  contentAnnotationRepository: { list: undefined, deleteByNoteIds: null },
  annotationExclusionRepository: { deleteByAnnotationIds: undefined },
  annotationRevisionRepository: { deleteByAnnotationIds: null },
  attachmentStore: { detachAttachmentsForNotes: undefined, removeDetachedAttachmentFiles: null },
  runTransaction: undefined
};
const ignoredPromises: NoteDeletionOptions = {
  ...optionalNulls,
  noteVersionRepository: { deleteByNoteIds: () => Promise.resolve('ignored') },
  contentAnnotationRepository: { deleteByNoteIds: () => ({ then: 'ignored' }) },
  annotationExclusionRepository: { deleteByAnnotationIds: () => Symbol() },
  annotationRevisionRepository: { deleteByAnnotationIds: () => 0 },
  attachmentStore: { detachAttachmentsForNotes: () => false, removeDetachedAttachmentFiles: () => undefined }
};
void nullResults;
void objectResults;
void ignoredPromises;
void result;

const cleanupEmpty: AttachmentPort = { removeDetachedAttachmentFiles: () => {} };
const cleanupNull: AttachmentPort = { removeDetachedAttachmentFiles: () => null };
const cleanupUndefined: AttachmentPort = { removeDetachedAttachmentFiles: () => undefined };
const cleanupArray: AttachmentPort = { removeDetachedAttachmentFiles: () => [] };
const cleanupThenableWithLength: AttachmentPort = {
  removeDetachedAttachmentFiles: () => ({
    length: Symbol('truthy'),
    get then() {
      throw new Error('not read');
    }
  })
};
void cleanupEmpty;
void cleanupNull;
void cleanupUndefined;
void cleanupArray;
void cleanupThenableWithLength;
