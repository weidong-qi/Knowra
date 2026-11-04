import assert from 'node:assert/strict';

export const tagDtoTests = [
  {
    name: 'buildCreateTagDto trims name and applies default color',
    async run() {
      const { buildCreateTagDto } = await import('../src/modules/knowledge/application/dto/tag.dto.ts');

      const dto = buildCreateTagDto({
        id: 'tag-dto-1',
        spaceId: 'space-1',
        name: '  database  '
      });

      assert.deepEqual(dto, {
        id: 'tag-dto-1',
        spaceId: 'space-1',
        name: 'database',
        color: 'neutral',
        groupId: null,
        code: null,
        isSystem: false,
        sortOrder: 0
      });
    }
  }
];
