import assert from 'node:assert/strict';

export const knowledgeSpaceDtoTests = [
  {
    name: 'buildDefaultKnowledgeSpaceDto creates default values for a user',
    async run() {
      const { buildDefaultKnowledgeSpaceDto } =
        await import('../src/modules/knowledge/application/dto/knowledge-space.dto.ts');

      const dto = buildDefaultKnowledgeSpaceDto({
        userId: 'user-7'
      });

      assert.deepEqual(dto, {
        id: 'space-user-7',
        userId: 'user-7',
        name: 'Default Space',
        description: 'Primary knowledge space'
      });
    }
  }
];
