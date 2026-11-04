import assert from 'node:assert/strict';

export const tagDtoTests = [
  {
    name: '标签创建与更新接受不透明六位自定义色并拒绝无效输入',
    async run() {
      const { buildCreateTagDto, buildUpdateTagDto } =
        await import('../src/modules/knowledge/application/dto/tag.dto.ts');
      assert.equal(buildCreateTagDto({ spaceId: 'space-1', name: '自定义', color: '#3c68ff' }).color, '#3c68ff');
      assert.equal(buildUpdateTagDto({ color: ' #Ab12EF ' }).color, '#ab12ef');
      assert.equal(buildUpdateTagDto({ color: 'CYAN' }).color, 'blue');
      for (const color of ['#fff', '#12345678', 'transparent', 'var(--accent)', '__proto__', null, 123456, {}]) {
        for (const build of [
          input => buildCreateTagDto({ spaceId: 'space-1', name: '无效', ...input }),
          buildUpdateTagDto
        ]) {
          assert.throws(
            () => build({ color }),
            error => error.code === 'TAG_COLOR_INVALID'
          );
        }
      }
    }
  },
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
