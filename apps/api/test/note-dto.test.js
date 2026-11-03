import assert from 'node:assert/strict';

export const noteDtoTests = [
  {
    name: 'buildCreateNoteDto trims title and preserves ids',
    async run() {
      const { buildCreateNoteDto } = await import('../src/modules/knowledge/application/dto/note.dto.ts');

      const dto = buildCreateNoteDto({
        id: 'dto-note-1',
        title: '  DTO title  ',
        rawMarkdown: 'markdown',
        spaceId: 'space-1',
        folderId: 'folder-1'
      });

      assert.equal(dto.id, 'dto-note-1');
      assert.equal(dto.title, 'DTO title');
      assert.equal(dto.spaceId, 'space-1');
      assert.equal(dto.folderId, 'folder-1');
    }
  },
  {
    name: 'buildCreateNoteDto derives id and title when omitted',
    async run() {
      const { buildCreateNoteDto } = await import('../src/modules/knowledge/application/dto/note.dto.ts');

      const dto = buildCreateNoteDto({
        rawMarkdown: '# Imported Redis Notes\n\nqueue jobs',
        spaceId: 'space-1'
      });

      assert.match(dto.id, /^note-imported-redis-notes-/);
      assert.equal(dto.title, 'Imported Redis Notes');
      assert.equal(dto.favorite, false);
    }
  },
  {
    name: 'buildUpdateNoteDto keeps only defined fields',
    async run() {
      const { buildUpdateNoteDto } = await import('../src/modules/knowledge/application/dto/note.dto.ts');

      const dto = buildUpdateNoteDto({
        title: '  Updated title ',
        rawMarkdown: undefined,
        folderId: 'folder-9'
      });

      assert.deepEqual(dto, {
        title: 'Updated title',
        folderId: 'folder-9'
      });
    }
  },
  {
    name: 'buildUpdateNoteDto keeps favorite when explicitly provided',
    async run() {
      const { buildUpdateNoteDto } = await import('../src/modules/knowledge/application/dto/note.dto.ts');

      const dto = buildUpdateNoteDto({
        favorite: true
      });

      assert.deepEqual(dto, {
        favorite: true
      });
    }
  },
  {
    name: 'note DTOs reject insecure HTTP image sources but allow ordinary HTTP links',
    async run() {
      const { buildCreateNoteDto, buildUpdateNoteDto } =
        await import('../src/modules/knowledge/application/dto/note.dto.ts');

      assert.throws(
        () =>
          buildCreateNoteDto({
            title: 'Unsafe image',
            rawMarkdown: '![diagram](http://example.com/diagram.png)'
          }),
        error => error.code === 'INSECURE_IMAGE_URL' && error.statusCode === 422
      );
      assert.throws(
        () =>
          buildUpdateNoteDto({
            rawMarkdown: '<img src="http://example.com/diagram.png">'
          }),
        error => error.code === 'INSECURE_IMAGE_URL'
      );
      assert.throws(
        () =>
          buildUpdateNoteDto({
            rawMarkdown: '![diagram][asset]\n\n[asset]: http://example.com/diagram.png'
          }),
        error => error.code === 'INSECURE_IMAGE_URL'
      );

      const dto = buildCreateNoteDto({
        title: 'Safe link',
        rawMarkdown: '[legacy website](http://example.com/article)'
      });
      assert.match(dto.rawMarkdown, /http:\/\/example\.com\/article/);
    }
  }
];
