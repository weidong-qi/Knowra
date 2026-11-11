import assert from 'node:assert/strict';

export const searchServiceTests = [
  {
    name: 'searchNotes finds notes by keyword in title and plain text',
    async run() {
      const { createNoteService } = await import('../src/modules/knowledge/application/note-service.ts');
      const { createSearchService } = await import('../src/modules/knowledge/application/search-service.ts');

      const noteService = createNoteService();
      noteService.createNote({
        id: 'note-a',
        spaceId: 'space-1',
        folderId: 'folder-1',
        title: 'Redis basics',
        rawMarkdown: 'Use Redis for cache and queue.'
      });
      noteService.createNote({
        id: 'note-b',
        spaceId: 'space-1',
        folderId: 'folder-2',
        title: 'Postgres indexing',
        rawMarkdown: 'B-tree indexes speed up lookups.'
      });

      const searchService = createSearchService({
        listNotes: () => noteService.listNotes()
      });

      const results = searchService.searchNotes({
        query: 'redis',
        spaceId: 'space-1'
      });

      assert.equal(results.length, 1);
      assert.equal(results[0].id, 'note-a');
    }
  },
  {
    name: 'searchNotes filters by folderId within a space',
    async run() {
      const { createNoteService } = await import('../src/modules/knowledge/application/note-service.ts');
      const { createSearchService } = await import('../src/modules/knowledge/application/search-service.ts');

      const noteService = createNoteService();
      noteService.createNote({
        id: 'note-c',
        spaceId: 'space-2',
        folderId: 'folder-1',
        title: 'Queue patterns',
        rawMarkdown: 'BullMQ runs background jobs.'
      });
      noteService.createNote({
        id: 'note-d',
        spaceId: 'space-2',
        folderId: 'folder-2',
        title: 'API design',
        rawMarkdown: 'NestJS modules keep boundaries clear.'
      });

      const searchService = createSearchService({
        listNotes: () => noteService.listNotes()
      });

      const results = searchService.searchNotes({
        query: 'jobs',
        spaceId: 'space-2',
        folderId: 'folder-1'
      });

      assert.equal(results.length, 1);
      assert.equal(results[0].id, 'note-c');
    }
  },
  {
    name: 'searchNotes excludes soft-deleted notes',
    async run() {
      const { createNoteService } = await import('../src/modules/knowledge/application/note-service.ts');
      const { createSearchService } = await import('../src/modules/knowledge/application/search-service.ts');

      const noteService = createNoteService();
      noteService.createNote({
        id: 'note-e',
        spaceId: 'space-3',
        folderId: 'folder-1',
        title: 'Deleted cache note',
        rawMarkdown: 'Redis cache note'
      });
      noteService.deleteNote('note-e');

      const searchService = createSearchService({
        listNotes: options => noteService.listNotes(options)
      });

      const results = searchService.searchNotes({
        query: 'redis',
        spaceId: 'space-3'
      });

      assert.equal(results.length, 0);
    }
  },
  {
    name: 'searchNotes filters by tagId within a space',
    async run() {
      const { createNoteService } = await import('../src/modules/knowledge/application/note-service.ts');
      const { createSearchService } = await import('../src/modules/knowledge/application/search-service.ts');

      const noteService = createNoteService();
      noteService.createNote({
        id: 'note-tag-a',
        spaceId: 'space-4',
        folderId: 'folder-1',
        title: 'Redis queue',
        rawMarkdown: 'BullMQ uses Redis.'
      });
      noteService.createNote({
        id: 'note-tag-b',
        spaceId: 'space-4',
        folderId: 'folder-2',
        title: 'Postgres indexing',
        rawMarkdown: 'GIN and B-tree indexes'
      });

      noteService.assignTagToNote('note-tag-a', 'tag-infra');
      noteService.assignTagToNote('note-tag-b', 'tag-db');

      const searchService = createSearchService({
        listNotes: options => noteService.listNotes(options)
      });

      const results = searchService.searchNotes({
        query: 'indexes',
        spaceId: 'space-4',
        tagId: 'tag-db'
      });

      assert.equal(results.length, 1);
      assert.equal(results[0].id, 'note-tag-b');
    }
  },
  {
    name: 'searchNotes can search inside recycle bin when deletedOnly is enabled',
    async run() {
      const { createNoteService } = await import('../src/modules/knowledge/application/note-service.ts');
      const { createSearchService } = await import('../src/modules/knowledge/application/search-service.ts');

      const noteService = createNoteService();
      noteService.createNote({
        id: 'note-deleted-search',
        spaceId: 'space-5',
        folderId: 'folder-1',
        title: 'Deleted Redis note',
        rawMarkdown: 'Redis in recycle bin'
      });
      noteService.deleteNote('note-deleted-search');

      const searchService = createSearchService({
        listNotes: options => noteService.listNotes(options)
      });

      const results = searchService.searchNotes({
        query: 'redis',
        spaceId: 'space-5',
        deletedOnly: true
      });

      assert.equal(results.length, 1);
      assert.equal(results[0].id, 'note-deleted-search');
      assert.equal(results[0].deleted, true);
    }
  },
  {
    name: 'searchNotes can filter to favorite notes only',
    async run() {
      const { createNoteService } = await import('../src/modules/knowledge/application/note-service.ts');
      const { createSearchService } = await import('../src/modules/knowledge/application/search-service.ts');

      const noteService = createNoteService();
      noteService.createNote({
        id: 'note-favorite-search-a',
        spaceId: 'space-6',
        folderId: 'folder-1',
        title: 'Favorite Redis note',
        rawMarkdown: 'redis favorite body',
        favorite: true
      });
      noteService.createNote({
        id: 'note-favorite-search-b',
        spaceId: 'space-6',
        folderId: 'folder-1',
        title: 'Regular Redis note',
        rawMarkdown: 'redis regular body'
      });

      const searchService = createSearchService({
        listNotes: options => noteService.listNotes(options)
      });

      const results = searchService.searchNotes({
        query: 'redis',
        spaceId: 'space-6',
        favoriteOnly: true
      });

      assert.equal(results.length, 1);
      assert.equal(results[0].id, 'note-favorite-search-a');
    }
  }
];
