import assert from 'node:assert/strict';
import { createEditorScrollController } from '../../src/controllers/editor/scroll-controller.js';

function createStorage() {
  const values = new Map();
  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, value);
    }
  };
}

function createController({ root = { scrollTop: 0 }, storage = createStorage(), editorRuntime = { currentEditorNoteId: 'note-1' } } = {}) {
  const documentRef = {
    getElementById(id) {
      return id === 'editor-scroll-region' ? root : null;
    }
  };
  const frames = [];
  const controller = createEditorScrollController({
    editorRuntime,
    storageKey: 'scroll-cache',
    storage,
    documentRef,
    requestAnimationFrameRef(callback) {
      frames.push(callback);
    }
  });

  return { controller, storage, root, frames };
}

function runTest(name, callback) {
  try {
    callback();
    console.log(`ok - ${name}`);
  } catch (error) {
    console.error(`not ok - ${name}`);
    throw error;
  }
}

runTest('save and persist current editor scroll position', () => {
  const { controller, storage, root } = createController({
    root: { scrollTop: 128 }
  });

  controller.saveCurrentEditorScrollPosition();
  controller.persistScrollPositions();

  assert.equal(storage.getItem('scroll-cache'), '{"note-1":128}');
});

runTest('load and restore scroll position on animation frame', () => {
  const storage = createStorage();
  storage.setItem('scroll-cache', '{"note-2":240}');
  const { controller, root, frames } = createController({
    storage,
    root: { scrollTop: 0 }
  });

  controller.loadScrollPositions();
  controller.restoreEditorScrollPosition('note-2');

  assert.equal(root.scrollTop, 0);
  assert.equal(frames.length, 1);
  frames[0]();
  assert.equal(root.scrollTop, 240);
});

runTest('missing editor root is ignored', () => {
  const storage = createStorage();
  const { controller } = createController({
    storage,
    root: null
  });

  controller.saveCurrentEditorScrollPosition();
  controller.persistScrollPositions();

  assert.equal(storage.getItem('scroll-cache'), '{}');
});

runTest('manual outline jumps cancel pending and later scroll restoration', () => {
  const storage = createStorage();
  storage.setItem('scroll-cache', '{"note-1":240}');
  const { controller, root, frames } = createController({
    storage,
    root: { scrollTop: 0 }
  });

  controller.loadScrollPositions();
  controller.restoreEditorScrollPosition('note-1');
  controller.cancelPendingEditorScrollRestore('note-1');
  frames[0]();

  assert.equal(root.scrollTop, 0);
  controller.restoreEditorScrollPosition('note-1');
  assert.equal(frames.length, 1);
});

console.log('editor-scroll-controller tests passed');
