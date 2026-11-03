import assert from 'node:assert/strict';
import {
  buildMarkdownImportItems,
  buildNoteExportHtml,
  buildExportFileName,
  createDuplicateTitle,
  createLocalDuplicateNoteInput,
  createUntitledName,
  deriveMarkdownImportTitle,
  deriveNoteTitleFromMarkdown,
  getSiblingNamesForFolder,
  getMarkdownImportStatusMessage
} from '../lib/editor/file-menu.js';

async function runTest(name, callback) {
  try {
    await callback();
    console.log(`ok - ${name}`);
  } catch (error) {
    console.error(`not ok - ${name}`);
    throw error;
  }
}

await runTest('createUntitledName returns the base label when unused', () => {
  assert.equal(createUntitledName([], 'Untitled Note'), 'Untitled Note');
});

await runTest('createUntitledName increments until a free title exists', () => {
  assert.equal(
    createUntitledName(['Untitled Note', 'Untitled Note 2'], 'Untitled Note'),
    'Untitled Note 3'
  );
});

await runTest('getSiblingNamesForFolder returns root folder and note names', () => {
  assert.deepEqual(getSiblingNamesForFolder({
    folderId: null,
    folderTree: [{ id: 'folder-a', name: 'Folder A' }],
    notes: [
      { id: 'note-a', title: 'Root Note', folderId: null },
      { id: 'note-b', title: 'Child Note', folderId: 'folder-a' }
    ]
  }), ['Folder A', 'Root Note']);
});

await runTest('getSiblingNamesForFolder returns child folder and note names', () => {
  assert.deepEqual(getSiblingNamesForFolder({
    folderId: 'folder-a',
    foldersById: {
      'folder-a': {
        children: [{ id: 'folder-b', name: 'Folder B' }]
      }
    },
    notes: [
      { id: 'note-a', title: 'Root Note', folderId: null },
      { id: 'note-b', title: 'Child Note', folderId: 'folder-a' }
    ]
  }), ['Folder B', 'Child Note']);
});

await runTest('createDuplicateTitle appends copy suffix and avoids collisions', () => {
  assert.equal(createDuplicateTitle([], 'Research Notes'), 'Research Notes Copy');
  assert.equal(
    createDuplicateTitle(['Research Notes Copy', 'Research Notes Copy 2'], 'Research Notes'),
    'Research Notes Copy 3'
  );
});

await runTest('createLocalDuplicateNoteInput preserves note fields and overrides duplicate fields', () => {
  assert.deepEqual(createLocalDuplicateNoteInput({
    note: {
      id: 'note-a',
      title: 'Original',
      rawMarkdown: '# Original',
      folderId: 'folder-a',
      tagIds: ['tag-a']
    },
    id: 'note-b',
    title: 'Original Copy',
    markdown: '# Original Copy',
    updatedAt: '2026-06-25T00:00:00.000Z'
  }), {
    id: 'note-b',
    title: 'Original Copy',
    rawMarkdown: '# Original Copy',
    folderId: 'folder-a',
    tagIds: ['tag-a'],
    updatedAt: '2026-06-25T00:00:00.000Z'
  });
});

await runTest('buildExportFileName sanitizes unsafe path characters', () => {
  assert.equal(buildExportFileName('Queue / Redis: Notes', 'md'), 'Queue - Redis Notes.md');
  assert.equal(buildExportFileName('', 'pdf'), 'Untitled Note.pdf');
});

await runTest('deriveNoteTitleFromMarkdown prefers the first level-one heading', () => {
  assert.equal(deriveNoteTitleFromMarkdown('intro\n\n# Real Title\n\nbody'), 'Real Title');
});

await runTest('deriveNoteTitleFromMarkdown falls back to first non-empty line', () => {
  assert.equal(deriveNoteTitleFromMarkdown('\n  First sentence\nSecond'), 'First sentence');
  assert.equal(deriveNoteTitleFromMarkdown('', 'Fallback'), 'Fallback');
});

await runTest('deriveMarkdownImportTitle falls back to file basename', () => {
  assert.equal(deriveMarkdownImportTitle('notes/example.md', ''), 'notes/example');
  assert.equal(deriveMarkdownImportTitle('upload.md', '# Imported'), 'Imported');
});

await runTest('buildMarkdownImportItems reads files and creates stable import ids', async () => {
  const items = await buildMarkdownImportItems([
    { name: 'one.md', text: async () => '# One\n\nBody' },
    { name: 'two.md', text: async () => 'Second file' }
  ], {
    now: () => Number.parseInt('abc', 36)
  });

  assert.deepEqual(items, [
    {
      id: 'note-import-abc-0',
      title: 'One',
      rawMarkdown: '# One\n\nBody',
      sourceType: 'markdown-import'
    },
    {
      id: 'note-import-abc-1',
      title: 'Second file',
      rawMarkdown: 'Second file',
      sourceType: 'markdown-import'
    }
  ]);
});

await runTest('buildMarkdownImportItems rejects empty file lists', async () => {
  await assert.rejects(() => buildMarkdownImportItems([]), /Markdown/);
});

await runTest('getMarkdownImportStatusMessage summarizes single and multiple imports', () => {
  assert.equal(
    getMarkdownImportStatusMessage([{ title: 'Local Title' }], { title: 'Server Title' }),
    '已导入 Markdown 笔记：Server Title'
  );
  assert.equal(
    getMarkdownImportStatusMessage([{ title: 'A' }, { title: 'B' }]),
    '已导入 2 个 Markdown 文件'
  );
});

await runTest('buildNoteExportHtml renders escaped title and preview content', () => {
  const html = buildNoteExportHtml({
    title: 'A <B>.html',
    previewHtml: '<h1>Hello</h1>',
    print: true
  });

  assert.match(html, /<title>A &lt;B&gt;\.html<\/title>/);
  assert.match(html, /<article><h1>Hello<\/h1><\/article>/);
  assert.match(html, /window\.print\(\)/);
});

await runTest('buildNoteExportHtml includes rich export styles when requested', () => {
  const html = buildNoteExportHtml({
    title: 'Rich',
    previewHtml: '<table></table>',
    rich: true
  });

  assert.match(html, /border-collapse: collapse/);
  assert.match(html, /data-item-type="task"/);
});
