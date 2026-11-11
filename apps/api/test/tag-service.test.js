import assert from 'node:assert/strict';

export const tagServiceTests = [
  {
    name: 'createTag returns a normalized tag entity',
    async run() {
      const { createTagService } = await import('../src/modules/knowledge/application/tag-service.ts');
      const tagService = createTagService();

      const tag = tagService.createTag({
        id: 'tag-1',
        spaceId: 'space-1',
        name: ' database '
      });

      assert.equal(tag.name, 'database');
      assert.equal(tag.color, 'neutral');
    }
  },
  {
    name: 'createTag auto-generates a unique id when id is omitted',
    async run() {
      const { createTagService } = await import('../src/modules/knowledge/application/tag-service.ts');
      const tagService = createTagService();

      const first = tagService.createTag({
        spaceId: 'space-1',
        name: 'database-primary'
      });
      const second = tagService.createTag({
        spaceId: 'space-1',
        name: 'database'
      });

      assert.match(first.id, /^tag-database-/);
      assert.notEqual(first.id, second.id);
    }
  },
  {
    name: 'createTag rejects a duplicate client-provided id',
    async run() {
      const { createTagService } = await import('../src/modules/knowledge/application/tag-service.ts');
      const tagService = createTagService();

      tagService.createTag({
        id: 'tag-duplicate',
        spaceId: 'space-1',
        name: 'original'
      });

      assert.throws(
        () =>
          tagService.createTag({
            id: 'tag-duplicate',
            spaceId: 'space-1',
            name: 'replacement'
          }),
        error => error.statusCode === 409 && error.code === 'TAG_ID_CONFLICT'
      );
    }
  },
  {
    name: 'listTags returns created tags',
    async run() {
      const { createTagService } = await import('../src/modules/knowledge/application/tag-service.ts');
      const tagService = createTagService();

      tagService.createTag({
        id: 'tag-2',
        spaceId: 'space-1',
        name: 'redis'
      });

      assert.equal(tagService.listTags().length, 1);
    }
  },
  {
    name: 'listTags filters tags by spaceId',
    async run() {
      const { createTagService } = await import('../src/modules/knowledge/application/tag-service.ts');
      const tagService = createTagService();

      tagService.createTag({
        id: 'tag-space-1',
        spaceId: 'space-1',
        name: 'redis'
      });
      tagService.createTag({
        id: 'tag-space-2',
        spaceId: 'space-2',
        name: 'postgres'
      });

      const tags = tagService.listTags({ spaceId: 'space-1' });

      assert.equal(tags.length, 1);
      assert.equal(tags[0].id, 'tag-space-1');
    }
  },
  {
    name: 'updateTag changes name and color',
    async run() {
      const { createTagService } = await import('../src/modules/knowledge/application/tag-service.ts');
      const tagService = createTagService();

      tagService.createTag({
        id: 'tag-update-1',
        spaceId: 'space-1',
        name: 'redis'
      });

      const updated = tagService.updateTag('tag-update-1', {
        name: 'cache',
        color: 'amber'
      });

      assert.equal(updated.name, 'cache');
      assert.equal(updated.color, 'orange');
    }
  },
  {
    name: 'deleteTag removes tag from active list',
    async run() {
      const { createTagService } = await import('../src/modules/knowledge/application/tag-service.ts');
      const tagService = createTagService();

      tagService.createTag({
        id: 'tag-delete-1',
        spaceId: 'space-1',
        name: 'obsolete'
      });

      const deleted = tagService.deleteTag('tag-delete-1');

      assert.equal(deleted.id, 'tag-delete-1');
      assert.equal(tagService.listTags({ spaceId: 'space-1' }).length, 0);
    }
  }
];
