import assert from 'node:assert/strict';

export const knowledgeSpaceRepositoryTests = [
  {
    name: 'KnowledgeSpaceRepository saves and finds space by id',
    async run() {
      const { createInMemoryKnowledgeSpaceRepository } =
        await import('../src/modules/knowledge/infrastructure/knowledge-space-repository.ts');
      const repository = createInMemoryKnowledgeSpaceRepository();

      repository.save({
        id: 'space-repo-1',
        userId: 'user-1',
        name: 'Default Space',
        description: 'Primary knowledge space'
      });

      const space = repository.findById('space-repo-1');

      assert.equal(space.id, 'space-repo-1');
      assert.equal(space.userId, 'user-1');
    }
  },
  {
    name: 'KnowledgeSpaceRepository list filters by userId',
    async run() {
      const { createInMemoryKnowledgeSpaceRepository } =
        await import('../src/modules/knowledge/infrastructure/knowledge-space-repository.ts');
      const repository = createInMemoryKnowledgeSpaceRepository();

      repository.save({
        id: 'space-repo-2',
        userId: 'user-a',
        name: 'A',
        description: 'A desc'
      });
      repository.save({
        id: 'space-repo-3',
        userId: 'user-b',
        name: 'B',
        description: 'B desc'
      });

      const spaces = repository.list({ userId: 'user-a' });

      assert.equal(spaces.length, 1);
      assert.equal(spaces[0].id, 'space-repo-2');
    }
  }
];
