import assert from 'node:assert/strict';

export const knowledgeModuleTests = [
  {
    name: 'createKnowledgeModule exposes core services',
    async run() {
      const { createKnowledgeModule } = await import('../src/modules/knowledge/index.ts');

      const module = createKnowledgeModule();

      assert.equal(typeof module.noteService.createNote, 'function');
      assert.equal(typeof module.folderService.createFolder, 'function');
      assert.equal(typeof module.tagService.createTag, 'function');
      assert.equal(typeof module.contentAnnotationService.createAnnotation, 'function');
      assert.equal(typeof module.knowledgeSpaceService.createDefaultKnowledgeSpace, 'function');
      assert.equal(typeof module.searchService.searchNotes, 'function');
    }
  },
  {
    name: 'strict knowledge module validates note references and space boundaries',
    async run() {
      const { createKnowledgeModule } = await import('../src/modules/knowledge/index.ts');
      const module = createKnowledgeModule({ enforceReferences: true });

      module.knowledgeSpaceService.createDefaultKnowledgeSpace({ userId: 'owner-a' });
      module.knowledgeSpaceService.createDefaultKnowledgeSpace({ userId: 'owner-b' });
      module.folderService.createFolder({
        id: 'folder-owner-a',
        spaceId: 'space-owner-a',
        name: 'Owner A'
      });
      module.tagService.createTag({
        id: 'tag-owner-b',
        spaceId: 'space-owner-b',
        name: 'Owner B'
      });

      assert.throws(
        () =>
          module.folderService.createFolder({
            name: 'Unknown space folder',
            spaceId: 'space-missing'
          }),
        error => error.statusCode === 422 && error.code === 'FOLDER_SPACE_NOT_FOUND'
      );
      assert.throws(
        () =>
          module.tagService.createTag({
            name: 'Unknown space tag',
            spaceId: 'space-missing'
          }),
        error => error.statusCode === 422 && error.code === 'TAG_SPACE_NOT_FOUND'
      );
      assert.throws(
        () =>
          module.noteService.createNote({
            title: 'Missing folder',
            rawMarkdown: 'body',
            spaceId: 'space-owner-a',
            folderId: 'folder-missing'
          }),
        error => error.statusCode === 422 && error.code === 'NOTE_FOLDER_NOT_FOUND'
      );
      assert.throws(
        () =>
          module.noteService.createNote({
            title: 'Cross-space tag',
            rawMarkdown: 'body',
            spaceId: 'space-owner-a',
            folderId: 'folder-owner-a',
            tagIds: ['tag-owner-b']
          }),
        error => error.statusCode === 422 && error.code === 'NOTE_TAG_SPACE_MISMATCH'
      );
    }
  }
];
