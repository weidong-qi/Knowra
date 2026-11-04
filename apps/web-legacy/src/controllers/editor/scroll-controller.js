import {
  captureScrollPosition,
  getSavedScrollTop,
  readScrollPositions,
  writeScrollPositions
} from '../../../lib/editor/scroll-positions.js';

export function createEditorScrollController(deps) {
  const {
    editorRuntime,
    storageKey
  } = deps;

  const positions = {};
  let restoreRequestId = 0;
  let manuallyScrolledNoteId = null;
  const getStorage = () => deps.storage ?? globalThis.window?.localStorage;
  const getDocument = () => deps.documentRef ?? globalThis.document;
  const requestFrame = (callback) => {
    const schedule = deps.requestAnimationFrameRef ?? globalThis.requestAnimationFrame;
    if (typeof schedule === 'function') {
      schedule(callback);
      return;
    }
    callback();
  };

function getEditorScrollRoot() {
  const documentRef = getDocument();
  return documentRef?.getElementById?.('editor-scroll-region')
    ?? documentRef?.getElementById?.('milkdown-editor')
    ?? null;
}

function saveCurrentEditorScrollPosition() {
  const root = getEditorScrollRoot();
  if (root) {
    captureScrollPosition(positions, editorRuntime.currentEditorNoteId, root.scrollTop);
  }
}

function restoreEditorScrollPosition(noteId) {
  const requestId = ++restoreRequestId;
  if (manuallyScrolledNoteId && manuallyScrolledNoteId !== noteId) {
    manuallyScrolledNoteId = null;
  }
  if (manuallyScrolledNoteId === noteId) {
    manuallyScrolledNoteId = null;
    return;
  }

  const root = getEditorScrollRoot();
  const saved = getSavedScrollTop(positions, noteId);
  if (root && saved) {
    requestFrame(() => {
      if (requestId !== restoreRequestId) {
        return;
      }
      root.scrollTop = saved;
    });
  }
}

function cancelPendingEditorScrollRestore(noteId) {
  restoreRequestId += 1;
  manuallyScrolledNoteId = noteId || null;
}

function persistScrollPositions() {
  writeScrollPositions(getStorage(), storageKey, positions);
}

function loadScrollPositions() {
  Object.assign(positions, readScrollPositions(getStorage(), storageKey));
}

  return {
    getEditorScrollRoot,
    saveCurrentEditorScrollPosition,
    restoreEditorScrollPosition,
    cancelPendingEditorScrollRestore,
    persistScrollPositions,
    loadScrollPositions
  };
}
