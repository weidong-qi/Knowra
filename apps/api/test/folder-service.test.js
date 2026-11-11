import assert from 'node:assert/strict';

export const folderServiceTests = [
  {
    name: 'createFolder returns a normalized folder entity',
    async run() {
      const { createFolderService } = await import('../src/modules/knowledge/application/folder-service.ts');
      const folderService = createFolderService();

      const folder = folderService.createFolder({
        id: 'folder-1',
        spaceId: 'space-1',
        name: ' Backend Notes '
      });

      assert.equal(folder.name, 'Backend Notes');
      assert.equal(folder.spaceId, 'space-1');
      assert.equal(folder.pathCache, '/backend-notes');
    }
  },
  {
    name: 'createFolder auto-generates an id when id is omitted',
    async run() {
      const { createFolderService } = await import('../src/modules/knowledge/application/folder-service.ts');
      const folderService = createFolderService();

      const folder = folderService.createFolder({
        spaceId: 'space-1',
        name: 'Generated Folder'
      });

      assert.match(folder.id, /^folder-/);
      assert.equal(folder.name, 'Generated Folder');
    }
  },
  {
    name: 'createFolder rejects a duplicate client-provided id',
    async run() {
      const { createFolderService } = await import('../src/modules/knowledge/application/folder-service.ts');
      const folderService = createFolderService();

      folderService.createFolder({
        id: 'folder-duplicate',
        spaceId: 'space-1',
        name: 'Original'
      });

      assert.throws(
        () =>
          folderService.createFolder({
            id: 'folder-duplicate',
            spaceId: 'space-1',
            name: 'Replacement'
          }),
        error => error.statusCode === 409 && error.code === 'FOLDER_ID_CONFLICT'
      );
    }
  },
  {
    name: 'createFolder throws when name is missing',
    async run() {
      const { createFolderService } = await import('../src/modules/knowledge/application/folder-service.ts');
      const folderService = createFolderService();

      assert.throws(() => {
        folderService.createFolder({
          id: 'folder-2',
          spaceId: 'space-1',
          name: ' '
        });
      }, /folder name is required/i);
    }
  },
  {
    name: 'listFolders filters folders by spaceId',
    async run() {
      const { createFolderService } = await import('../src/modules/knowledge/application/folder-service.ts');
      const folderService = createFolderService();

      folderService.createFolder({
        id: 'folder-space-1',
        spaceId: 'space-1',
        name: 'Backend'
      });
      folderService.createFolder({
        id: 'folder-space-2',
        spaceId: 'space-2',
        name: 'Frontend'
      });

      const folders = folderService.listFolders({ spaceId: 'space-1' });

      assert.equal(folders.length, 1);
      assert.equal(folders[0].id, 'folder-space-1');
    }
  },
  {
    name: 'updateFolder changes name and pathCache',
    async run() {
      const { createFolderService } = await import('../src/modules/knowledge/application/folder-service.ts');
      const folderService = createFolderService();

      folderService.createFolder({
        id: 'folder-update-1',
        spaceId: 'space-1',
        name: 'Old Name'
      });

      const updated = folderService.updateFolder('folder-update-1', {
        name: 'New Name',
        pathCache: '/new-name'
      });

      assert.equal(updated.name, 'New Name');
      assert.equal(updated.pathCache, '/new-name');
    }
  },
  {
    name: 'createFolder supports parent-child path building',
    async run() {
      const { createFolderService } = await import('../src/modules/knowledge/application/folder-service.ts');
      const folderService = createFolderService();

      folderService.createFolder({
        id: 'folder-parent',
        spaceId: 'space-1',
        name: 'Backend'
      });

      const child = folderService.createFolder({
        id: 'folder-child',
        spaceId: 'space-1',
        parentId: 'folder-parent',
        name: 'Redis'
      });

      assert.equal(child.parentId, 'folder-parent');
      assert.equal(child.pathCache, '/backend/redis');
    }
  },
  {
    name: 'updateFolder reindexes descendant paths when parent changes',
    async run() {
      const { createFolderService } = await import('../src/modules/knowledge/application/folder-service.ts');
      const folderService = createFolderService();

      folderService.createFolder({
        id: 'folder-a',
        spaceId: 'space-1',
        name: 'Backend'
      });
      folderService.createFolder({
        id: 'folder-b',
        spaceId: 'space-1',
        name: 'Architecture'
      });
      folderService.createFolder({
        id: 'folder-c',
        spaceId: 'space-1',
        parentId: 'folder-a',
        name: 'Redis'
      });

      folderService.updateFolder('folder-a', {
        parentId: 'folder-b'
      });

      const tree = folderService.listFolders({ spaceId: 'space-1' });
      const movedChild = tree.find(folder => folder.id === 'folder-c');

      assert.equal(movedChild.pathCache, '/architecture/backend/redis');
    }
  },
  {
    name: 'deleteFolder removes entire subtree',
    async run() {
      const { createFolderService } = await import('../src/modules/knowledge/application/folder-service.ts');
      const folderService = createFolderService();

      folderService.createFolder({
        id: 'folder-root',
        spaceId: 'space-1',
        name: 'Root'
      });
      folderService.createFolder({
        id: 'folder-child',
        spaceId: 'space-1',
        parentId: 'folder-root',
        name: 'Child'
      });

      const deleted = folderService.trashFolder('folder-root', {
        id: 'package-1',
        mode: 'keep',
        folderIds: ['folder-root', 'folder-child'],
        noteIds: [],
        destinationId: null
      });

      assert.equal(deleted.length, 2);
      assert.equal(folderService.listFolders({ spaceId: 'space-1' }).length, 0);
      assert.equal(folderService.restoreDeletedFolder('folder-root').length, 2);
    }
  },
  {
    name: 'listFolderTree returns nested folders',
    async run() {
      const { createFolderService } = await import('../src/modules/knowledge/application/folder-service.ts');
      const folderService = createFolderService();

      folderService.createFolder({
        id: 'folder-root',
        spaceId: 'space-1',
        name: 'Root'
      });
      folderService.createFolder({
        id: 'folder-child',
        spaceId: 'space-1',
        parentId: 'folder-root',
        name: 'Child'
      });

      const tree = folderService.listFolderTree({ spaceId: 'space-1' });

      assert.equal(tree.length, 1);
      assert.equal(tree[0].children.length, 1);
      assert.equal(tree[0].children[0].id, 'folder-child');
    }
  },
  {
    name: 'deleteFolder removes folder from active list',
    async run() {
      const { createFolderService } = await import('../src/modules/knowledge/application/folder-service.ts');
      const folderService = createFolderService();

      folderService.createFolder({
        id: 'folder-delete-1',
        spaceId: 'space-1',
        name: 'Delete Me'
      });

      const deleted = folderService.trashFolder('folder-delete-1', {
        id: 'package-2',
        mode: 'keep',
        folderIds: ['folder-delete-1'],
        noteIds: [],
        destinationId: null
      });

      assert.equal(deleted[0].id, 'folder-delete-1');
      assert.equal(folderService.listFolders({ spaceId: 'space-1' }).length, 0);
    }
  },
  {
    name: 'createFolder rejects sibling names that conflict with note titles',
    async run() {
      const { createFolderService } = await import('../src/modules/knowledge/application/folder-service.ts');
      const folderService = createFolderService({
        validateSiblingNameConflict({ spaceId, parentId, name }) {
          assert.equal(spaceId, 'space-1');
          assert.equal(parentId, null);
          assert.equal(name, 'test');
          throw new Error('A file or folder with the same name already exists');
        }
      });

      assert.throws(() => {
        folderService.createFolder({
          id: 'folder-conflict',
          spaceId: 'space-1',
          name: 'test'
        });
      }, /same name already exists/i);
    }
  }
];
