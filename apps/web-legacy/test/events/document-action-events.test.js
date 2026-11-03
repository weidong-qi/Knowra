import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ─── 源模式断言（compile-time contract）──────────────────────────

const binderSource = fs.readFileSync(
  path.resolve(__dirname, '../../lib/events/document-action-events.js'),
  'utf8'
);

assert.match(
  binderSource,
  /export function bindDocumentActionEvents/,
  'document-action-events.js should export bindDocumentActionEvents'
);
assert.equal(
  (binderSource.match(/documentRef\.addEventListener\('click'/g) ?? []).length,
  1,
  'document-action binder should register exactly one click listener'
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
    submitTableInsertDialog: async () => {},
    closeTableInsertDialog: () => {},
    handleEditorPanelAction: async () => {},
    handleViewMenuAction: async () => {},
    persistDraft: () => {}
  };
}

runTest('table dialog confirm action submits', async () => {
  await withMockDocument(async (listeners) => {
    const { bindDocumentActionEvents } = await import(
      '../../lib/events/document-action-events.js'
    );
    let submitted = 0;
    let closed = 0;
    const deps = makeDeps();
    deps.submitTableInsertDialog = async () => { submitted += 1; };
    deps.closeTableInsertDialog = () => { closed += 1; };

    bindDocumentActionEvents({ state: {}, elements: {}, deps });

    const target = { dataset: { editorTableDialogAction: 'confirm' } };
    target.closest = makeClosest(
      new Map([['[data-editor-table-dialog-action]', target]])
    );

    listeners.get('click')[0]({ target });

    assert.equal(submitted, 1);
    assert.equal(closed, 0);
  });
});

runTest('table dialog cancel action closes dialog', async () => {
  await withMockDocument(async (listeners) => {
    const { bindDocumentActionEvents } = await import(
      '../../lib/events/document-action-events.js'
    );
    let submitted = 0;
    let closed = 0;
    const deps = makeDeps();
    deps.submitTableInsertDialog = async () => { submitted += 1; };
    deps.closeTableInsertDialog = () => { closed += 1; };

    bindDocumentActionEvents({ state: {}, elements: {}, deps });

    const target = { dataset: { editorTableDialogAction: 'cancel' } };
    target.closest = makeClosest(
      new Map([['[data-editor-table-dialog-action]', target]])
    );

    listeners.get('click')[0]({ target });

    assert.equal(submitted, 0);
    assert.equal(closed, 1);
  });
});

runTest('editor panel action dispatches handler with action name', async () => {
  await withMockDocument(async (listeners) => {
    const { bindDocumentActionEvents } = await import(
      '../../lib/events/document-action-events.js'
    );
    let actionArg = null;
    const deps = makeDeps();
    deps.handleEditorPanelAction = async (a) => { actionArg = a; };

    bindDocumentActionEvents({ state: {}, elements: {}, deps });

    const target = { dataset: { editorPanelAction: 'replace-all' } };
    target.closest = makeClosest(
      new Map([['[data-editor-panel-action]', target]])
    );

    listeners.get('click')[0]({ target });

    assert.equal(actionArg, 'replace-all');
  });
});

runTest('data-save-now persists draft immediately', async () => {
  await withMockDocument(async (listeners) => {
    const { bindDocumentActionEvents } = await import(
      '../../lib/events/document-action-events.js'
    );
    let persistArg = null;
    const deps = makeDeps();
    deps.persistDraft = (opts) => { persistArg = opts; };

    bindDocumentActionEvents({ state: {}, elements: {}, deps });

    const target = { dataset: {} };
    target.closest = makeClosest(
      new Map([['[data-save-now]', target]])
    );

    listeners.get('click')[0]({ target });

    assert.deepEqual(persistArg, { immediate: true });
  });
});

runTest('status action dispatches the shared view command', async () => {
  await withMockDocument(async (listeners) => {
    const { bindDocumentActionEvents } = await import(
      '../../lib/events/document-action-events.js'
    );
    let actionArg = null;
    const deps = makeDeps();
    deps.handleViewMenuAction = async (action) => { actionArg = action; };

    bindDocumentActionEvents({ state: {}, elements: {}, deps });

    const target = { dataset: { statusAction: 'toggle-right-sidebar' } };
    target.closest = makeClosest(
      new Map([['[data-status-action]', target]])
    );
    listeners.get('click')[0]({ target });

    assert.equal(actionArg, 'toggle-right-sidebar');
  });
});

runTest('click on none of the action elements is a no-op', async () => {
  await withMockDocument(async (listeners) => {
    const { bindDocumentActionEvents } = await import(
      '../../lib/events/document-action-events.js'
    );
    let submitted = 0;
    let closed = 0;
    let actionCalled = 0;
    let persisted = 0;
    const deps = {
      submitTableInsertDialog: async () => { submitted += 1; },
      closeTableInsertDialog: () => { closed += 1; },
      handleEditorPanelAction: async () => { actionCalled += 1; },
      handleViewMenuAction: async () => {},
      persistDraft: () => { persisted += 1; }
    };

    bindDocumentActionEvents({ state: {}, elements: {}, deps });

    const target = { dataset: {} };
    target.closest = makeClosest(new Map());

    listeners.get('click')[0]({ target });

    assert.equal(submitted, 0);
    assert.equal(closed, 0);
    assert.equal(actionCalled, 0);
    assert.equal(persisted, 0);
  });
});

runTest('table dialog action short-circuits before panel action', async () => {
  await withMockDocument(async (listeners) => {
    const { bindDocumentActionEvents } = await import(
      '../../lib/events/document-action-events.js'
    );
    let submitted = 0;
    let actionCalled = 0;
    const deps = makeDeps();
    deps.submitTableInsertDialog = async () => { submitted += 1; };
    deps.handleEditorPanelAction = async () => { actionCalled += 1; };

    bindDocumentActionEvents({ state: {}, elements: {}, deps });

    // 一个元素同时处于两个容器内（理论上不会发生，但保证分支顺序）。
    const target = {
      dataset: { editorTableDialogAction: 'confirm', editorPanelAction: 'next' }
    };
    target.closest = makeClosest(
      new Map([
        ['[data-editor-table-dialog-action]', target],
        ['[data-editor-panel-action]', target]
      ])
    );

    listeners.get('click')[0]({ target });

    // 第一个分支短路：只 submit，不调用 panel action。
    assert.equal(submitted, 1);
    assert.equal(actionCalled, 0);
  });
});

// 串行执行所有测试用例（避免共享 globalThis 状态）。
(async () => {
  for (const run of tests) {
    await run();
  }
})();
