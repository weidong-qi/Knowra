import assert from 'node:assert/strict';

export const folderRepositoryTests = [
  {
    name: 'FolderRepository saves and finds folder by id',
    async run() {
      const { createInMemoryFolderRepository } =
        await import('../src/modules/knowledge/infrastructure/folder-repository.ts');
      const repository = createInMemoryFolderRepository();

      repository.save({
        id: 'folder-repo-1',
        spaceId: 'space-1',
        parentId: null,
        name: 'Algorithms',
        pathCache: '/'
      });

      const folder = repository.findById('folder-repo-1');

      assert.equal(folder.id, 'folder-repo-1');
      assert.equal(folder.name, 'Algorithms');
    }
  },
  {
    name: 'FolderRepository list filters by spaceId',
    async run() {
      const { createInMemoryFolderRepository } =
        await import('../src/modules/knowledge/infrastructure/folder-repository.ts');
      const repository = createInMemoryFolderRepository();

      repository.save({
        id: 'folder-repo-2',
        spaceId: 'space-a',
        parentId: null,
        name: 'A',
        pathCache: '/'
      });
      repository.save({
        id: 'folder-repo-3',
        spaceId: 'space-b',
        parentId: null,
        name: 'B',
        pathCache: '/'
      });

      const folders = repository.list({ spaceId: 'space-a' });

      assert.equal(folders.length, 1);
      assert.equal(folders[0].id, 'folder-repo-2');
    }
  }
];
