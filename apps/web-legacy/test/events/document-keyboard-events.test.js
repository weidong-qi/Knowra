import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ─── 源模式断言（compile-time contract）──────────────────────────

const binderSource = fs.readFileSync(
  path.resolve(__dirname, '../../lib/events/document-keyboard-events.js'),
  'utf8'
);

assert.match(
  binderSource,
  /export function bindDocumentKeyboardEvents/,
  'document-keyboard-events.js should export bindDocumentKeyboardEvents'
);
// 必须保持两个独立 document.keydown 监听器（顺序敏感）。
const keydownMatches =
  binderSource.match(/documentRef\.addEventListener\('keydown'/g) ?? [];
assert.equal(
  keydownMatches.length,
  2,
  'document-keyboard binder should register two distinct keydown listeners'
);
// 第二个监听器必须保留 `, true)` 捕获阶段（L1207 原文）。
assert.match(
  binderSource,
  /\},\s*true\);?\s*$/m,
  'document-keyboard binder should preserve capture phase (true) on the second listener'
);

// ─── Handler-recorder 断言（behavioral）──────────────────────────

const tests = [];

function runTest(name, callback) {
  // 把 callback 包装为 Promise，所有测试串行 await，避免多个
  // withMockDocument 互相覆盖 globalThis.document。
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

// 拦截 globalThis.document.addEventListener，把监听器存到 Map。
// capture 参数也存下来，方便测试断言是否在捕获阶段注册。
async function withMockDocument(handler) {
  const originalDocument = globalThis.document;
  const listeners = new Map();
  globalThis.document = {
    addEventListener(type, fn, options) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push({ fn, capture: options === true });
    }
  };

  try {
    return await handler(listeners);
  } finally {
    if (originalDocument === undefined) {
      delete globalThis.document;
    } else {
      globalThis.document = originalDocument;
    }
  }
}

function makeState() {
  return {
    search: { isOpen: false },
    editorTableDialog: { open: false },
    editorPanel: { open: false, mode: null }
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

function makeDeps() {
  return {
    renderSearchShell: () => {},
    focusSearchInput: () => {},
    closeContextMenu: () => {},
    closeSectionMenu: () => {},
    closeTabMenu: () => {},
    closeTabOverflowMenu: () => {},
    closeEditorMenuBar: () => {},
    closeEditorContextMenu: () => {},
    closeTableInsertDialog: () => {},
    submitTableInsertDialog: async () => {},
    resolveEditorPanelKeyboardAction: () => null,
    handleEditorPanelAction: async () => {},
    resolveEditorShortcutAction: () => null,
    shouldHandleEditorShortcut: () => true,
    handleResolvedEditorShortcut: async () => {},
    closeEditorPanel: () => {}
  };
}

runTest('capture keydown Meta/Ctrl+K opens and focuses global search', async () => {
  await withMockDocument(async (listeners) => {
    const { bindDocumentKeyboardEvents } = await import(
      '../../lib/events/document-keyboard-events.js'
    );
    const state = makeState();
    let rendered = 0;
    let focused = 0;
    const deps = makeDeps();
    deps.renderSearchShell = () => { rendered += 1; };
    deps.focusSearchInput = () => { focused += 1; };

    bindDocumentKeyboardEvents({ state, elements: {}, deps });

    const target = {};
    target.closest = makeClosest(new Map());

    for (const modifier of ['metaKey', 'ctrlKey']) {
      let prevented = false;
      let stopped = false;
      state.search.isOpen = false;
      listeners.get('keydown')[1].fn({
        key: 'k',
        [modifier]: true,
        target,
        preventDefault() { prevented = true; },
        stopPropagation() { stopped = true; }
      });

      assert.equal(state.search.isOpen, true);
      assert.equal(prevented, true);
      assert.equal(stopped, true);
    }

    assert.equal(rendered, 2);
    assert.equal(focused, 2);
  });
});

runTest('bubble keydown Escape closes search shell and dispatches close chain', async () => {
  await withMockDocument(async (listeners) => {
    const { bindDocumentKeyboardEvents } = await import(
      '../../lib/events/document-keyboard-events.js'
    );
    const state = makeState();
    state.search.isOpen = true;
    let rendered = 0;
    let closedContext = 0;
    let closedSection = 0;
    let closedTab = 0;
    const closeOverflowOptions = [];
    const closeMenuBarOptions = [];
    let closedCtxMenu = 0;
    let closedTableDialog = 0;
    const deps = makeDeps();
    deps.renderSearchShell = () => { rendered += 1; };
    deps.closeContextMenu = () => { closedContext += 1; };
    deps.closeSectionMenu = () => { closedSection += 1; };
    deps.closeTabMenu = () => { closedTab += 1; };
    deps.closeTabOverflowMenu = (options) => { closeOverflowOptions.push(options); };
    deps.closeEditorMenuBar = (options) => { closeMenuBarOptions.push(options); };
    deps.closeEditorContextMenu = () => { closedCtxMenu += 1; };
    deps.closeTableInsertDialog = () => { closedTableDialog += 1; };

    bindDocumentKeyboardEvents({ state, elements: {}, deps });

    const keydownHandlers = listeners.get('keydown');
    assert.equal(keydownHandlers.length, 2);
    // 第一个监听器（冒泡阶段）不应携带 capture=true。
    assert.equal(keydownHandlers[0].capture, false);
    // 第二个监听器必须带 capture=true。
    assert.equal(keydownHandlers[1].capture, true);

    const target = {};
    target.closest = makeClosest(new Map());
    keydownHandlers[0].fn({ key: 'Escape', target });

    assert.equal(state.search.isOpen, false);
    assert.equal(rendered, 1);
    assert.equal(closedContext, 1);
    assert.equal(closedSection, 1);
    assert.equal(closedTab, 1);
    assert.deepEqual(closeOverflowOptions, [{ restoreFocus: true }]);
    assert.deepEqual(closeMenuBarOptions, [{ restoreFocus: true }]);
    assert.equal(closedCtxMenu, 1);
    assert.equal(closedTableDialog, 1);
  });
});

runTest('capture keydown Enter inside table dialog submits and short-circuits', async () => {
  await withMockDocument(async (listeners) => {
    const { bindDocumentKeyboardEvents } = await import(
      '../../lib/events/document-keyboard-events.js'
    );
    const state = makeState();
    state.editorTableDialog.open = true;
    let submitted = 0;
    let closed = 0;
    const deps = makeDeps();
    deps.submitTableInsertDialog = async () => { submitted += 1; };
    deps.closeTableInsertDialog = () => { closed += 1; };

    bindDocumentKeyboardEvents({ state, elements: {}, deps });

    const target = {};
    target.closest = makeClosest(new Map([['#editor-table-dialog', {}]]));

    let prevented = false;
    let stopped = false;
    const event = {
      key: 'Enter',
      target,
      preventDefault() { prevented = true; },
      stopPropagation() { stopped = true; }
    };
    listeners.get('keydown')[1].fn(event);

    assert.equal(submitted, 1);
    assert.equal(closed, 0);
    assert.equal(prevented, true);
    assert.equal(stopped, true);
  });
});

runTest('capture keydown Escape inside table dialog closes dialog', async () => {
  await withMockDocument(async (listeners) => {
    const { bindDocumentKeyboardEvents } = await import(
      '../../lib/events/document-keyboard-events.js'
    );
    const state = makeState();
    state.editorTableDialog.open = true;
    let submitted = 0;
    let closed = 0;
    const deps = makeDeps();
    deps.submitTableInsertDialog = async () => { submitted += 1; };
    deps.closeTableInsertDialog = () => { closed += 1; };

    bindDocumentKeyboardEvents({ state, elements: {}, deps });

    const target = {};
    target.closest = makeClosest(new Map([['#editor-table-dialog', {}]]));

    let prevented = false;
    let stopped = false;
    const event = {
      key: 'Escape',
      target,
      preventDefault() { prevented = true; },
      stopPropagation() { stopped = true; }
    };
    listeners.get('keydown')[1].fn(event);

    assert.equal(submitted, 0);
    assert.equal(closed, 1);
    assert.equal(prevented, true);
    assert.equal(stopped, true);
  });
});

runTest('capture keydown in editor panel find mode dispatches handleEditorPanelAction', async () => {
  await withMockDocument(async (listeners) => {
    const { bindDocumentKeyboardEvents } = await import(
      '../../lib/events/document-keyboard-events.js'
    );
    const state = makeState();
    state.editorPanel.open = true;
    state.editorPanel.mode = 'find';
    let actionCalled = null;
    let resolvedAction = null;
    const deps = makeDeps();
    deps.resolveEditorPanelKeyboardAction = () => 'next';
    deps.handleEditorPanelAction = async (a) => { actionCalled = a; };

    bindDocumentKeyboardEvents({ state, elements: {}, deps });

    const target = {};
    target.closest = makeClosest(new Map());

    let prevented = false;
    let stopped = false;
    const event = {
      key: 'Enter',
      target,
      preventDefault() { prevented = true; },
      stopPropagation() { stopped = true; }
    };
    listeners.get('keydown')[1].fn(event);

    // 行为：next 映射为 submit。
    assert.equal(actionCalled, 'submit');
    assert.equal(resolvedAction, null); // 占位以防未来扩展
    assert.equal(prevented, true);
    assert.equal(stopped, true);
  });
});

runTest('capture keydown editor shortcut is dispatched to handleResolvedEditorShortcut', async () => {
  await withMockDocument(async (listeners) => {
    const { bindDocumentKeyboardEvents } = await import(
      '../../lib/events/document-keyboard-events.js'
    );
    const state = makeState();
    let resolved = null;
    const deps = makeDeps();
    deps.resolveEditorShortcutAction = () => 'bold';
    deps.shouldHandleEditorShortcut = () => true;
    deps.handleResolvedEditorShortcut = async (a) => { resolved = a; };

    bindDocumentKeyboardEvents({ state, elements: {}, deps });

    const target = {};
    target.closest = makeClosest(new Map());

    let prevented = false;
    let stopped = false;
    const event = {
      key: 'b',
      ctrlKey: true,
      target,
      preventDefault() { prevented = true; },
      stopPropagation() { stopped = true; }
    };
    listeners.get('keydown')[1].fn(event);

    assert.equal(resolved, 'bold');
    assert.equal(prevented, true);
    assert.equal(stopped, true);
  });
});

runTest('capture keydown Escape closes editor panel when nothing else matched', async () => {
  await withMockDocument(async (listeners) => {
    const { bindDocumentKeyboardEvents } = await import(
      '../../lib/events/document-keyboard-events.js'
    );
    const state = makeState();
    let closed = 0;
    const deps = makeDeps();
    deps.closeEditorPanel = () => { closed += 1; };

    bindDocumentKeyboardEvents({ state, elements: {}, deps });

    const target = {};
    target.closest = makeClosest(new Map());

    listeners.get('keydown')[1].fn({ key: 'Escape', target });

    assert.equal(closed, 1);
  });
});

runTest('capture keydown shortcut is skipped when shouldHandleEditorShortcut returns false', async () => {
  await withMockDocument(async (listeners) => {
    const { bindDocumentKeyboardEvents } = await import(
      '../../lib/events/document-keyboard-events.js'
    );
    const state = makeState();
    let resolved = null;
    let closed = 0;
    const deps = makeDeps();
    deps.resolveEditorShortcutAction = () => 'bold';
    deps.shouldHandleEditorShortcut = () => false;
    deps.handleResolvedEditorShortcut = async (a) => { resolved = a; };
    deps.closeEditorPanel = () => { closed += 1; };

    bindDocumentKeyboardEvents({ state, elements: {}, deps });

    const target = {};
    target.closest = makeClosest(new Map());

    // 不应被 resolve / handleResolvedEditorShortcut 拦截，直接落到 Escape 分支。
    listeners.get('keydown')[1].fn({ key: 'Escape', target });

    assert.equal(resolved, null);
    assert.equal(closed, 1);
  });
});

runTest('keydown handlers ignore composition events so IME confirmation is not hijacked', async () => {
  await withMockDocument(async (listeners) => {
    const { bindDocumentKeyboardEvents } = await import(
      '../../lib/events/document-keyboard-events.js'
    );
    const state = makeState();
    state.search.isOpen = true;
    let rendered = 0;
    let closedPanel = 0;
    let resolved = null;
    const deps = makeDeps();
    deps.renderSearchShell = () => { rendered += 1; };
    deps.handleResolvedEditorShortcut = async (action) => { resolved = action; };
    deps.resolveEditorShortcutAction = () => 'bold';
    deps.closeEditorPanel = () => { closedPanel += 1; };

    bindDocumentKeyboardEvents({ state, elements: {}, deps });

    const target = {};
    target.closest = makeClosest(new Map());

    listeners.get('keydown')[0].fn({ key: 'Escape', target, isComposing: true });
    listeners.get('keydown')[1].fn({ key: 'Escape', target, isComposing: true });

    assert.equal(state.search.isOpen, true);
    assert.equal(rendered, 0);
    assert.equal(closedPanel, 0);
    assert.equal(resolved, null);
  });
});

// 串行执行所有测试用例（避免共享 globalThis 状态）。
(async () => {
  for (const run of tests) {
    await run();
  }
})();
