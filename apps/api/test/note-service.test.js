import assert from 'node:assert/strict';

export const noteServiceTests = [
  {
    name: 'createNote returns a note with derived plainText',
    async run() {
      const { createNoteService } = await import('../src/modules/knowledge/application/note-service.js');
      const noteService = createNoteService();

      const note = noteService.createNote({
        id: 'note-10',
        title: 'Lesson summary',
        rawMarkdown: '# Redis\n\nQueue jobs and cache values.',
        folderId: 'folder-1',
        spaceId: 'space-1'
      });

      assert.equal(note.title, 'Lesson summary');
      assert.equal(note.plainText, 'Redis Queue jobs and cache values.');
    }
  },
  {
    name: 'createNote can auto-generate id from title',
    async run() {
      const { createNoteService } = await import('../src/modules/knowledge/application/note-service.js');
      const noteService = createNoteService();

      const note = noteService.createNote({
        title: 'Auto Generated',
        rawMarkdown: 'auto id content',
        folderId: 'folder-1',
        spaceId: 'space-1'
      });

      assert.match(note.id, /^note-auto-generated-/);
    }
  },
  {
    name: 'createNote generates unique ids for same-title notes created in one batch',
    async run() {
      const { createNoteService } = await import('../src/modules/knowledge/application/note-service.js');
      const noteService = createNoteService();

      const notes = noteService.importMarkdownBatch([
        {
          rawMarkdown: '# Repeated title\n\nfirst',
          folderId: 'folder-a',
          spaceId: 'space-1'
        },
        {
          rawMarkdown: '# Repeated title\n\nsecond',
          folderId: 'folder-b',
          spaceId: 'space-1'
        }
      ]);

      assert.notEqual(notes[0].id, notes[1].id);
      assert.equal(noteService.listNotes().length, 2);
    }
  },
  {
    name: 'createNote rejects a duplicate client-provided id without overwriting',
    async run() {
      const { createNoteService } = await import('../src/modules/knowledge/application/note-service.js');
      const noteService = createNoteService();

      noteService.createNote({
        id: 'note-duplicate',
        title: 'Original',
        rawMarkdown: 'original',
        spaceId: 'space-1'
      });

      assert.throws(
        () =>
          noteService.createNote({
            id: 'note-duplicate',
            title: 'Replacement',
            rawMarkdown: 'replacement',
            spaceId: 'space-1'
          }),
        error => error.statusCode === 409 && error.code === 'NOTE_ID_CONFLICT'
      );
      assert.equal(noteService.getNote('note-duplicate').title, 'Original');
    }
  },
  {
    name: 'createNote accepts an empty body for a newly created manual note',
    async run() {
      const { createNoteService } = await import('../src/modules/knowledge/application/note-service.js');
      const noteService = createNoteService();

      const note = noteService.createNote({
        id: 'note-empty-body',
        title: 'Empty body',
        rawMarkdown: '',
        folderId: 'folder-1',
        spaceId: 'space-1',
        sourceType: 'manual'
      });

      assert.equal(note.rawMarkdown, '');
      assert.equal(note.plainText, '');
    }
  },
  {
    name: 'importMarkdown creates markdown-import notes with derived title',
    async run() {
      const { createNoteService } = await import('../src/modules/knowledge/application/note-service.js');
      const noteService = createNoteService();

      const note = noteService.importMarkdown({
        rawMarkdown: '# Queue Deep Dive\n\nBullMQ with Redis',
        folderId: 'folder-1',
        spaceId: 'space-1',
        tagIds: ['tag-redis']
      });

      assert.equal(note.title, 'Queue Deep Dive');
      assert.equal(note.sourceType, 'markdown-import');
      assert.deepEqual(note.tagIds, ['tag-redis']);
    }
  },
  {
    name: 'importMarkdownBatch imports multiple notes at once',
    async run() {
      const { createNoteService } = await import('../src/modules/knowledge/application/note-service.js');
      const noteService = createNoteService();

      const notes = noteService.importMarkdownBatch([
        {
          rawMarkdown: '# First Batch Note\n\ncontent',
          folderId: 'folder-1',
          spaceId: 'space-1'
        },
        {
          rawMarkdown: '# Second Batch Note\n\ncontent',
          folderId: 'folder-1',
          spaceId: 'space-1'
        }
      ]);

      assert.equal(notes.length, 2);
      assert.equal(notes[0].sourceType, 'markdown-import');
      assert.equal(notes[1].title, 'Second Batch Note');
    }
  },
  {
    name: 'updateNote refreshes title, rawMarkdown and derived plainText',
    async run() {
      const { createNoteService } = await import('../src/modules/knowledge/application/note-service.js');
      const noteService = createNoteService();

      noteService.createNote({
        id: 'note-12',
        title: 'Old title',
        rawMarkdown: 'old content',
        folderId: 'folder-1',
        spaceId: 'space-1'
      });

      const updated = noteService.updateNote('note-12', {
        title: 'New title',
        rawMarkdown: '# Queue\n\nBackground jobs'
      });

      assert.equal(updated.title, 'New title');
      assert.equal(updated.rawMarkdown, '# Queue\n\nBackground jobs');
      assert.equal(updated.plainText, 'Queue Background jobs');
    }
  },
  {
    name: 'updateNote can move a note back to the root level',
    async run() {
      const { createNoteService } = await import('../src/modules/knowledge/application/note-service.js');
      const noteService = createNoteService();

      noteService.createNote({
        id: 'note-root-move',
        title: 'Root move',
        rawMarkdown: 'move me',
        folderId: 'folder-1',
        spaceId: 'space-1'
      });

      const updated = noteService.updateNote('note-root-move', {
        folderId: null
      });

      assert.equal(updated.folderId, null);
      assert.equal(noteService.getNote('note-root-move').folderId, null);
    }
  },
  {
    name: 'getNote returns a note by id',
    async run() {
      const { createNoteService } = await import('../src/modules/knowledge/application/note-service.js');
      const noteService = createNoteService();

      noteService.createNote({
        id: 'note-lookup',
        title: 'Lookup note',
        rawMarkdown: 'find me',
        folderId: 'folder-1',
        spaceId: 'space-1'
      });

      const note = noteService.getNote('note-lookup');

      assert.equal(note.id, 'note-lookup');
      assert.equal(note.title, 'Lookup note');
    }
  },
  {
    name: 'getLinkedNotes returns linked notes that exist',
    async run() {
      const { createNoteService } = await import('../src/modules/knowledge/application/note-service.js');
      const noteService = createNoteService();

      noteService.createNote({
        id: 'note-link-target',
        title: 'Target',
        rawMarkdown: 'target content',
        folderId: 'folder-1',
        spaceId: 'space-1'
      });
      noteService.createNote({
        id: 'note-link-source',
        title: 'Source',
        rawMarkdown: 'See [[note-link-target]] and [[missing-note]].',
        folderId: 'folder-1',
        spaceId: 'space-1'
      });

      const linked = noteService.getLinkedNotes('note-link-source');

      assert.equal(linked.length, 1);
      assert.equal(linked[0].id, 'note-link-target');
    }
  },
  {
    name: 'getLinkedNotes tolerates missing internalLinks on stored notes',
    async run() {
      const { createNoteService } = await import('../src/modules/knowledge/application/note-service.js');
      const noteService = createNoteService({
        repository: {
          findById: noteId =>
            noteId === 'note-without-links'
              ? { id: 'note-without-links', deleted: false, internalLinks: undefined }
              : null
        }
      });

      const linked = noteService.getLinkedNotes('note-without-links');

      assert.deepEqual(linked, []);
    }
  },
  {
    name: 'listNotes filters notes by spaceId',
    async run() {
      const { createNoteService } = await import('../src/modules/knowledge/application/note-service.js');
      const noteService = createNoteService();

      noteService.createNote({
        id: 'note-space-1',
        title: 'Space one',
        rawMarkdown: 'content one',
        folderId: 'folder-1',
        spaceId: 'space-1'
      });
      noteService.createNote({
        id: 'note-space-2',
        title: 'Space two',
        rawMarkdown: 'content two',
        folderId: 'folder-2',
        spaceId: 'space-2'
      });

      const results = noteService.listNotes({ spaceId: 'space-1' });

      assert.equal(results.length, 1);
      assert.equal(results[0].id, 'note-space-1');
    }
  },
  {
    name: 'listNotes summaryOnly omits note bodies and keeps index metadata',
    async run() {
      const { createNoteService } = await import('../src/modules/knowledge/application/note-service.js');
      const noteService = createNoteService();

      noteService.createNote({
        id: 'note-summary',
        title: 'Summary note',
        rawMarkdown: '# Heading\n\n' + 'Long body '.repeat(80),
        folderId: 'folder-1',
        spaceId: 'space-1'
      });

      const [summary] = noteService.listNotes({
        spaceId: 'space-1',
        summaryOnly: 'true'
      });

      assert.equal(summary.id, 'note-summary');
      assert.equal(summary.contentLoaded, false);
      assert.equal(Object.hasOwn(summary, 'rawMarkdown'), false);
      assert.equal(Object.hasOwn(summary, 'plainText'), false);
      assert.ok(summary.summary.length <= 240);
      assert.equal(summary.outline[0].title, 'Heading');
      assert.ok(summary.characterCount > 0);
    }
  },
  {
    name: 'setFavorite marks a note and favorite notes sort first',
    async run() {
      const { createNoteService } = await import('../src/modules/knowledge/application/note-service.js');
      const noteService = createNoteService();

      noteService.createNote({
        id: 'note-favorite-a',
        title: 'Alpha',
        rawMarkdown: 'alpha',
        folderId: 'folder-1',
        spaceId: 'space-1',
        updatedAt: '2026-06-02T10:00:00.000Z'
      });
      noteService.createNote({
        id: 'note-favorite-b',
        title: 'Beta',
        rawMarkdown: 'beta',
        folderId: 'folder-1',
        spaceId: 'space-1',
        updatedAt: '2026-06-02T11:00:00.000Z'
      });

      const favorite = noteService.setFavorite('note-favorite-a', true);
      const notes = noteService.listNotes({ spaceId: 'space-1' });
      const favoriteOnly = noteService.listNotes({ spaceId: 'space-1', favoriteOnly: true });

      assert.equal(favorite.favorite, true);
      assert.equal(notes[0].id, 'note-favorite-a');
      assert.equal(favoriteOnly.length, 1);
      assert.equal(favoriteOnly[0].id, 'note-favorite-a');
    }
  },
  {
    name: 'assignTagToNote records tagIds without duplication',
    async run() {
      const { createNoteService } = await import('../src/modules/knowledge/application/note-service.js');
      const noteService = createNoteService();

      noteService.createNote({
        id: 'note-tags',
        title: 'Tagged note',
        rawMarkdown: 'redis and postgres',
        folderId: 'folder-1',
        spaceId: 'space-1'
      });

      noteService.assignTagToNote('note-tags', 'tag-redis');
      noteService.assignTagToNote('note-tags', 'tag-redis');
      noteService.assignTagToNote('note-tags', 'tag-db');

      const note = noteService.getNote('note-tags');

      assert.deepEqual(note.tagIds, ['tag-redis', 'tag-db']);
    }
  },
  {
    name: 'deleteNotes soft deletes multiple notes in one operation',
    async run() {
      const { createNoteService } = await import('../src/modules/knowledge/application/note-service.js');
      const noteService = createNoteService();

      noteService.createNote({
        id: 'note-batch-delete-a',
        title: 'Delete A',
        rawMarkdown: 'delete a',
        folderId: 'folder-1',
        spaceId: 'space-1'
      });
      noteService.createNote({
        id: 'note-batch-delete-b',
        title: 'Delete B',
        rawMarkdown: 'delete b',
        folderId: 'folder-1',
        spaceId: 'space-1'
      });

      const deleted = noteService.deleteNotes(['note-batch-delete-a', 'note-batch-delete-b']);

      assert.equal(deleted.length, 2);
      assert.equal(noteService.listNotes({ deletedOnly: true }).length, 2);
      assert.equal(noteService.listNotes().length, 0);
    }
  },
  {
    name: 'removeTagFromNote removes a tag id from the note',
    async run() {
      const { createNoteService } = await import('../src/modules/knowledge/application/note-service.js');
      const noteService = createNoteService();

      noteService.createNote({
        id: 'note-untag',
        title: 'Tag removal',
        rawMarkdown: 'remove tag',
        folderId: 'folder-1',
        spaceId: 'space-1',
        tagIds: ['tag-a', 'tag-b']
      });

      const updated = noteService.removeTagFromNote('note-untag', 'tag-a');

      assert.deepEqual(updated.tagIds, ['tag-b']);
    }
  },
  {
    name: 'assignTagToNotes appends a tag across multiple notes without duplication',
    async run() {
      const { createNoteService } = await import('../src/modules/knowledge/application/note-service.js');
      const noteService = createNoteService();

      noteService.createNote({
        id: 'note-batch-tag-a',
        title: 'Tag A',
        rawMarkdown: 'tag a',
        folderId: 'folder-1',
        spaceId: 'space-1',
        tagIds: ['tag-existing']
      });
      noteService.createNote({
        id: 'note-batch-tag-b',
        title: 'Tag B',
        rawMarkdown: 'tag b',
        folderId: 'folder-1',
        spaceId: 'space-1'
      });

      const updated = noteService.assignTagToNotes(['note-batch-tag-a', 'note-batch-tag-b'], 'tag-shared');

      assert.equal(updated.length, 2);
      assert.deepEqual(noteService.getNote('note-batch-tag-a').tagIds, ['tag-existing', 'tag-shared']);
      assert.deepEqual(noteService.getNote('note-batch-tag-b').tagIds, ['tag-shared']);
    }
  },
  {
    name: 'clearFolderFromNotes removes folder references from matching notes',
    async run() {
      const { createNoteService } = await import('../src/modules/knowledge/application/note-service.js');
      const noteService = createNoteService();

      noteService.createNote({
        id: 'note-folder-a',
        title: 'Folder A',
        rawMarkdown: 'folder content',
        folderId: 'folder-shared',
        spaceId: 'space-1'
      });
      noteService.createNote({
        id: 'note-folder-b',
        title: 'Folder B',
        rawMarkdown: 'other folder content',
        folderId: 'folder-other',
        spaceId: 'space-1'
      });

      const updatedNotes = noteService.clearFolderFromNotes('folder-shared');

      assert.equal(updatedNotes.length, 1);
      assert.equal(noteService.getNote('note-folder-a').folderId, null);
      assert.equal(noteService.getNote('note-folder-b').folderId, 'folder-other');
    }
  },
  {
    name: 'removeTagFromAllNotes removes tag id across matching notes',
    async run() {
      const { createNoteService } = await import('../src/modules/knowledge/application/note-service.js');
      const noteService = createNoteService();

      noteService.createNote({
        id: 'note-tag-a',
        title: 'Tag A',
        rawMarkdown: 'content a',
        folderId: 'folder-1',
        spaceId: 'space-1',
        tagIds: ['tag-cleanup', 'tag-keep']
      });
      noteService.createNote({
        id: 'note-tag-b',
        title: 'Tag B',
        rawMarkdown: 'content b',
        folderId: 'folder-1',
        spaceId: 'space-1',
        tagIds: ['tag-cleanup']
      });

      const updatedNotes = noteService.removeTagFromAllNotes('tag-cleanup');

      assert.equal(updatedNotes.length, 2);
      assert.deepEqual(noteService.getNote('note-tag-a').tagIds, ['tag-keep']);
      assert.deepEqual(noteService.getNote('note-tag-b').tagIds, []);
    }
  },
  {
    name: 'setNoteTags replaces the full tag collection for a note',
    async run() {
      const { createNoteService } = await import('../src/modules/knowledge/application/note-service.js');
      const noteService = createNoteService();

      noteService.createNote({
        id: 'note-set-tags',
        title: 'Set tags',
        rawMarkdown: 'tag sync',
        folderId: 'folder-1',
        spaceId: 'space-1',
        tagIds: ['tag-old']
      });

      const updated = noteService.setNoteTags('note-set-tags', ['tag-new', 'tag-db']);

      assert.deepEqual(updated.tagIds, ['tag-new', 'tag-db']);
      assert.deepEqual(noteService.getNote('note-set-tags').tagIds, ['tag-new', 'tag-db']);
    }
  },
  {
    name: 'listNotes sorts by updatedAt descending by default',
    async run() {
      const { createNoteService } = await import('../src/modules/knowledge/application/note-service.js');
      const noteService = createNoteService();

      noteService.createNote({
        id: 'note-sort-a',
        title: 'Alpha',
        rawMarkdown: 'alpha',
        folderId: 'folder-1',
        spaceId: 'space-1',
        createdAt: '2026-06-02T10:00:00.000Z',
        updatedAt: '2026-06-02T10:00:00.000Z'
      });
      noteService.createNote({
        id: 'note-sort-b',
        title: 'Beta',
        rawMarkdown: 'beta',
        folderId: 'folder-1',
        spaceId: 'space-1',
        createdAt: '2026-06-02T11:00:00.000Z',
        updatedAt: '2026-06-02T11:00:00.000Z'
      });

      const notes = noteService.listNotes({ spaceId: 'space-1' });

      assert.equal(notes[0].id, 'note-sort-b');
      assert.equal(notes[1].id, 'note-sort-a');
    }
  },
  {
    name: 'listNotes can sort by title ascending',
    async run() {
      const { createNoteService } = await import('../src/modules/knowledge/application/note-service.js');
      const noteService = createNoteService();

      noteService.createNote({
        id: 'note-title-b',
        title: 'Zoo',
        rawMarkdown: 'zoo',
        folderId: 'folder-1',
        spaceId: 'space-1'
      });
      noteService.createNote({
        id: 'note-title-a',
        title: 'Alpha',
        rawMarkdown: 'alpha',
        folderId: 'folder-1',
        spaceId: 'space-1'
      });

      const notes = noteService.listNotes({
        spaceId: 'space-1',
        sortBy: 'title',
        order: 'asc'
      });

      assert.equal(notes[0].title, 'Alpha');
      assert.equal(notes[1].title, 'Zoo');
    }
  },
  {
    name: 'listNotes supports offset and limit together',
    async run() {
      const { createNoteService } = await import('../src/modules/knowledge/application/note-service.js');
      const noteService = createNoteService();

      noteService.createNote({
        id: 'note-page-a',
        title: 'Alpha',
        rawMarkdown: 'alpha',
        folderId: 'folder-1',
        spaceId: 'space-1',
        updatedAt: '2026-06-02T10:00:00.000Z'
      });
      noteService.createNote({
        id: 'note-page-b',
        title: 'Beta',
        rawMarkdown: 'beta',
        folderId: 'folder-1',
        spaceId: 'space-1',
        updatedAt: '2026-06-02T11:00:00.000Z'
      });
      noteService.createNote({
        id: 'note-page-c',
        title: 'Gamma',
        rawMarkdown: 'gamma',
        folderId: 'folder-1',
        spaceId: 'space-1',
        updatedAt: '2026-06-02T12:00:00.000Z'
      });

      const notes = noteService.listNotes({
        spaceId: 'space-1',
        limit: 1,
        offset: 1
      });

      assert.equal(notes.length, 1);
      assert.equal(notes[0].title, 'Beta');
    }
  },
  {
    name: 'listNotes can return only deleted notes for recycle bin views',
    async run() {
      const { createNoteService } = await import('../src/modules/knowledge/application/note-service.js');
      const noteService = createNoteService();

      noteService.createNote({
        id: 'note-active',
        title: 'Active note',
        rawMarkdown: 'still here',
        folderId: 'folder-1',
        spaceId: 'space-1'
      });
      noteService.createNote({
        id: 'note-deleted-only',
        title: 'Deleted note',
        rawMarkdown: 'in recycle bin',
        folderId: 'folder-1',
        spaceId: 'space-1'
      });
      noteService.deleteNote('note-deleted-only');

      const deletedNotes = noteService.listNotes({
        spaceId: 'space-1',
        deletedOnly: true
      });

      assert.equal(deletedNotes.length, 1);
      assert.equal(deletedNotes[0].id, 'note-deleted-only');
      assert.equal(deletedNotes[0].deleted, true);
    }
  },
  {
    name: 'deleteNote marks note as deleted without removing it from storage',
    async run() {
      const { createNoteService } = await import('../src/modules/knowledge/application/note-service.js');
      const noteService = createNoteService();

      noteService.createNote({
        id: 'note-13',
        title: 'Delete me',
        rawMarkdown: 'temporary note',
        folderId: 'folder-1',
        spaceId: 'space-1'
      });

      const deleted = noteService.deleteNote('note-13');

      assert.equal(deleted.deleted, true);
      assert.equal(noteService.listNotes({ includeDeleted: true }).length, 1);
      assert.equal(noteService.listNotes().length, 0);
    }
  },
  {
    name: 'restoreNote returns deleted notes to active lists',
    async run() {
      const { createNoteService } = await import('../src/modules/knowledge/application/note-service.js');
      const noteService = createNoteService();

      noteService.createNote({
        id: 'note-restore',
        title: 'Restore me',
        rawMarkdown: 'restore flow',
        folderId: 'folder-1',
        spaceId: 'space-1'
      });
      noteService.deleteNote('note-restore');

      const restored = noteService.restoreNote('note-restore');

      assert.equal(restored.deleted, false);
      assert.equal(noteService.listNotes().length, 1);
      assert.equal(noteService.listNotes({ deletedOnly: true }).length, 0);
    }
  },
  {
    name: 'setFavorite can also clear a favorite mark',
    async run() {
      const { createNoteService } = await import('../src/modules/knowledge/application/note-service.js');
      const noteService = createNoteService();

      noteService.createNote({
        id: 'note-unfavorite',
        title: 'Unfavorite me',
        rawMarkdown: 'favorite flow',
        folderId: 'folder-1',
        spaceId: 'space-1',
        favorite: true
      });

      const updated = noteService.setFavorite('note-unfavorite', false);

      assert.equal(updated.favorite, false);
      assert.equal(noteService.getNote('note-unfavorite').favorite, false);
    }
  },
  {
    name: 'createNote derives title when it is missing but markdown exists',
    async run() {
      const { createNoteService } = await import('../src/modules/knowledge/application/note-service.js');
      const noteService = createNoteService();

      const note = noteService.createNote({
        id: 'note-11',
        title: '',
        rawMarkdown: '# Derived title\n\ncontent',
        folderId: 'folder-1',
        spaceId: 'space-1'
      });

      assert.equal(note.title, 'Derived title');
    }
  },
  {
    name: 'updateNote throws when note does not exist',
    async run() {
      const { createNoteService } = await import('../src/modules/knowledge/application/note-service.js');
      const noteService = createNoteService();

      assert.throws(() => {
        noteService.updateNote('missing-note', {
          title: 'Nope',
          rawMarkdown: 'Nothing here'
        });
      }, /note not found/i);
    }
  },
  {
    name: 'assignTagToNote throws when note does not exist',
    async run() {
      const { createNoteService } = await import('../src/modules/knowledge/application/note-service.js');
      const noteService = createNoteService();

      assert.throws(() => {
        noteService.assignTagToNote('missing-note', 'tag-1');
      }, /note not found/i);
    }
  },
  {
    name: 'createNote rejects sibling names that conflict with folder names',
    async run() {
      const { createNoteService } = await import('../src/modules/knowledge/application/note-service.js');
      const noteService = createNoteService({
        validateSiblingNameConflict({ spaceId, folderId, title }) {
          assert.equal(spaceId, 'space-1');
          assert.equal(folderId, 'folder-1');
          assert.equal(title, 'test');
          throw new Error('A file or folder with the same name already exists');
        }
      });

      assert.throws(() => {
        noteService.createNote({
          id: 'note-conflict',
          title: 'test',
          rawMarkdown: '# test',
          folderId: 'folder-1',
          spaceId: 'space-1'
        });
      }, /same name already exists/i);
    }
  },
  {
    name: 'updateNote rejects a stale expectedUpdatedAt concurrency token',
    async run() {
      const { createNoteService } = await import('../src/modules/knowledge/application/note-service.js');
      const noteService = createNoteService();
      const note = noteService.createNote({
        id: 'note-stale-update',
        title: 'Original',
        rawMarkdown: 'original',
        spaceId: 'space-1',
        updatedAt: '2026-07-30T00:00:00.000Z'
      });
      noteService.updateNote(note.id, {
        title: 'First update',
        expectedUpdatedAt: note.updatedAt,
        updatedAt: '2026-07-30T00:01:00.000Z'
      });

      assert.throws(
        () =>
          noteService.updateNote(note.id, {
            title: 'Stale update',
            expectedUpdatedAt: note.updatedAt
          }),
        error => error.code === 'NOTE_UPDATE_CONFLICT' && error.statusCode === 409
      );
      assert.equal(noteService.getNote(note.id).title, 'First update');
    }
  },
  {
    name: '旧保存映射在没有时间戳时仍保护正文并发，同步与异步服务一致',
    async run() {
      const { calculateContentHash } = await import('@study-accelerator/content-anchor');
      const { createNoteService } = await import('../src/modules/knowledge/application/note-service.js');
      const { createAsyncNoteService } =
        await import('../src/modules/knowledge/application/postgres-async/note-service.js');
      const { createInMemoryNoteRepository } =
        await import('../src/modules/knowledge/infrastructure/note-repository.ts');
      const repository = createInMemoryNoteRepository();
      const sync = createNoteService({ repository });
      const asyncService = createAsyncNoteService({ repository });
      const note = sync.createNote({ id: 'legacy-baseline', spaceId: 'space-1', title: '并发', rawMarkdown: '原文' });
      const oldMapping = { baseContentHash: calculateContentHash(note.rawMarkdown) };
      sync.updateNote(note.id, { rawMarkdown: '其他设备的新正文', updatedAt: '2026-11-01T00:00:01.000Z' });
      assert.throws(() => sync.updateNote(note.id, { rawMarkdown: '过期草稿', annotationMapping: oldMapping }), {
        code: 'NOTE_UPDATE_CONFLICT'
      });
      await assert.rejects(
        asyncService.updateNote(note.id, { rawMarkdown: '过期草稿', annotationMapping: oldMapping }),
        {
          code: 'NOTE_UPDATE_CONFLICT'
        }
      );
      assert.equal(sync.getNote(note.id).rawMarkdown, '其他设备的新正文');
      const current = sync.getNote(note.id);
      const saved = await asyncService.updateNote(note.id, {
        rawMarkdown: '采用时间戳的保存',
        expectedUpdatedAt: current.updatedAt,
        annotationMapping: oldMapping
      });
      assert.equal(saved.rawMarkdown, '采用时间戳的保存');
    }
  }
];
