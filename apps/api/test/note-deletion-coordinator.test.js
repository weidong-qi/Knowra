import assert from 'node:assert/strict';

export const noteDeletionCoordinatorTests = [
  {
    name: 'note deletion coordinator removes annotations and attachment metadata before file cleanup',
    async run() {
      const { createNoteDeletionCoordinator } =
        await import('../src/modules/knowledge/application/note-deletion-coordinator.ts');
      const events = [];
      const notes = [
        {
          id: 'note-1',
          spaceId: 'space-1',
          deleted: true
        }
      ];
      const coordinator = createNoteDeletionCoordinator({
        noteService: {
          permanentlyDeleteNote(noteId) {
            events.push(`delete-note:${noteId}`);
            return notes.splice(0, 1)[0];
          },
          emptyRecycleBin() {
            return { deletedCount: 0, noteIds: [] };
          }
        },
        noteRepository: {
          list() {
            return notes;
          }
        },
        noteVersionRepository: {
          deleteByNoteIds(noteIds) {
            events.push(`delete-note-versions:${noteIds.join(',')}`);
          }
        },
        contentAnnotationRepository: {
          deleteByNoteIds(noteIds) {
            events.push(`delete-annotations:${noteIds.join(',')}`);
          }
        },
        attachmentStore: {
          detachAttachmentsForNotes(noteIds) {
            events.push(`detach-attachments:${noteIds.join(',')}`);
            return [{ id: 'attachment-1' }];
          },
          removeDetachedAttachmentFiles(attachments) {
            events.push(`cleanup-files:${attachments[0].id}`);
          }
        },
        runTransaction(operation) {
          events.push('transaction:start');
          const result = operation();
          events.push('transaction:commit');
          return result;
        }
      });

      const deleted = coordinator.permanentlyDeleteNote('note-1');

      assert.equal(deleted.id, 'note-1');
      assert.deepEqual(events, [
        'transaction:start',
        'delete-note:note-1',
        'delete-annotations:note-1',
        'delete-note-versions:note-1',
        'detach-attachments:note-1',
        'transaction:commit',
        'cleanup-files:attachment-1'
      ]);
    }
  },
  {
    name: 'note deletion coordinator cleans all recycled note dependents in one transaction',
    async run() {
      const { createNoteDeletionCoordinator } =
        await import('../src/modules/knowledge/application/note-deletion-coordinator.ts');
      const removed = [];
      const notes = [
        { id: 'note-a', spaceId: 'space-1', deleted: true },
        { id: 'note-b', spaceId: 'space-1', deleted: false },
        { id: 'note-c', spaceId: 'space-2', deleted: true }
      ];
      const coordinator = createNoteDeletionCoordinator({
        noteService: {
          permanentlyDeleteNote() {},
          emptyRecycleBin(spaceId) {
            assert.equal(spaceId, 'space-1');
            return { deletedCount: 1, noteIds: ['note-a'] };
          }
        },
        noteRepository: {
          list({ spaceId }) {
            return notes.filter(note => note.spaceId === spaceId);
          }
        },
        contentAnnotationRepository: {
          deleteByNoteIds(noteIds) {
            removed.push(...noteIds);
          }
        },
        attachmentStore: {
          detachAttachmentsForNotes() {
            return [];
          }
        }
      });

      const result = coordinator.emptyRecycleBin('space-1');

      assert.deepEqual(result, {
        deletedCount: 1,
        noteIds: ['note-a']
      });
      assert.deepEqual(removed, ['note-a']);
    }
  }
];
