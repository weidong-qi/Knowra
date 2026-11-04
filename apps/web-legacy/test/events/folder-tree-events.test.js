import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ─── 源模式断言（compile-time contract）──────────────────────────

const binderSource = fs.readFileSync(
  path.resolve(__dirname, '../../lib/events/folder-tree-events.js'),
  'utf8'
);

assert.match(
  binderSource,
  /export function bindFolderTreeEvents/,
  'folder-tree-events.js should export bindFolderTreeEvents'
);
// 2 个 click + 1 个 contextmenu + dragstart/dragover/drop/dragend +
// submit/keydown/input = 10 个监听器。
assert.equal(
  (binderSource.match(/elements\.folderTree\?\.addEventListener\('click'/g) ?? []).length,
  2,
  'folder-tree binder should register exactly 2 click listeners'
);
[
  'contextmenu',
  'dragstart',
  'dragover',
  'drop',
  'dragend',
  'submit',
  'keydown',
  'input'
].forEach((type) => {
  assert.equal(
    (binderSource.match(new RegExp(`elements\\.folderTree\\?\\.addEventListener\\('${type}'`, 'g')) ?? []).length,
    1,
    `folder-tree binder should register exactly 1 ${type} listener`
  );
});

// ─── Handler-recorder 断言（behavioral）──────────────────────────

const tests = [];

function runTest(name, callback) {
  const run = async () => {
    try {
      await callback();
      console.log(`ok - ${name}`);
    } catch (error) {
      console.error(`not ok - ${name}`);
      throw error;
    }
  };
  tests.push(run);
}

function makeElements() {
  const listeners = {};
  const types = ['click', 'contextmenu', 'dragstart', 'dragover', 'drop', 'dragend', 'submit', 'keydown', 'input'];
  for (const t of types) listeners[t] = [];
  const el = {
    addEventListener(type, fn) { listeners[type].push(fn); }
  };
  return { element: el, listeners };
}

function makeClosest(map) {
  return (selector) => {
    for (const [key, value] of map.entries()) {
      if (selector === key) return value;
    }
    return null;
  };
}

function makeState() {
  return {
    navSections: {},
    dragState: { activeKind: null, activeId: null, overKind: null, overId: null },
    treeEditor: null,
    selectedFolderId: null
  };
}

function makeDeps(overrides = {}) {
  return {
    closeContextMenu: () => {},
    renderFolders: () => {},
    toggleFolderOpen: () => {},
    selectFolder: async () => {},
    selectNote: async () => {},
    renderStatus: () => {},
    openContextMenu: () => {},
    syncDragIndicators: () => {},
    canDropOnTarget: () => true,
    commitDrop: async () => {},
    resetDragState: () => {},
    submitTreeEditor: async () => {},
    cancelTreeEditor: () => {},
    commitDelete: async () => {},
    clearDeleteIntent: () => {},
    resolveClickTarget: () => null,
    resolveContextMenuTarget: () => null,
    resolveDropTarget: () => null,
    ...overrides
  };
}

runTest('click: select-note dispatches selectNote', async () => {
  const { element, listeners } = makeElements();
  const { bindFolderTreeEvents } = await import(
    '../../lib/events/folder-tree-events.js'
  );
  let arg = null;
  let opts = null;
  const deps = makeDeps({
    resolveClickTarget: () => ({ type: 'select-note', noteId: 'n-1' }),
    selectNote: async (id, o) => { arg = id; opts = o; }
  });

  bindFolderTreeEvents({ state: makeState(), elements: { folderTree: element }, deps });

  const target = {};
  listeners.click[0]({ target });

  assert.equal(arg, 'n-1');
  assert.deepEqual(opts, { syncFolder: true });
});

runTest('click: toggle-folder calls toggleFolderOpen and stops propagation', async () => {
  const { element, listeners } = makeElements();
  const { bindFolderTreeEvents } = await import(
    '../../lib/events/folder-tree-events.js'
  );
  let folderArg = null;
  let stopped = false;
  const deps = makeDeps({
    resolveClickTarget: () => ({ type: 'toggle-folder', folderId: 'f-1' }),
    toggleFolderOpen: (id) => { folderArg = id; }
  });

  bindFolderTreeEvents({ state: makeState(), elements: { folderTree: element }, deps });

  const target = {};
  listeners.click[0]({ target, stopPropagation() { stopped = true; } });

  assert.equal(folderArg, 'f-1');
  assert.equal(stopped, true);
});

runTest('click: toggle-section flips state.navSections and renders', async () => {
  const { element, listeners } = makeElements();
  const { bindFolderTreeEvents } = await import(
    '../../lib/events/folder-tree-events.js'
  );
  let rendered = 0;
  let closed = 0;
  const state = makeState();
  state.navSections['tags'] = false;
  const deps = makeDeps({
    resolveClickTarget: () => ({ type: 'toggle-section', sectionKey: 'tags' }),
    renderFolders: () => { rendered += 1; },
    closeContextMenu: () => { closed += 1; }
  });

  bindFolderTreeEvents({ state, elements: { folderTree: element }, deps });

  const target = {};
  listeners.click[0]({ target });

  assert.equal(state.navSections.tags, true);
  assert.equal(rendered, 1);
  assert.equal(closed, 1);
});

runTest('click (second handler): data-editor-cancel cancels tree editor', async () => {
  const { element, listeners } = makeElements();
  const { bindFolderTreeEvents } = await import(
    '../../lib/events/folder-tree-events.js'
  );
  let cancelled = 0;
  const deps = makeDeps({
    resolveClickTarget: () => null,
    cancelTreeEditor: () => { cancelled += 1; }
  });

  bindFolderTreeEvents({ state: makeState(), elements: { folderTree: element }, deps });

  const target = { dataset: {} };
  target.closest = makeClosest(new Map([['[data-editor-cancel]', target]]));
  listeners.click[1]({ target });

  assert.equal(cancelled, 1);
});

runTest('click (second handler): data-delete-confirm commits delete', async () => {
  const { element, listeners } = makeElements();
  const { bindFolderTreeEvents } = await import(
    '../../lib/events/folder-tree-events.js'
  );
  let args = null;
  const deps = makeDeps({
    resolveClickTarget: () => null,
    commitDelete: async (kind, id) => { args = { kind, id }; }
  });

  bindFolderTreeEvents({ state: makeState(), elements: { folderTree: element }, deps });

  const target = { dataset: { deleteConfirm: 'folder', targetId: 'f-99' } };
  target.closest = makeClosest(new Map([['[data-delete-confirm]', target]]));
  listeners.click[1]({ target });

  assert.deepEqual(args, { kind: 'folder', id: 'f-99' });
});

runTest('contextmenu: openContextMenu with x/y/targetKind/targetId', async () => {
  const { element, listeners } = makeElements();
  const { bindFolderTreeEvents } = await import(
    '../../lib/events/folder-tree-events.js'
  );
  let args = null;
  let prevented = false;
  const deps = makeDeps({
    resolveContextMenuTarget: () => ({ kind: 'folder', id: 'f-1', selectFolderId: null }),
    openContextMenu: (a) => { args = a; }
  });

  bindFolderTreeEvents({ state: makeState(), elements: { folderTree: element }, deps });

  listeners.contextmenu[0]({
    target: {},
    clientX: 100,
    clientY: 200,
    preventDefault() { prevented = true; }
  });

  assert.deepEqual(args, { x: 100, y: 200, targetKind: 'folder', targetId: 'f-1' });
  assert.equal(prevented, true);
});

runTest('contextmenu: with selectFolderId updates state and renders status', async () => {
  const { element, listeners } = makeElements();
  const { bindFolderTreeEvents } = await import(
    '../../lib/events/folder-tree-events.js'
  );
  let statusRendered = 0;
  const state = makeState();
  const deps = makeDeps({
    resolveContextMenuTarget: () => ({ kind: 'folder', id: 'f-2', selectFolderId: 'f-2' }),
    renderStatus: () => { statusRendered += 1; }
  });

  bindFolderTreeEvents({ state, elements: { folderTree: element }, deps });

  listeners.contextmenu[0]({
    target: {},
    clientX: 0,
    clientY: 0,
    preventDefault() {}
  });

  assert.equal(state.selectedFolderId, 'f-2');
  assert.equal(statusRendered, 1);
});

runTest('dragstart: builds dragState and sets dataTransfer', async () => {
  const { element, listeners } = makeElements();
  const { bindFolderTreeEvents } = await import(
    '../../lib/events/folder-tree-events.js'
  );
  let synced = 0;
  const state = makeState();
  const deps = makeDeps({
    syncDragIndicators: () => { synced += 1; }
  });

  bindFolderTreeEvents({ state, elements: { folderTree: element }, deps });

  const draggable = { dataset: { dragKind: 'folder', dragId: 'f-3' } };
  draggable.closest = makeClosest(
    new Map([
      ['[data-drag-kind][data-drag-id]', draggable]
    ])
  );

  let effectAllowed = null;
  let dataStr = null;
  let prevented = false;

  listeners.dragstart[0]({
    target: draggable,
    dataTransfer: {
      set effectAllowed(v) { effectAllowed = v; },
      setData(type, value) { dataStr = { type, value }; }
    },
    preventDefault() { prevented = true; }
  });

  assert.equal(state.dragState.activeKind, 'folder');
  assert.equal(state.dragState.activeId, 'f-3');
  assert.equal(effectAllowed, 'move');
  assert.deepEqual(dataStr, { type: 'text/plain', value: 'folder:f-3' });
  assert.equal(synced, 1);
  assert.equal(prevented, false);
});

runTest('dragstart: preventDefault when treeEditor is open', async () => {
  const { element, listeners } = makeElements();
  const { bindFolderTreeEvents } = await import(
    '../../lib/events/folder-tree-events.js'
  );
  const state = makeState();
  state.treeEditor = { value: 'x' };
  const deps = makeDeps();

  bindFolderTreeEvents({ state, elements: { folderTree: element }, deps });

  const draggable = { dataset: { dragKind: 'folder', dragId: 'f-3' } };
  draggable.closest = makeClosest(
    new Map([['[data-drag-kind][data-drag-id]', draggable]])
  );

  let prevented = false;
  listeners.dragstart[0]({
    target: draggable,
    dataTransfer: { set effectAllowed(v) {}, setData() {} },
    preventDefault() { prevented = true; }
  });

  assert.equal(prevented, true);
  assert.equal(state.dragState.activeKind, null);
});

runTest('submit: data-inline-editor-form submits tree editor', async () => {
  const { element, listeners } = makeElements();
  const { bindFolderTreeEvents } = await import(
    '../../lib/events/folder-tree-events.js'
  );
  let submitted = 0;
  let prevented = false;
  const deps = makeDeps({
    submitTreeEditor: async () => { submitted += 1; }
  });

  bindFolderTreeEvents({ state: makeState(), elements: { folderTree: element }, deps });

  const form = { dataset: {} };
  form.closest = makeClosest(new Map([['[data-inline-editor-form]', form]]));

  listeners.submit[0]({ target: form, preventDefault() { prevented = true; } });

  assert.equal(submitted, 1);
  assert.equal(prevented, true);
});

runTest('keydown: Escape inside inline editor cancels', async () => {
  const { element, listeners } = makeElements();
  const { bindFolderTreeEvents } = await import(
    '../../lib/events/folder-tree-events.js'
  );
  let cancelled = 0;
  let prevented = false;
  const deps = makeDeps({
    cancelTreeEditor: () => { cancelled += 1; }
  });

  bindFolderTreeEvents({ state: makeState(), elements: { folderTree: element }, deps });

  const input = {};
  input.closest = makeClosest(new Map([['[data-inline-editor-input]', input]]));

  listeners.keydown[0]({
    target: input,
    key: 'Escape',
    preventDefault() { prevented = true; }
  });

  assert.equal(cancelled, 1);
  assert.equal(prevented, true);
});

runTest('input: inline editor value syncs to state.treeEditor.value', async () => {
  const { element, listeners } = makeElements();
  const { bindFolderTreeEvents } = await import(
    '../../lib/events/folder-tree-events.js'
  );
  const state = makeState();
  state.treeEditor = { value: '' };
  const deps = makeDeps();

  bindFolderTreeEvents({ state, elements: { folderTree: element }, deps });

  const input = { value: 'new-name' };
  input.closest = makeClosest(new Map([['[data-inline-editor-input]', input]]));

  listeners.input[0]({ target: input });

  assert.equal(state.treeEditor.value, 'new-name');
});

runTest('dragend: resets drag state only when activeKind is set', async () => {
  const { element, listeners } = makeElements();
  const { bindFolderTreeEvents } = await import(
    '../../lib/events/folder-tree-events.js'
  );
  let resetCount = 0;
  const state = makeState();
  const deps = makeDeps({
    resetDragState: () => { resetCount += 1; }
  });

  bindFolderTreeEvents({ state, elements: { folderTree: element }, deps });

  // activeKind = null：不重置
  listeners.dragend[0]({ target: {} });
  assert.equal(resetCount, 0);

  // activeKind = 'folder'：重置
  state.dragState.activeKind = 'folder';
  listeners.dragend[0]({ target: {} });
  assert.equal(resetCount, 1);
});

// 串行执行所有测试用例。
(async () => {
  for (const run of tests) {
    await run();
  }
})();
