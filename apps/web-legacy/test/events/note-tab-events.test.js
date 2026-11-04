import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ─── 源模式断言（compile-time contract）──────────────────────────

const binderSource = fs.readFileSync(
  path.resolve(__dirname, '../../lib/events/note-tab-events.js'),
  'utf8'
);

assert.match(
  binderSource,
  /export function bindNoteTabEvents/,
  'note-tab-events.js should export bindNoteTabEvents'
);
[
  'click',
  'contextmenu',
  'dragstart',
  'dragover',
  'drop',
  'dragend'
].forEach((type) => {
  assert.equal(
    (binderSource.match(new RegExp(`elements\\.noteTabs\\?\\.addEventListener\\('${type}'`, 'g')) ?? []).length,
    1,
    `note-tab binder should register exactly 1 ${type} listener on noteTabs`
  );
});
assert.equal(
  (binderSource.match(/elements\.noteTabMenu\?\.addEventListener\('click'/g) ?? []).length,
  1,
  'note-tab binder should register exactly 1 click listener on noteTabMenu'
);
assert.equal(
  (binderSource.match(/elements\.noteTabOverflowMenu\?\.addEventListener\('click'/g) ?? []).length,
  1,
  'note-tab binder should register exactly 1 click listener on the overflow menu'
);
assert.equal(
  (binderSource.match(/elements\.noteTabOverflowToggleHost\?\.addEventListener\('click'/g) ?? []).length,
  1,
  'note-tab binder should register exactly 1 click listener on the overflow toggle host'
);

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
  const types = ['click', 'contextmenu', 'dragstart', 'dragover', 'drop', 'dragend', 'keydown'];
  const listeners = { noteTabs: {}, noteTabMenu: {}, noteTabOverflowMenu: {}, noteTabOverflowToggleHost: {} };
  for (const t of types) listeners.noteTabs[t] = [];
  listeners.noteTabMenu.click = [];
  listeners.noteTabOverflowMenu.click = [];
  listeners.noteTabOverflowToggleHost.click = [];
  return {
    elements: {
      noteTabs: {
        addEventListener(type, fn) { listeners.noteTabs[type].push(fn); },
        querySelectorAll() { return []; }
      },
      noteTabMenu: {
        addEventListener(type, fn) { listeners.noteTabMenu[type].push(fn); }
      },
      noteTabOverflowMenu: {
        addEventListener(type, fn) { listeners.noteTabOverflowMenu[type].push(fn); }
      },
      noteTabOverflowToggleHost: {
        addEventListener(type, fn) { listeners.noteTabOverflowToggleHost[type].push(fn); }
      }
    },
    listeners
  };
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
    openNoteTabs: [],
    tabDragState: { activeId: null, overId: null }
  };
}

function makeDeps(overrides = {}) {
  return {
    handleTabClose: async () => {},
    selectNote: async () => {},
    openTabMenu: () => {},
    syncTabDragIndicators: () => {},
    reorderTabs: (tabs) => tabs,
    resetTabDragState: () => {},
    handleTabMenuAction: async () => {},
    toggleTabOverflowMenu: () => {},
    selectOverflowTab: async () => {},
    renderTabs: () => {},
    ...overrides
  };
}

runTest('noteTabs click: data-tab-close dispatches handleTabClose and stops propagation', async () => {
  const { elements, listeners } = makeElements();
  const { bindNoteTabEvents } = await import(
    '../../lib/events/note-tab-events.js'
  );
  let closedArg = null;
  let stopped = false;
  const deps = makeDeps({
    handleTabClose: async (id) => { closedArg = id; }
  });

  bindNoteTabEvents({ state: makeState(), elements, deps });

  const target = { dataset: { tabClose: 'n-7' } };
  target.closest = makeClosest(new Map([['[data-tab-close]', target]]));
  listeners.noteTabs.click[0]({ target, stopPropagation() { stopped = true; } });

  assert.equal(closedArg, 'n-7');
  assert.equal(stopped, true);
});

runTest('noteTabs click: data-tab-note-id dispatches selectNote with ensureTab', async () => {
  const { elements, listeners } = makeElements();
  const { bindNoteTabEvents } = await import(
    '../../lib/events/note-tab-events.js'
  );
  let arg = null;
  let opts = null;
  const deps = makeDeps({
    selectNote: async (id, o) => { arg = id; opts = o; }
  });

  bindNoteTabEvents({ state: makeState(), elements, deps });

  const target = { dataset: { tabNoteId: 'n-3' } };
  target.closest = makeClosest(new Map([['[data-tab-note-id]', target]]));
  listeners.noteTabs.click[0]({ target });

  assert.equal(arg, 'n-3');
  assert.deepEqual(opts, { syncFolder: true, ensureTab: true });
});

runTest('noteTabs click: overflow toggle opens the hidden-tab menu', async () => {
  const { elements, listeners } = makeElements();
  const { bindNoteTabEvents } = await import('../../lib/events/note-tab-events.js');
  let toggled = 0;
  let stopped = false;
  bindNoteTabEvents({
    state: makeState(),
    elements,
    deps: makeDeps({ toggleTabOverflowMenu: () => { toggled += 1; } })
  });

  const target = { dataset: { tabOverflowToggle: '' } };
  target.closest = makeClosest(new Map([['[data-tab-overflow-toggle]', target]]));
  listeners.noteTabs.click[0]({ target, stopPropagation() { stopped = true; } });

  assert.equal(toggled, 1);
  assert.equal(stopped, true);
});

runTest('overflow toggle host click opens the hidden-tab menu', async () => {
  const { elements, listeners } = makeElements();
  const { bindNoteTabEvents } = await import('../../lib/events/note-tab-events.js');
  let toggled = 0;
  let stopped = false;
  bindNoteTabEvents({
    state: makeState(),
    elements,
    deps: makeDeps({ toggleTabOverflowMenu: () => { toggled += 1; } })
  });

  const target = { dataset: { tabOverflowToggle: '' } };
  target.closest = makeClosest(new Map([['[data-tab-overflow-toggle]', target]]));
  listeners.noteTabOverflowToggleHost.click[0]({ target, stopPropagation() { stopped = true; } });

  assert.equal(toggled, 1);
  assert.equal(stopped, true);
});

runTest('noteTabs click: text-node-like target still resolves tab button', async () => {
  const { elements, listeners } = makeElements();
  const { bindNoteTabEvents } = await import(
    '../../lib/events/note-tab-events.js'
  );
  let arg = null;
  const deps = makeDeps({
    selectNote: async (id) => { arg = id; }
  });

  bindNoteTabEvents({ state: makeState(), elements, deps });

  const button = { dataset: { tabNoteId: 'n-text' } };
  button.closest = makeClosest(new Map([['[data-tab-note-id]', button]]));
  listeners.noteTabs.click[0]({ target: { parentElement: button } });

  assert.equal(arg, 'n-text');
});

runTest('noteTabs contextmenu: opens tab menu with x/y/noteId', async () => {
  const { elements, listeners } = makeElements();
  const { bindNoteTabEvents } = await import(
    '../../lib/events/note-tab-events.js'
  );
  let args = null;
  let prevented = false;
  const deps = makeDeps({
    openTabMenu: (a) => { args = a; }
  });

  bindNoteTabEvents({ state: makeState(), elements, deps });

  const target = { dataset: { tabNoteId: 'n-3' } };
  target.closest = makeClosest(new Map([['[data-tab-note-id]', target]]));
  listeners.noteTabs.contextmenu[0]({
    target,
    clientX: 50,
    clientY: 60,
    preventDefault() { prevented = true; }
  });

  assert.deepEqual(args, { x: 50, y: 60, noteId: 'n-3' });
  assert.equal(prevented, true);
});

runTest('noteTabs dragstart: sets activeId, effectAllowed, dataTransfer', async () => {
  const { elements, listeners } = makeElements();
  const { bindNoteTabEvents } = await import(
    '../../lib/events/note-tab-events.js'
  );
  let synced = 0;
  const state = makeState();
  const deps = makeDeps({
    syncTabDragIndicators: () => { synced += 1; }
  });

  bindNoteTabEvents({ state, elements, deps });

  const target = { dataset: { tabNoteId: 'n-3' } };
  target.closest = makeClosest(new Map([['[data-tab-note-id]', target]]));

  let effectAllowed = null;
  let dataStr = null;
  listeners.noteTabs.dragstart[0]({
    target,
    dataTransfer: {
      set effectAllowed(v) { effectAllowed = v; },
      setData(type, value) { dataStr = { type, value }; }
    }
  });

  assert.equal(state.tabDragState.activeId, 'n-3');
  assert.equal(state.tabDragState.overId, null);
  assert.equal(effectAllowed, 'move');
  assert.deepEqual(dataStr, { type: 'text/plain', value: 'n-3' });
  assert.equal(synced, 1);
});

runTest('noteTabs drop: reorders tabs and resets state', async () => {
  const { elements, listeners } = makeElements();
  const { bindNoteTabEvents } = await import(
    '../../lib/events/note-tab-events.js'
  );
  let reorderArgs = null;
  let resetCount = 0;
  const state = makeState();
  state.openNoteTabs = ['n-1', 'n-2', 'n-3'];
  state.tabDragState.activeId = 'n-3';
  const deps = makeDeps({
    reorderTabs: (tabs, from, to) => { reorderArgs = { tabs, from, to }; return ['n-3', 'n-1', 'n-2']; },
    resetTabDragState: () => { resetCount += 1; }
  });

  bindNoteTabEvents({ state, elements, deps });

  const target = { dataset: { tabNoteId: 'n-1' } };
  target.closest = makeClosest(new Map([['[data-tab-note-id]', target]]));
  let prevented = false;
  listeners.noteTabs.drop[0]({ target, preventDefault() { prevented = true; } });

  assert.deepEqual(reorderArgs, { tabs: ['n-1', 'n-2', 'n-3'], from: 'n-3', to: 'n-1' });
  assert.deepEqual(state.openNoteTabs, ['n-3', 'n-1', 'n-2']);
  assert.equal(resetCount, 1);
  assert.equal(prevented, true);
});

runTest('noteTabMenu click: data-tab-menu-action dispatches handleTabMenuAction', async () => {
  const { elements, listeners } = makeElements();
  const { bindNoteTabEvents } = await import(
    '../../lib/events/note-tab-events.js'
  );
  let arg = null;
  const deps = makeDeps({
    handleTabMenuAction: async (a) => { arg = a; }
  });

  bindNoteTabEvents({ state: makeState(), elements, deps });

  const target = { dataset: { tabMenuAction: 'close-others' } };
  target.closest = makeClosest(new Map([['[data-tab-menu-action]', target]]));
  listeners.noteTabMenu.click[0]({ target });

  assert.equal(arg, 'close-others');
});

runTest('overflow menu click selects a hidden tab', async () => {
  const { elements, listeners } = makeElements();
  const { bindNoteTabEvents } = await import('../../lib/events/note-tab-events.js');
  let selected = null;
  bindNoteTabEvents({
    state: makeState(),
    elements,
    deps: makeDeps({ selectOverflowTab: async (noteId) => { selected = noteId; } })
  });

  const target = { dataset: { tabOverflowNoteId: 'n-hidden' } };
  target.closest = makeClosest(new Map([['[data-tab-overflow-note-id]', target]]));
  let stopped = false;
  listeners.noteTabOverflowMenu.click[0]({ target, stopPropagation() { stopped = true; } });

  assert.equal(selected, 'n-hidden');
  assert.equal(stopped, true);
});

// 串行执行所有测试用例。
(async () => {
  for (const run of tests) {
    await run();
  }
})();
