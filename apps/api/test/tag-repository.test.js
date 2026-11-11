import assert from 'node:assert/strict';

export const tagRepositoryTests = [
  {
    name: 'TagRepository saves and finds tag by id',
    async run() {
      const { createInMemoryTagRepository } = await import('../src/modules/knowledge/infrastructure/tag-repository.ts');
      const repository = createInMemoryTagRepository();

      repository.save({
        id: 'tag-repo-1',
        spaceId: 'space-1',
        name: 'database',
        color: 'slate'
      });

      const tag = repository.findById('tag-repo-1');

      assert.equal(tag.id, 'tag-repo-1');
      assert.equal(tag.name, 'database');
    }
  },
  {
    name: 'TagRepository list filters by spaceId',
    async run() {
      const { createInMemoryTagRepository } = await import('../src/modules/knowledge/infrastructure/tag-repository.ts');
      const repository = createInMemoryTagRepository();

      repository.save({
        id: 'tag-repo-2',
        spaceId: 'space-a',
        name: 'redis',
        color: 'slate'
      });
      repository.save({
        id: 'tag-repo-3',
        spaceId: 'space-b',
        name: 'postgres',
        color: 'blue'
      });

      const tags = repository.list({ spaceId: 'space-a' });

      assert.equal(tags.length, 1);
      assert.equal(tags[0].id, 'tag-repo-2');
    }
  }
];
