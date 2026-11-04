import assert from 'node:assert/strict';
import {
  buildFolderPath,
  buildNotePath,
  openFolderBranch,
  resolveFolderSelection,
  resolveNavigationSelection,
  toggleFolderOpen
} from '../lib/navigation/selection.js';

function runTest(name, callback) {
  try {
    callback();
    console.log(`ok - ${name}`);
  } catch (error) {
    console.error(`not ok - ${name}`);
    throw error;
  }
}

const foldersById = {
  root: { id: 'root', parentId: null, name: 'Root' },
  child: { id: 'child', parentId: 'root', name: 'Child' },
  leaf: { id: 'leaf', parentId: 'child', name: 'Leaf' }
};

const notes = [
  { id: 'note-a', title: 'Alpha', rawMarkdown: '# A', updatedAt: '2026-01-01T00:00:00.000Z' },
  { id: 'note-b', title: 'Beta', rawMarkdown: '# B', updatedAt: '2026-01-02T00:00:00.000Z' }
];

runTest('toggleFolderOpen flips missing folders from open to closed', () => {
  assert.deepEqual(toggleFolderOpen({}, 'root'), { root: false });
  assert.deepEqual(toggleFolderOpen({ root: false }, 'root'), { root: true });
});

runTest('openFolderBranch opens the folder and all ancestors without mutating input', () => {
  const openFolders = { other: false };
  const nextOpenFolders = openFolderBranch({ openFolders, foldersById, folderId: 'leaf' });

  assert.deepEqual(nextOpenFolders, { other: false, leaf: true, child: true, root: true });
  assert.deepEqual(openFolders, { other: false });
});

runTest('buildFolderPath returns the root uncategorized path without a folder', () => {
  assert.equal(buildFolderPath({ folderId: null, foldersById }), '资料 / 未分类');
});

runTest('buildFolderPath returns the full ancestor path', () => {
  assert.equal(buildFolderPath({ folderId: 'leaf', foldersById }), '资料 / Root / Child / Leaf');
});

runTest('buildFolderPath can omit the decorative frontend root label', () => {
  assert.equal(buildFolderPath({
    folderId: 'leaf',
    foldersById,
    rootLabel: '',
    emptyLabel: ''
  }), 'Root / Child / Leaf');
  assert.equal(buildFolderPath({
    folderId: null,
    foldersById,
    rootLabel: '',
    emptyLabel: ''
  }), '');
});

runTest('buildNotePath uses the file name instead of a decorative sequence number', () => {
  assert.equal(buildNotePath({
    note: { title: '测试文档', folderId: 'leaf' },
    foldersById
  }), '资料库 / Root / Child / Leaf / 测试文档');
  assert.equal(buildNotePath({
    note: { title: '根目录文档', folderId: null },
    foldersById
  }), '资料库 / 根目录文档');
});

runTest('resolveNavigationSelection clears invalid folder and stale tabs', () => {
  const result = resolveNavigationSelection({
    selectedFolderId: 'missing-folder',
    foldersById,
    activeNotes: notes,
    visibleNotes: notes,
    selectedNoteId: 'note-a',
    openNoteTabs: ['note-a', 'deleted-note']
  });

  assert.equal(result.selectedFolderId, null);
  assert.equal(result.selectedNoteId, 'note-a');
  assert.deepEqual(result.openNoteTabs, ['note-a']);
  assert.equal(result.draftMarkdown, '# A');
  assert.equal(result.draftTitle, 'Alpha');
  assert.equal(result.saveState, 'saved');
});

runTest('resolveNavigationSelection selects the first visible note when current note is hidden', () => {
  const result = resolveNavigationSelection({
    selectedFolderId: null,
    foldersById,
    activeNotes: notes,
    visibleNotes: notes,
    selectedNoteId: 'missing-note',
    openNoteTabs: []
  });

  assert.equal(result.selectedNoteId, 'note-a');
  assert.deepEqual(result.openNoteTabs, ['note-a']);
  assert.equal(result.noteTagDraft, '');
});

runTest('resolveNavigationSelection clears note state when no notes are visible', () => {
  const result = resolveNavigationSelection({
    selectedFolderId: 'root',
    foldersById,
    activeNotes: notes,
    visibleNotes: [],
    selectedNoteId: 'note-a',
    openNoteTabs: ['note-a']
  });

  assert.equal(result.selectedNoteId, null);
  assert.deepEqual(result.openNoteTabs, []);
  assert.equal(result.draftMarkdown, '');
  assert.equal(result.draftTitle, '');
  assert.equal(result.shouldClearSideData, true);
});

runTest('resolveFolderSelection keeps the current note when it remains visible', () => {
  const result = resolveFolderSelection({
    folderId: 'root',
    selectedNoteId: 'note-b',
    visibleNotes: notes,
    openNoteTabs: ['note-b']
  });

  assert.equal(result.selectedFolderId, 'root');
  assert.equal(result.selectedNoteId, 'note-b');
  assert.deepEqual(result.openNoteTabs, ['note-b']);
  assert.equal(result.shouldLoadSideData, false);
});

runTest('resolveFolderSelection selects the first visible note when current note is outside the folder', () => {
  const result = resolveFolderSelection({
    folderId: 'root',
    selectedNoteId: 'missing-note',
    visibleNotes: notes,
    openNoteTabs: []
  });

  assert.equal(result.selectedNoteId, 'note-a');
  assert.deepEqual(result.openNoteTabs, ['note-a']);
  assert.equal(result.draftMarkdown, '# A');
  assert.equal(result.draftTitle, 'Alpha');
  assert.equal(result.shouldLoadSideData, true);
});
