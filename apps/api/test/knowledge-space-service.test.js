import assert from 'node:assert/strict';

export const knowledgeSpaceServiceTests = [
  {
    name: 'createDefaultKnowledgeSpace creates a default space for a user',
    async run() {
      const { createKnowledgeSpaceService } =
        await import('../src/modules/knowledge/application/knowledge-space-service.ts');
      const knowledgeSpaceService = createKnowledgeSpaceService();

      const space = knowledgeSpaceService.createDefaultKnowledgeSpace({
        userId: 'user-1'
      });

      assert.equal(space.userId, 'user-1');
      assert.equal(space.name, 'Default Space');
      assert.equal(space.description, 'Primary knowledge space');
    }
  },
  {
    name: 'listKnowledgeSpaces filters spaces by userId',
    async run() {
      const { createKnowledgeSpaceService } =
        await import('../src/modules/knowledge/application/knowledge-space-service.ts');
      const knowledgeSpaceService = createKnowledgeSpaceService();

      knowledgeSpaceService.createDefaultKnowledgeSpace({ userId: 'user-a' });
      knowledgeSpaceService.createDefaultKnowledgeSpace({ userId: 'user-b' });

      const spaces = knowledgeSpaceService.listKnowledgeSpaces({ userId: 'user-a' });

      assert.equal(spaces.length, 1);
      assert.equal(spaces[0].userId, 'user-a');
    }
  }
];
