import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ─── 源模式断言（compile-time contract）──────────────────────────

const binderSource = fs.readFileSync(
  path.resolve(__dirname, '../../lib/events/menu-events.js'),
  'utf8'
);

assert.match(
  binderSource,
  /export function bindMenuEvents/,
  'menu-events.js should export bindMenuEvents'
);
assert.equal(
  (binderSource.match(/elements\.contextMenu\?\.addEventListener\('click'/g) ?? []).length,
  1,
  'menu binder should register exactly one click listener on contextMenu'
);
assert.equal(
  (binderSource.match(/elements\.sectionMenu\?\.addEventListener\('click'/g) ?? []).length,
  1,
  'menu binder should register exactly one click listener on sectionMenu'
);
assert.equal(
  (binderSource.match(/elements\.editorMenuBar\?\.addEventListener\('click'/g) ?? []).length,
  1,
  'menu binder should register exactly one click listener on editorMenuBar'
);
assert.match(
  binderSource,
  /event\.stopPropagation\(\)/,
  'editorMenuBar handler should call event.stopPropagation() to prevent outside-close'
);
assert.match(
  binderSource,
  /data-format-menu-action/,
  'editorMenuBar handler should dispatch format menu actions'
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

// 构造一个 elements mock：每个 ref 暴露 addEventListener 把 handler
// 存到 listeners map。
function makeElements() {
  const listeners = {
    contextMenu: new Map(),
    sectionMenu: new Map(),
    editorMenuBar: new Map()
  };
  const elements = {
    contextMenu: { addEventListener(type, fn) { listeners.contextMenu.set(type, fn); } },
    sectionMenu: { addEventListener(type, fn) { listeners.sectionMenu.set(type, fn); } },
    editorMenuBar: { addEventListener(type, fn) { listeners.editorMenuBar.set(type, fn); } }
  };
  return { elements, listeners };
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
    secondarySections: {},
    editorMenuOpen: null
  };
}

function makeDeps() {
  return {
    handleContextMenuAction: async () => {},
    renderFolders: () => {},
    renderEditorMenuBar: () => {},
    handleFileMenuAction: async () => {},
    handleEditMenuAction: async () => {},
    handleParagraphMenuAction: async () => {},
    handleFormatMenuAction: async () => {},
    handleViewMenuAction: async () => {},
    handleFormat: async () => {}
  };
}

runTest('contextMenu: data-context-action dispatches handleContextMenuAction', async () => {
  const { elements, listeners } = makeElements();
  const { bindMenuEvents } = await import('../../lib/events/menu-events.js');
  let actionArg = null;
  const deps = makeDeps();
  deps.handleContextMenuAction = async (a) => { actionArg = a; };

  bindMenuEvents({ state: makeState(), elements, deps });

  const target = { dataset: { contextAction: 'new-folder' } };
  target.closest = makeClosest(new Map([['[data-context-action]', target]]));

  listeners.contextMenu.get('click')({ target });

  assert.equal(actionArg, 'new-folder');
});

runTest('contextMenu: click without data-context-action is a no-op', async () => {
  const { elements, listeners } = makeElements();
  const { bindMenuEvents } = await import('../../lib/events/menu-events.js');
  let called = 0;
  const deps = makeDeps();
  deps.handleContextMenuAction = async () => { called += 1; };

  bindMenuEvents({ state: makeState(), elements, deps });

  const target = { dataset: {} };
  target.closest = makeClosest(new Map());

  listeners.contextMenu.get('click')({ target });

  assert.equal(called, 0);
});

runTest('sectionMenu: data-section-toggle flips state and renders folders', async () => {
  const { elements, listeners } = makeElements();
  const { bindMenuEvents } = await import('../../lib/events/menu-events.js');
  let rendered = 0;
  const state = makeState();
  state.secondarySections['tags'] = false;
  const deps = makeDeps();
  deps.renderFolders = () => { rendered += 1; };

  bindMenuEvents({ state, elements, deps });

  const target = { dataset: { sectionToggle: 'tags' } };
  target.closest = makeClosest(new Map([['[data-section-toggle]', target]]));

  listeners.sectionMenu.get('click')({ target });

  assert.equal(state.secondarySections.tags, true);
  assert.equal(rendered, 1);
});

runTest('editorMenuBar: data-editor-menu-toggle toggles state.editorMenuOpen', async () => {
  const { elements, listeners } = makeElements();
  const { bindMenuEvents } = await import('../../lib/events/menu-events.js');
  const renderOptions = [];
  const state = makeState();
  state.editorMenuOpen = null;
  const deps = makeDeps();
  deps.renderEditorMenuBar = (options) => { renderOptions.push(options); };

  bindMenuEvents({ state, elements, deps });

  const target = { dataset: { editorMenuToggle: 'file' } };
  target.closest = makeClosest(new Map([['[data-editor-menu-toggle]', target]]));

  // 第一次点击：null → 'file'
  listeners.editorMenuBar.get('click')({ target, stopPropagation() {} });
  assert.equal(state.editorMenuOpen, 'file');
  assert.deepEqual(renderOptions[0], {
    focusMenuKey: 'file',
    focusTarget: 'first-item'
  });

  // 第二次点击同 key：'file' → null
  listeners.editorMenuBar.get('click')({ target, stopPropagation() {} });
  assert.equal(state.editorMenuOpen, null);
  assert.deepEqual(renderOptions[1], {
    focusMenuKey: 'file',
    focusTarget: 'trigger'
  });
});

runTest('editorMenuBar: the more trigger uses the same menu toggle contract', async () => {
  const { elements, listeners } = makeElements();
  const { bindMenuEvents } = await import('../../lib/events/menu-events.js');
  const state = makeState();
  bindMenuEvents({ state, elements, deps: makeDeps() });

  const target = { dataset: { editorMenuToggle: 'more' } };
  target.closest = makeClosest(new Map([['[data-editor-menu-toggle]', target]]));

  listeners.editorMenuBar.get('click')({ target, stopPropagation() {} });

  assert.equal(state.editorMenuOpen, 'more');
});

runTest('editorMenuBar: stopPropagation called to prevent outside-close race', async () => {
  const { elements, listeners } = makeElements();
  const { bindMenuEvents } = await import('../../lib/events/menu-events.js');
  bindMenuEvents({ state: makeState(), elements, deps: makeDeps() });

  let stopped = false;
  const target = { dataset: {} };
  target.closest = makeClosest(new Map());
  listeners.editorMenuBar.get('click')({ target, stopPropagation() { stopped = true; } });

  assert.equal(stopped, true);
});

runTest('editorMenuBar: file menu action dispatches handleFileMenuAction', async () => {
  const { elements, listeners } = makeElements();
  const { bindMenuEvents } = await import('../../lib/events/menu-events.js');
  let arg = null;
  const deps = makeDeps();
  deps.handleFileMenuAction = async (a) => { arg = a; };

  bindMenuEvents({ state: makeState(), elements, deps });

  const target = { dataset: { fileMenuAction: 'new-note' } };
  target.closest = makeClosest(new Map([['[data-file-menu-action]', target]]));

  listeners.editorMenuBar.get('click')({ target, stopPropagation() {} });

  assert.equal(arg, 'new-note');
});

runTest('editorMenuBar: format menu action dispatches handleFormatMenuAction and short-circuits', async () => {
  const { elements, listeners } = makeElements();
  const { bindMenuEvents } = await import('../../lib/events/menu-events.js');
  let formatArg = null;
  let viewArg = null;
  const deps = makeDeps();
  deps.handleFormatMenuAction = async (a) => { formatArg = a; };
  deps.handleViewMenuAction = async (a) => { viewArg = a; };

  bindMenuEvents({ state: makeState(), elements, deps });

  // 同一元素同时命中两个分支（理论上不会发生）：format 应优先并 return。
  const target = {
    dataset: { formatMenuAction: 'bold', viewMenuAction: 'toggle-preview' }
  };
  target.closest = makeClosest(
    new Map([
      ['[data-format-menu-action]', target],
      ['[data-view-menu-action]', target]
    ])
  );

  listeners.editorMenuBar.get('click')({ target, stopPropagation() {} });

  assert.equal(formatArg, 'bold');
  assert.equal(viewArg, null);
});

runTest('editorMenuBar: quick format buttons dispatch inside the stopped event boundary', async () => {
  const { elements, listeners } = makeElements();
  const { bindMenuEvents } = await import('../../lib/events/menu-events.js');
  let formatArg = null;
  const deps = makeDeps();
  deps.handleFormat = async (action) => { formatArg = action; };

  bindMenuEvents({ state: makeState(), elements, deps });

  const target = { dataset: { format: 'bold' } };
  target.closest = makeClosest(new Map([['[data-format]', target]]));
  listeners.editorMenuBar.get('click')({ target, stopPropagation() {} });

  assert.equal(formatArg, 'bold');
});

// 串行执行所有测试用例。
(async () => {
  for (const run of tests) {
    await run();
  }
})();
