import assert from 'node:assert/strict';
import {
  createLocalDraftNote,
  resolveDraftSaveState
} from '../lib/editor/draft-state.js';

function runTest(name, callback) {
  try {
    callback();
    console.log(`ok - ${name}`);
  } catch (error) {
    console.error(`not ok - ${name}`);
    throw error;
  }
}

runTest('resolveDraftSaveState reports unchanged markdown and title', () => {
  assert.deepEqual(resolveDraftSaveState({
    note: { title: 'Title', rawMarkdown: '# Title' },
    markdown: '# Title',
    title: 'Title'
  }), {
    changed: false,
    nextMarkdown: '# Title',
    nextTitle: 'Title'
  });
});

runTest('resolveDraftSaveState keeps title independent from body headings', () => {
  assert.deepEqual(resolveDraftSaveState({
    note: { title: 'Old', rawMarkdown: '# Old' },
    markdown: '# New',
    title: 'Old'
  }), {
    changed: true,
    nextMarkdown: '# New',
    nextTitle: 'Old'
  });
});

runTest('resolveDraftSaveState trims an explicitly edited title', () => {
  assert.deepEqual(resolveDraftSaveState({
    note: { title: 'Old', rawMarkdown: 'Body' },
    markdown: 'Body',
    title: '  New title  '
  }), {
    changed: true,
    nextMarkdown: 'Body',
    nextTitle: 'New title'
  });
});

runTest('createLocalDraftNote preserves note fields and stamps draft content', () => {
  assert.deepEqual(createLocalDraftNote({
    note: { id: 'note-1', favorite: true },
    title: 'New',
    markdown: '# New',
    timestamp: '2026-06-25T00:00:00.000Z'
  }), {
    id: 'note-1',
    favorite: true,
    title: 'New',
    rawMarkdown: '# New',
    updatedAt: '2026-06-25T00:00:00.000Z'
  });
});
