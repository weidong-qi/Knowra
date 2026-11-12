import assert from 'node:assert/strict';

export const knowledgeHttpTests = [
  {
    name: 'knowledge handlers enforce the server owner and ignore client user ids',
    async run() {
      const { createKnowledgeModule } = await import('../src/modules/knowledge/index.js');
      const { createKnowledgeHttpHandlers } = await import('../src/modules/knowledge/http/knowledge-handlers.ts');

      const knowledgeModule = createKnowledgeModule();
      const handlers = createKnowledgeHttpHandlers({
        knowledgeModule,
        ownerId: 'local-owner'
      });
      knowledgeModule.knowledgeSpaceService.createDefaultKnowledgeSpace({
        userId: 'other-owner'
      });

      const created = handlers.createDefaultKnowledgeSpace({
        userId: 'attacker-controlled'
      });
      const listed = handlers.listKnowledgeSpaces({
        userId: 'other-owner'
      });

      assert.equal(created.userId, 'local-owner');
      assert.equal(created.id, 'space-local-owner');
      assert.deepEqual(
        listed.map(space => space.userId),
        ['local-owner']
      );
    }
  },
  {
    name: 'knowledge handlers can create and list notes',
    async run() {
      const { createKnowledgeModule } = await import('../src/modules/knowledge/index.js');
      const { createKnowledgeHttpHandlers } = await import('../src/modules/knowledge/http/knowledge-handlers.ts');

      const knowledgeModule = createKnowledgeModule();
      const handlers = createKnowledgeHttpHandlers({ knowledgeModule });

      const created = handlers.createNote({
        id: 'http-note-1',
        title: 'HTTP note',
        rawMarkdown: 'content from handler',
        folderId: 'folder-1',
        spaceId: 'space-1'
      });

      const list = handlers.listNotes({
        spaceId: 'space-1'
      });

      assert.equal(created.id, 'http-note-1');
      assert.equal(list.length, 1);
      assert.equal(list[0].title, 'HTTP note');
    }
  },
  {
    name: 'knowledge handlers can fetch a full note detail',
    async run() {
      const { createKnowledgeModule } = await import('../src/modules/knowledge/index.js');
      const { createKnowledgeHttpHandlers } = await import('../src/modules/knowledge/http/knowledge-handlers.ts');

      const knowledgeModule = createKnowledgeModule();
      const handlers = createKnowledgeHttpHandlers({ knowledgeModule });

      handlers.createNote({
        id: 'http-note-detail',
        title: 'Detail note',
        rawMarkdown: '# Detail\n\nLonger body',
        folderId: 'folder-1',
        spaceId: 'space-1'
      });

      const note = handlers.getNote({ id: 'http-note-detail' });

      assert.equal(note.id, 'http-note-detail');
      assert.equal(note.rawMarkdown, '# Detail\n\nLonger body');
    }
  },
  {
    name: 'knowledge handlers return compact note summaries and search ids on request',
    async run() {
      const { createKnowledgeModule } = await import('../src/modules/knowledge/index.js');
      const { createKnowledgeHttpHandlers } = await import('../src/modules/knowledge/http/knowledge-handlers.ts');

      const handlers = createKnowledgeHttpHandlers({
        knowledgeModule: createKnowledgeModule()
      });
      handlers.createNote({
        id: 'http-summary-note',
        title: 'Compact detail',
        rawMarkdown: '# Compact\n\nSearchable body',
        spaceId: 'space-summary'
      });

      const [summary] = handlers.listNotes({
        spaceId: 'space-summary',
        summaryOnly: 'true'
      });
      const ids = handlers.searchNotes({
        query: 'searchable',
        spaceId: 'space-summary',
        result: 'ids'
      });

      assert.equal(Object.hasOwn(summary, 'rawMarkdown'), false);
      assert.deepEqual(ids, ['http-summary-note']);
    }
  },
  {
    name: 'knowledge handlers can restore deleted notes and read them with includeDeleted',
    async run() {
      const { createKnowledgeModule } = await import('../src/modules/knowledge/index.js');
      const { createKnowledgeHttpHandlers } = await import('../src/modules/knowledge/http/knowledge-handlers.ts');

      const knowledgeModule = createKnowledgeModule();
      const handlers = createKnowledgeHttpHandlers({ knowledgeModule });

      handlers.createNote({
        id: 'http-note-restore',
        title: 'Restore detail note',
        rawMarkdown: 'body',
        folderId: 'folder-1',
        spaceId: 'space-1'
      });
      handlers.deleteNote({ id: 'http-note-restore' });

      const deleted = handlers.getNote({ id: 'http-note-restore' }, { includeDeleted: true });
      const restored = handlers.restoreNote({ id: 'http-note-restore' });

      assert.equal(deleted.deleted, true);
      assert.equal(restored.deleted, false);
      assert.equal(handlers.listNotes({ deletedOnly: true }).length, 0);
    }
  },
  {
    name: 'knowledge handlers can set favorite status on a note',
    async run() {
      const { createKnowledgeModule } = await import('../src/modules/knowledge/index.js');
      const { createKnowledgeHttpHandlers } = await import('../src/modules/knowledge/http/knowledge-handlers.ts');

      const knowledgeModule = createKnowledgeModule();
      const handlers = createKnowledgeHttpHandlers({ knowledgeModule });

      handlers.createNote({
        id: 'http-favorite-note',
        title: 'Favorite note',
        rawMarkdown: 'favorite body',
        folderId: 'folder-1',
        spaceId: 'space-1'
      });

      const updated = handlers.setFavorite({ id: 'http-favorite-note' }, { favorite: true });
      const favorites = handlers.listNotes({
        spaceId: 'space-1',
        favoriteOnly: true
      });

      assert.equal(updated.favorite, true);
      assert.equal(favorites.length, 1);
      assert.equal(favorites[0].id, 'http-favorite-note');
    }
  },
  {
    name: 'knowledge handlers support batch delete and batch tag assignment',
    async run() {
      const { createKnowledgeModule } = await import('../src/modules/knowledge/index.js');
      const { createKnowledgeHttpHandlers } = await import('../src/modules/knowledge/http/knowledge-handlers.ts');

      const knowledgeModule = createKnowledgeModule();
      const handlers = createKnowledgeHttpHandlers({ knowledgeModule });

      handlers.createNote({
        id: 'http-batch-a',
        title: 'Batch A',
        rawMarkdown: 'batch a',
        folderId: 'folder-1',
        spaceId: 'space-1'
      });
      handlers.createNote({
        id: 'http-batch-b',
        title: 'Batch B',
        rawMarkdown: 'batch b',
        folderId: 'folder-1',
        spaceId: 'space-1'
      });

      const tagged = handlers.assignTagToNotes({
        noteIds: ['http-batch-a', 'http-batch-b'],
        tagId: 'tag-shared'
      });
      const deleted = handlers.deleteNotes({
        noteIds: ['http-batch-a', 'http-batch-b']
      });

      assert.equal(tagged.length, 2);
      assert.deepEqual(handlers.getNote({ id: 'http-batch-a' }, { includeDeleted: true }).tagIds, ['tag-shared']);
      assert.equal(deleted.length, 2);
      assert.equal(handlers.listNotes({ deletedOnly: true }).length, 2);
    }
  },
  {
    name: 'knowledge handlers can assign one tag to one note',
    async run() {
      const { createKnowledgeModule } = await import('../src/modules/knowledge/index.js');
      const { createKnowledgeHttpHandlers } = await import('../src/modules/knowledge/http/knowledge-handlers.ts');

      const handlers = createKnowledgeHttpHandlers({ knowledgeModule: createKnowledgeModule() });
      handlers.createNote({
        id: 'http-single-tag',
        title: 'Single Tag',
        rawMarkdown: 'single tag',
        spaceId: 'space-1'
      });

      const tagged = handlers.assignTagToNote({ id: 'http-single-tag' }, { tagId: 'tag-one' });

      assert.deepEqual(tagged.tagIds, ['tag-one']);
    }
  },
  {
    name: 'knowledge handlers can return linked notes for a note detail',
    async run() {
      const { createKnowledgeModule } = await import('../src/modules/knowledge/index.js');
      const { createKnowledgeHttpHandlers } = await import('../src/modules/knowledge/http/knowledge-handlers.ts');

      const knowledgeModule = createKnowledgeModule();
      const handlers = createKnowledgeHttpHandlers({ knowledgeModule });

      handlers.createNote({
        id: 'http-link-target',
        title: 'Linked target',
        rawMarkdown: 'target body',
        folderId: 'folder-1',
        spaceId: 'space-1'
      });
      handlers.createNote({
        id: 'http-link-source',
        title: 'Linked source',
        rawMarkdown: 'See [[http-link-target]].',
        folderId: 'folder-1',
        spaceId: 'space-1'
      });

      const linked = handlers.getLinkedNotes({ id: 'http-link-source' });

      assert.equal(linked.length, 1);
      assert.equal(linked[0].id, 'http-link-target');
    }
  },
  {
    name: 'knowledge handlers can import markdown notes',
    async run() {
      const { createKnowledgeModule } = await import('../src/modules/knowledge/index.js');
      const { createKnowledgeHttpHandlers } = await import('../src/modules/knowledge/http/knowledge-handlers.ts');

      const knowledgeModule = createKnowledgeModule();
      const handlers = createKnowledgeHttpHandlers({ knowledgeModule });

      const imported = handlers.importMarkdown({
        rawMarkdown: '# Imported HTTP Note\n\nbody',
        spaceId: 'space-http-import',
        folderId: 'folder-1'
      });

      assert.equal(imported.title, 'Imported HTTP Note');
      assert.equal(imported.sourceType, 'markdown-import');
      assert.match(imported.id, /^note-imported-http-note-/);
    }
  },
  {
    name: 'knowledge handlers can batch import markdown notes',
    async run() {
      const { createKnowledgeModule } = await import('../src/modules/knowledge/index.js');
      const { createKnowledgeHttpHandlers } = await import('../src/modules/knowledge/http/knowledge-handlers.ts');

      const knowledgeModule = createKnowledgeModule();
      const handlers = createKnowledgeHttpHandlers({ knowledgeModule });

      const imported = handlers.importMarkdownBatch({
        items: [
          {
            rawMarkdown: '# Batch One\n\nbody',
            spaceId: 'space-batch',
            folderId: 'folder-1'
          },
          {
            rawMarkdown: '# Batch Two\n\nbody',
            spaceId: 'space-batch',
            folderId: 'folder-1'
          }
        ]
      });

      assert.equal(imported.length, 2);
      assert.equal(imported[0].sourceType, 'markdown-import');
      assert.equal(imported[1].title, 'Batch Two');
    }
  },
  {
    name: 'knowledge handlers can search notes through query input',
    async run() {
      const { createKnowledgeModule } = await import('../src/modules/knowledge/index.js');
      const { createKnowledgeHttpHandlers } = await import('../src/modules/knowledge/http/knowledge-handlers.ts');

      const knowledgeModule = createKnowledgeModule();
      const handlers = createKnowledgeHttpHandlers({ knowledgeModule });

      handlers.createNote({
        id: 'http-note-2',
        title: 'Redis queues',
        rawMarkdown: 'BullMQ depends on Redis.',
        folderId: 'folder-1',
        spaceId: 'space-2'
      });

      const results = handlers.searchNotes({
        query: 'redis',
        spaceId: 'space-2'
      });

      assert.equal(results.length, 1);
      assert.equal(results[0].id, 'http-note-2');
    }
  },
  {
    name: 'knowledge handlers pass sort options to note listing and search',
    async run() {
      const { createKnowledgeModule } = await import('../src/modules/knowledge/index.js');
      const { createKnowledgeHttpHandlers } = await import('../src/modules/knowledge/http/knowledge-handlers.ts');

      const knowledgeModule = createKnowledgeModule();
      const handlers = createKnowledgeHttpHandlers({ knowledgeModule });

      handlers.createNote({
        id: 'http-sort-b',
        title: 'Beta',
        rawMarkdown: 'beta content',
        folderId: 'folder-1',
        spaceId: 'space-sort'
      });
      handlers.createNote({
        id: 'http-sort-a',
        title: 'Alpha',
        rawMarkdown: 'alpha content',
        folderId: 'folder-1',
        spaceId: 'space-sort'
      });

      const listed = handlers.listNotes({
        spaceId: 'space-sort',
        sortBy: 'title',
        order: 'asc'
      });
      const searched = handlers.searchNotes({
        query: 'content',
        spaceId: 'space-sort',
        sortBy: 'title',
        order: 'asc',
        limit: 1
      });

      assert.deepEqual(
        listed.map(note => note.title),
        ['Alpha', 'Beta']
      );
      assert.deepEqual(
        searched.map(note => note.title),
        ['Alpha']
      );
    }
  },
  {
    name: 'knowledge handlers can update and delete folders and tags',
    async run() {
      const { createKnowledgeModule } = await import('../src/modules/knowledge/index.js');
      const { createKnowledgeHttpHandlers } = await import('../src/modules/knowledge/http/knowledge-handlers.ts');

      const knowledgeModule = createKnowledgeModule();
      const handlers = createKnowledgeHttpHandlers({ knowledgeModule });

      handlers.createFolder({
        id: 'http-folder-1',
        spaceId: 'space-1',
        name: 'Draft Folder'
      });
      const updatedFolder = handlers.updateFolder(
        { id: 'http-folder-1' },
        { name: 'Final Folder', pathCache: '/final-folder' }
      );
      handlers.deleteFolder({ id: 'http-folder-1' }, { mode: 'keep', destinationId: null });

      handlers.createTag({
        id: 'http-tag-1',
        spaceId: 'space-1',
        name: 'redis'
      });
      const updatedTag = handlers.updateTag({ id: 'http-tag-1' }, { name: 'cache', color: 'amber' });
      handlers.deleteTag({ id: 'http-tag-1' });

      assert.equal(updatedFolder.name, 'Final Folder');
      assert.equal(updatedTag.color, 'orange');
      assert.equal(handlers.listFolders({ spaceId: 'space-1' }).length, 0);
      assert.equal(handlers.listTags({ spaceId: 'space-1' }).length, 0);
    }
  },
  {
    name: 'knowledge handlers can return a nested folder tree',
    async run() {
      const { createKnowledgeModule } = await import('../src/modules/knowledge/index.js');
      const { createKnowledgeHttpHandlers } = await import('../src/modules/knowledge/http/knowledge-handlers.ts');

      const knowledgeModule = createKnowledgeModule();
      const handlers = createKnowledgeHttpHandlers({ knowledgeModule });

      handlers.createFolder({
        id: 'tree-root',
        spaceId: 'space-1',
        name: 'Root'
      });
      handlers.createFolder({
        id: 'tree-child',
        spaceId: 'space-1',
        parentId: 'tree-root',
        name: 'Child'
      });

      const tree = handlers.listFolderTree({ spaceId: 'space-1' });

      assert.equal(tree.length, 1);
      assert.equal(tree[0].children[0].id, 'tree-child');
    }
  },
  {
    name: 'deleting folders and tags cleans up note associations',
    async run() {
      const { createKnowledgeModule } = await import('../src/modules/knowledge/index.js');
      const { createKnowledgeHttpHandlers } = await import('../src/modules/knowledge/http/knowledge-handlers.ts');

      const knowledgeModule = createKnowledgeModule();
      const handlers = createKnowledgeHttpHandlers({ knowledgeModule });

      handlers.createFolder({
        id: 'cleanup-folder',
        spaceId: 'space-1',
        name: 'Cleanup Folder'
      });
      handlers.createTag({
        id: 'cleanup-tag',
        spaceId: 'space-1',
        name: 'cleanup'
      });
      handlers.createNote({
        id: 'cleanup-note',
        title: 'Cleanup note',
        rawMarkdown: 'cleanup content',
        folderId: 'cleanup-folder',
        spaceId: 'space-1'
      });
      knowledgeModule.noteService.assignTagToNote('cleanup-note', 'cleanup-tag');

      handlers.deleteFolder({ id: 'cleanup-folder' }, { mode: 'keep', destinationId: null });
      handlers.deleteTag({ id: 'cleanup-tag' });

      const note = handlers.getNote({ id: 'cleanup-note' });

      assert.equal(note.folderId, null);
      assert.deepEqual(note.tagIds, []);
    }
  },
  {
    name: 'knowledge handlers can remove a tag from a note directly',
    async run() {
      const { createKnowledgeModule } = await import('../src/modules/knowledge/index.js');
      const { createKnowledgeHttpHandlers } = await import('../src/modules/knowledge/http/knowledge-handlers.ts');

      const knowledgeModule = createKnowledgeModule();
      const handlers = createKnowledgeHttpHandlers({ knowledgeModule });

      handlers.createNote({
        id: 'http-note-tag-remove',
        title: 'Tagged note',
        rawMarkdown: 'tag me',
        folderId: 'folder-1',
        spaceId: 'space-1'
      });
      knowledgeModule.noteService.assignTagToNote('http-note-tag-remove', 'tag-a');
      knowledgeModule.noteService.assignTagToNote('http-note-tag-remove', 'tag-b');

      const updated = handlers.removeTagFromNote({ id: 'http-note-tag-remove', tagId: 'tag-a' });

      assert.deepEqual(updated.tagIds, ['tag-b']);
    }
  },
  {
    name: 'knowledge handlers can replace note tags in one operation',
    async run() {
      const { createKnowledgeModule } = await import('../src/modules/knowledge/index.js');
      const { createKnowledgeHttpHandlers } = await import('../src/modules/knowledge/http/knowledge-handlers.ts');

      const knowledgeModule = createKnowledgeModule();
      const handlers = createKnowledgeHttpHandlers({ knowledgeModule });

      handlers.createNote({
        id: 'http-note-tag-set',
        title: 'Set tags note',
        rawMarkdown: 'tag sync content',
        folderId: 'folder-1',
        spaceId: 'space-1'
      });

      const updated = handlers.setNoteTags({ id: 'http-note-tag-set' }, { tagIds: ['tag-cache', 'tag-db'] });

      assert.deepEqual(updated.tagIds, ['tag-cache', 'tag-db']);
    }
  }
];
