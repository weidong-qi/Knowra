import assert from 'node:assert/strict';
import {
  mergeNoteSummariesWithLoadedContent,
  normalizeFolderTree,
  normalizeNotes,
  replaceNoteInCollection
} from '../lib/workspace-normalization.js';
import { folderNormalizationVector } from '../../../packages/web-core/test/workspace-vectors.js';

function runTest(name, callback) {
  try {
    callback();
    console.log(`ok - ${name}`);
  } catch (error) {
    console.error(`not ok - ${name}`);
    throw error;
  }
}

runTest('normalizeFolderTree filters invalid nodes and normalizes nested folders', () => {
  assert.deepEqual(normalizeFolderTree(folderNormalizationVector.input), folderNormalizationVector.expected);
});

runTest('normalizeFolderTree returns an empty array for non-array input', () => {
  assert.deepEqual(normalizeFolderTree({ id: 'folder' }), []);
});

runTest('normalizeNotes filters invalid notes and fills defaults', () => {
  assert.deepEqual(
    normalizeNotes([
      undefined,
      [],
      {
        id: 42,
        title: null,
        folderId: undefined,
        tagIds: 'tag-a',
        internalLinks: null,
        rawMarkdown: undefined,
        favorite: 1,
        deleted: 0
      },
      { title: 'Missing id' }
    ]),
    [
      {
        id: '42',
        title: '未命名笔记',
        folderId: null,
        tagIds: [],
        internalLinks: [],
        rawMarkdown: '',
        contentLoaded: false,
        favorite: true,
        deleted: false
      }
    ]
  );
});

runTest('mergeNoteSummariesWithLoadedContent preserves an already loaded body', () => {
  const [note] = mergeNoteSummariesWithLoadedContent([
    {
      id: 'note-loaded',
      title: 'Updated metadata',
      summary: 'summary',
      contentLoaded: false
    }
  ], [
    {
      id: 'note-loaded',
      title: 'Old metadata',
      rawMarkdown: '# Full body',
      plainText: 'Full body',
      contentLoaded: true
    }
  ]);

  assert.equal(note.title, 'Updated metadata');
  assert.equal(note.rawMarkdown, '# Full body');
  assert.equal(note.contentLoaded, true);
});

runTest('normalizeNotes copies array fields instead of reusing references', () => {
  const source = [{ id: 'note-a', tagIds: ['tag-a'], internalLinks: ['note-b'] }];
  const [note] = normalizeNotes(source);

  assert.notEqual(note.tagIds, source[0].tagIds);
  assert.notEqual(note.internalLinks, source[0].internalLinks);
});

runTest('replaceNoteInCollection merges a normalized note into the existing collection', () => {
  assert.deepEqual(
    replaceNoteInCollection([
      { id: 'note-a', title: 'Old', rawMarkdown: 'old', favorite: true },
      { id: 'note-b', title: 'Other' }
    ], {
      id: 'note-a',
      title: 'New'
    }, {
      rawMarkdown: 'fallback'
    }),
    [
      {
        id: 'note-a',
        title: 'New',
        rawMarkdown: 'fallback',
        contentLoaded: true,
        favorite: false,
        folderId: null,
        tagIds: [],
        internalLinks: [],
        deleted: false
      },
      { id: 'note-b', title: 'Other' }
    ]
  );
});

runTest('replaceNoteInCollection returns the original collection for invalid updates', () => {
  const notes = [{ id: 'note-a', title: 'A' }];
  assert.equal(replaceNoteInCollection(notes, { title: 'Missing id' }), notes);
});
