import assert from 'node:assert/strict';

export const noteRepositoryTests = [
  {
    name: 'NoteRepository saves and retrieves notes by id',
    async run() {
      const { createInMemoryNoteRepository } =
        await import('../src/modules/knowledge/infrastructure/note-repository.js');
      const repository = createInMemoryNoteRepository();

      repository.save({
        id: 'repo-note-1',
        title: 'Repository note',
        rawMarkdown: 'content',
        plainText: 'content',
        spaceId: 'space-1',
        folderId: 'folder-1',
        tagIds: [],
        deleted: false
      });

      const note = repository.findById('repo-note-1');

      assert.equal(note.id, 'repo-note-1');
      assert.equal(note.title, 'Repository note');
    }
  },
  {
    name: 'NoteRepository list applies space and tag filters',
    async run() {
      const { createInMemoryNoteRepository } =
        await import('../src/modules/knowledge/infrastructure/note-repository.js');
      const repository = createInMemoryNoteRepository();

      repository.save({
        id: 'repo-note-2',
        title: 'Redis',
        rawMarkdown: 'redis',
        plainText: 'redis',
        spaceId: 'space-a',
        folderId: 'folder-1',
        tagIds: ['tag-cache'],
        deleted: false
      });
      repository.save({
        id: 'repo-note-3',
        title: 'Postgres',
        rawMarkdown: 'postgres',
        plainText: 'postgres',
        spaceId: 'space-b',
        folderId: 'folder-2',
        tagIds: ['tag-db'],
        deleted: false
      });

      const results = repository.list({
        spaceId: 'space-a',
        tagId: 'tag-cache'
      });

      assert.equal(results.length, 1);
      assert.equal(results[0].id, 'repo-note-2');
    }
  },
  {
    name: 'NoteRepository list supports offset and limit after sorting',
    async run() {
      const { createInMemoryNoteRepository } =
        await import('../src/modules/knowledge/infrastructure/note-repository.js');
      const repository = createInMemoryNoteRepository();

      repository.save({
        id: 'repo-note-a',
        title: 'Alpha',
        rawMarkdown: 'alpha',
        plainText: 'alpha',
        spaceId: 'space-a',
        folderId: 'folder-1',
        tagIds: [],
        deleted: false,
        updatedAt: '2026-06-02T10:00:00.000Z'
      });
      repository.save({
        id: 'repo-note-b',
        title: 'Beta',
        rawMarkdown: 'beta',
        plainText: 'beta',
        spaceId: 'space-a',
        folderId: 'folder-1',
        tagIds: [],
        deleted: false,
        updatedAt: '2026-06-02T11:00:00.000Z'
      });
      repository.save({
        id: 'repo-note-c',
        title: 'Gamma',
        rawMarkdown: 'gamma',
        plainText: 'gamma',
        spaceId: 'space-a',
        folderId: 'folder-1',
        tagIds: [],
        deleted: false,
        updatedAt: '2026-06-02T12:00:00.000Z'
      });

      const results = repository.list({
        spaceId: 'space-a',
        limit: 1,
        offset: 1
      });

      assert.equal(results.length, 1);
      assert.equal(results[0].id, 'repo-note-b');
    }
  },
  {
    name: 'NoteRepository favorite notes are listed first and can be filtered',
    async run() {
      const { createInMemoryNoteRepository } =
        await import('../src/modules/knowledge/infrastructure/note-repository.js');
      const repository = createInMemoryNoteRepository();

      repository.save({
        id: 'repo-note-fav-b',
        title: 'Beta',
        rawMarkdown: 'beta',
        plainText: 'beta',
        spaceId: 'space-a',
        folderId: 'folder-1',
        tagIds: [],
        favorite: false,
        deleted: false,
        updatedAt: '2026-06-02T11:00:00.000Z'
      });
      repository.save({
        id: 'repo-note-fav-a',
        title: 'Alpha',
        rawMarkdown: 'alpha',
        plainText: 'alpha',
        spaceId: 'space-a',
        folderId: 'folder-1',
        tagIds: [],
        favorite: true,
        deleted: false,
        updatedAt: '2026-06-02T10:00:00.000Z'
      });

      const listed = repository.list({
        spaceId: 'space-a',
        sortBy: 'updatedAt',
        order: 'desc'
      });
      const favoriteOnly = repository.list({
        spaceId: 'space-a',
        favoriteOnly: true
      });

      assert.equal(listed[0].id, 'repo-note-fav-a');
      assert.equal(favoriteOnly.length, 1);
      assert.equal(favoriteOnly[0].id, 'repo-note-fav-a');
    }
  },
  {
    name: 'NoteRepository uses the shared delete method name',
    async run() {
      const { createInMemoryNoteRepository } =
        await import('../src/modules/knowledge/infrastructure/note-repository.js');
      const repository = createInMemoryNoteRepository();
      repository.save({
        id: 'repo-note-delete',
        title: 'Delete me',
        rawMarkdown: '',
        plainText: '',
        spaceId: 'space-a',
        folderId: null,
        tagIds: [],
        deleted: true
      });

      const deleted = repository.delete('repo-note-delete');

      assert.equal(deleted.id, 'repo-note-delete');
      assert.equal(repository.findById('repo-note-delete'), null);
      assert.equal(repository.deleteById, undefined);
    }
  }
];
