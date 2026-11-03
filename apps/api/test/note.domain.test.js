import assert from 'node:assert/strict';

export const noteDomainTests = [
  {
    name: 'Note requires a title',
    async run() {
      const { Note } = await import('../src/modules/knowledge/domain/note.ts');

      assert.throws(() => {
        new Note({
          id: 'note-1',
          title: '   ',
          rawMarkdown: '# Title'
        });
      }, /title is required/i);
    }
  },
  {
    name: 'Note accepts an empty markdown body',
    async run() {
      const { Note } = await import('../src/modules/knowledge/domain/note.ts');

      const note = new Note({
        id: 'note-2',
        title: 'Valid title',
        rawMarkdown: ''
      });

      assert.equal(note.rawMarkdown, '');
      assert.equal(note.plainText, '');
      assert.deepEqual(note.internalLinks, []);
    }
  },
  {
    name: 'Note requires rawMarkdown to be a string',
    async run() {
      const { Note } = await import('../src/modules/knowledge/domain/note.ts');

      assert.throws(() => {
        new Note({
          id: 'note-2-invalid',
          title: 'Valid title',
          rawMarkdown: null
        });
      }, /rawMarkdown is required/i);
    }
  },
  {
    name: 'Note derives plainText from rawMarkdown',
    async run() {
      const { Note } = await import('../src/modules/knowledge/domain/note.ts');

      const note = new Note({
        id: 'note-3',
        title: 'Markdown note',
        rawMarkdown: '# Header\n\nThis is **important** content.'
      });

      assert.equal(note.title, 'Markdown note');
      assert.equal(note.rawMarkdown, '# Header\n\nThis is **important** content.');
      assert.equal(note.plainText, 'Header This is important content.');
    }
  },
  {
    name: 'Note extracts internal note links from rawMarkdown',
    async run() {
      const { Note } = await import('../src/modules/knowledge/domain/note.ts');

      const note = new Note({
        id: 'note-4',
        title: 'Linked note',
        rawMarkdown: 'See [[note-a]] and [[note-b]] then [[note-a]].'
      });

      assert.deepEqual(note.internalLinks, ['note-a', 'note-b']);
      assert.equal(note.plainText, 'See note a and note b then note a.');
    }
  },
  {
    name: 'Note keeps favorite status when provided',
    async run() {
      const { Note } = await import('../src/modules/knowledge/domain/note.ts');

      const note = new Note({
        id: 'note-favorite',
        title: 'Favorite note',
        rawMarkdown: 'content',
        favorite: true
      });

      assert.equal(note.favorite, true);
    }
  }
];
