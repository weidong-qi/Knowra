import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ─── 源模式断言（compile-time contract）──────────────────────────

const binderSource = fs.readFileSync(
  path.resolve(__dirname, '../../lib/events/document-input-events.js'),
  'utf8'
);

assert.match(
  binderSource,
  /export function bindDocumentInputEvents/,
  'document-input-events.js should export bindDocumentInputEvents'
);
assert.equal(
  (binderSource.match(/documentRef\.addEventListener\('input'/g) ?? []).length,
  1,
  'document-input binder should register exactly one input listener'
);
assert.match(
  binderSource,
  /getCurrentEditorHost/,
  'document-input binder should resolve currentEditorHost via getter'
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
    editorTableDialog: { rows: 0, cols: 0 },
    editorPanel: { query: '', matchIndex: 0, matchCount: 0, replacement: '' }
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

runTest('table dialog rows field updates state.editorTableDialog.rows', async () => {
  await withMockDocument(async (listeners) => {
    const { bindDocumentInputEvents } = await import(
      '../../lib/events/document-input-events.js'
    );
    const state = makeState();
    const deps = { getCurrentEditorHost: () => null };

    bindDocumentInputEvents({ state, elements: {}, deps });

    const inputHandlers = listeners.get('input');
    assert.equal(inputHandlers.length, 1);

    const target = { dataset: { tableDialogField: 'rows' }, value: '5' };
    target.closest = makeClosest(new Map([['#editor-table-dialog', {}]]));

    inputHandlers[0]({ target });

    assert.equal(state.editorTableDialog.rows, '5');
  });
});

runTest('table dialog cols field updates state.editorTableDialog.cols', async () => {
  await withMockDocument(async (listeners) => {
    const { bindDocumentInputEvents } = await import(
      '../../lib/events/document-input-events.js'
    );
    const state = makeState();
    const deps = { getCurrentEditorHost: () => null };

    bindDocumentInputEvents({ state, elements: {}, deps });

    const inputHandlers = listeners.get('input');

    const target = { dataset: { tableDialogField: 'cols' }, value: '3' };
    target.closest = makeClosest(new Map([['#editor-table-dialog', {}]]));

    inputHandlers[0]({ target });

    assert.equal(state.editorTableDialog.cols, '3');
  });
});

runTest('panel query input updates state and calls clearSearchHighlights', async () => {
  await withMockDocument(async (listeners) => {
    const { bindDocumentInputEvents } = await import(
      '../../lib/events/document-input-events.js'
    );
    const state = makeState();
    state.editorPanel.matchIndex = 7;
    state.editorPanel.matchCount = 12;
    let cleared = 0;
    let resolvedHost = 0;
    const deps = {
      getCurrentEditorHost: () => {
        resolvedHost += 1;
        return { clearSearchHighlights: () => { cleared += 1; } };
      }
    };

    bindDocumentInputEvents({ state, elements: {}, deps });

    const inputHandlers = listeners.get('input');

    const target = { dataset: { panelField: 'query' }, value: 'hello' };
    target.closest = makeClosest(new Map([['#editor-utility-panel', {}]]));

    inputHandlers[0]({ target });

    assert.equal(state.editorPanel.query, 'hello');
    assert.equal(state.editorPanel.matchIndex, -1);
    assert.equal(state.editorPanel.matchCount, 0);
    assert.equal(resolvedHost, 1);
    assert.equal(cleared, 1);
  });
});

runTest('panel replacement input updates state.editorPanel.replacement', async () => {
  await withMockDocument(async (listeners) => {
    const { bindDocumentInputEvents } = await import(
      '../../lib/events/document-input-events.js'
    );
    const state = makeState();
    const deps = { getCurrentEditorHost: () => null };

    bindDocumentInputEvents({ state, elements: {}, deps });

    const inputHandlers = listeners.get('input');

    const target = { dataset: { panelField: 'replacement' }, value: 'world' };
    target.closest = makeClosest(new Map([['#editor-utility-panel', {}]]));

    inputHandlers[0]({ target });

    assert.equal(state.editorPanel.replacement, 'world');
  });
});

runTest('input outside both dialog and panel is a no-op', async () => {
  await withMockDocument(async (listeners) => {
    const { bindDocumentInputEvents } = await import(
      '../../lib/events/document-input-events.js'
    );
    const state = makeState();
    const deps = { getCurrentEditorHost: () => null };

    bindDocumentInputEvents({ state, elements: {}, deps });

    const inputHandlers = listeners.get('input');

    const target = { dataset: {} };
    target.closest = makeClosest(new Map());

    inputHandlers[0]({ target });

    // 状态不应被修改。
    assert.equal(state.editorTableDialog.rows, 0);
    assert.equal(state.editorTableDialog.cols, 0);
    assert.equal(state.editorPanel.query, '');
  });
});

runTest('panel input without data-panel-field is ignored', async () => {
  await withMockDocument(async (listeners) => {
    const { bindDocumentInputEvents } = await import(
      '../../lib/events/document-input-events.js'
    );
    const state = makeState();
    const deps = { getCurrentEditorHost: () => null };

    bindDocumentInputEvents({ state, elements: {}, deps });

    const inputHandlers = listeners.get('input');

    const target = { dataset: {} };
    target.closest = makeClosest(new Map([['#editor-utility-panel', {}]]));

    inputHandlers[0]({ target });

    assert.equal(state.editorPanel.query, '');
  });
});

runTest('getCurrentEditorHost returns latest value (live binding)', async () => {
  await withMockDocument(async (listeners) => {
    const { bindDocumentInputEvents } = await import(
      '../../lib/events/document-input-events.js'
    );
    const state = makeState();
    state.editorPanel.matchIndex = 5;
    let host = null;
    const deps = { getCurrentEditorHost: () => host };

    bindDocumentInputEvents({ state, elements: {}, deps });

    const inputHandlers = listeners.get('input');

    // 第一次 input：host 还没就绪。
    const target = { dataset: { panelField: 'query' }, value: 'a' };
    target.closest = makeClosest(new Map([['#editor-utility-panel', {}]]));
    inputHandlers[0]({ target });
    assert.equal(state.editorPanel.matchIndex, -1);

    // 重新设置 host（模拟编辑器切换）。
    let cleared = 0;
    host = { clearSearchHighlights: () => { cleared += 1; } };

    const target2 = { dataset: { panelField: 'query' }, value: 'b' };
    target2.closest = makeClosest(new Map([['#editor-utility-panel', {}]]));
    inputHandlers[0]({ target: target2 });

    assert.equal(state.editorPanel.query, 'b');
    assert.equal(cleared, 1);
  });
});

// 串行执行所有测试用例（避免共享 globalThis 状态）。
(async () => {
  for (const run of tests) {
    await run();
  }
})();
