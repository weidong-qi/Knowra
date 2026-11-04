import assert from 'node:assert/strict';

export const folderDtoTests = [
  {
    name: 'buildCreateFolderDto trims name and keeps ids',
    async run() {
      const { buildCreateFolderDto } = await import('../src/modules/knowledge/application/dto/folder.dto.ts');

      const dto = buildCreateFolderDto({
        id: 'folder-dto-1',
        spaceId: 'space-1',
        parentId: 'folder-parent',
        name: '  Backend Notes  '
      });

      assert.deepEqual(dto, {
        id: 'folder-dto-1',
        spaceId: 'space-1',
        parentId: 'folder-parent',
        name: 'Backend Notes',
        pathCache: '/'
      });
    }
  }
];
