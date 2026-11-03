import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ─── 源模式断言（compile-time contract）──────────────────────────

const binderSource = fs.readFileSync(
  path.resolve(__dirname, '../../lib/events/document-click-events.js'),
  'utf8'
);

assert.match(
  binderSource,
  /export function bindDocumentClickEvents/,
  'document-click-events.js should export bindDocumentClickEvents'
);
// 必须保持两个独立 document.click 监听器（顺序敏感）。
const clickMatches =
  binderSource.match(/documentRef\.addEventListener\('click'/g) ?? [];
assert.equal(
  clickMatches.length,
  2,
  'document-click binder should register two distinct click listeners'
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
async function withMockDocument(handler) {
  const originalDocument = globalThis.document;
  const listeners = new Map();
  globalThis.document = {
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(fn);
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
    search: { isOpen: false }
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
    handleFormat: () => {},
    renderSearchShell: () => {},
    closeContextMenu: () => {},
    closeSectionMenu: () => {},
    closeTabMenu: () => {},
    closeTabOverflowMenu: () => {},
    closeEditorMenuBar: () => {},
    closeEditorContextMenu: () => {}
  };
}

runTest('format button triggers handleFormat', async () => {
  await withMockDocument(async (listeners) => {
    const { bindDocumentClickEvents } = await import(
      '../../lib/events/document-click-events.js'
    );
    const state = makeState();
    const deps = makeDeps();
    let formatted = null;
    deps.handleFormat = (format) => { formatted = format; };

    bindDocumentClickEvents({ state, elements: {}, deps });

    const clickHandlers = listeners.get('click');
    assert.equal(clickHandlers.length, 2);

    const target = { dataset: { format: 'bold' } };
    target.closest = makeClosest(new Map([['[data-format]', target]]));
    clickHandlers[0]({ target });

    assert.equal(formatted, 'bold');
  });
});

runTest('click outside search shell closes shell and dispatches close chain', async () => {
  await withMockDocument(async (listeners) => {
    const { bindDocumentClickEvents } = await import(
      '../../lib/events/document-click-events.js'
    );
    const state = makeState();
    state.search.isOpen = true;
    let rendered = 0;
    let closedContext = 0;
    let closedSection = 0;
    let closedTab = 0;
    let closedMenuBar = 0;
    let closedCtxMenu = 0;
    const deps = {
      handleFormat: () => {},
      renderSearchShell: () => { rendered += 1; },
      closeContextMenu: () => { closedContext += 1; },
      closeSectionMenu: () => { closedSection += 1; },
      closeTabMenu: () => { closedTab += 1; },
      closeTabOverflowMenu: () => {},
      closeEditorMenuBar: () => { closedMenuBar += 1; },
      closeEditorContextMenu: () => { closedCtxMenu += 1; }
    };

    bindDocumentClickEvents({ state, elements: {}, deps });

    const clickHandlers = listeners.get('click');
    // 模拟点击非搜索 shell、非任何已打开菜单的元素。
    const target = { dataset: {} };
    target.closest = makeClosest(new Map());

    clickHandlers[1]({ target });

    assert.equal(state.search.isOpen, false);
    assert.equal(rendered, 1);
    assert.equal(closedContext, 1);
    assert.equal(closedSection, 1);
    assert.equal(closedTab, 1);
    assert.equal(closedMenuBar, 1);
    assert.equal(closedCtxMenu, 1);
  });
});

runTest('click inside library context menu is ignored (no close chain)', async () => {
  await withMockDocument(async (listeners) => {
    const { bindDocumentClickEvents } = await import(
      '../../lib/events/document-click-events.js'
    );
    const state = makeState();
    let closedContext = 0;
    const deps = makeDeps();
    deps.closeContextMenu = () => { closedContext += 1; };

    bindDocumentClickEvents({ state, elements: {}, deps });

    const target = { dataset: {} };
    target.closest = makeClosest(new Map([['#library-context-menu', {}]]));

    const clickHandlers = listeners.get('click');
    clickHandlers[1]({ target });

    assert.equal(closedContext, 0);
  });
});

runTest('format click also works from a text-node-like target', async () => {
  await withMockDocument(async (listeners) => {
    const { bindDocumentClickEvents } = await import(
      '../../lib/events/document-click-events.js'
    );
    let formatted = null;
    const deps = makeDeps();
    deps.handleFormat = (format) => { formatted = format; };

    bindDocumentClickEvents({ state: makeState(), elements: {}, deps });

    const button = { dataset: { format: 'italic' } };
    button.closest = makeClosest(new Map([['[data-format]', button]]));
    listeners.get('click')[0]({ target: { parentElement: button } });

    assert.equal(formatted, 'italic');
  });
});

// 串行执行所有测试用例（避免共享 globalThis 状态）。
(async () => {
  for (const run of tests) {
    await run();
  }
})();
