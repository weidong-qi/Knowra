import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ─── 源模式断言（compile-time contract）──────────────────────────

const binderSource = fs.readFileSync(
  path.resolve(__dirname, '../../lib/events/window-events.js'),
  'utf8'
);

assert.match(
  binderSource,
  /export function bindWindowEvents/,
  'window-events.js should export bindWindowEvents'
);
assert.match(
  binderSource,
  /window\.addEventListener\('beforeunload'/,
  'window binder should listen to window beforeunload'
);

// ─── Handler-recorder 断言（behavioral）──────────────────────────

function runTest(name, callback) {
  try {
    const result = callback();
    if (result && typeof result.then === 'function') {
      return result.then(
        () => console.log(`ok - ${name}`),
        (error) => {
          console.error(`not ok - ${name}`);
          throw error;
        }
      );
    }
    console.log(`ok - ${name}`);
  } catch (error) {
    console.error(`not ok - ${name}`);
    throw error;
  }
}

// 在 handler 执行期间挂上 mock window，等 handler 的 promise
// resolve 后再恢复，避免 finally 提前把 mock 清掉。
async function withMockWindow(handler) {
  const originalWindow = globalThis.window;
  const listeners = new Map();
  globalThis.window = {
    ...(originalWindow ?? {}),
    addEventListener(type, fn) {
      listeners.set(type, fn);
    }
  };

  try {
    return await handler(listeners);
  } finally {
    if (originalWindow === undefined) {
      delete globalThis.window;
    } else {
      globalThis.window = originalWindow;
    }
  }
}

runTest('beforeunload persists scroll positions', async () => {
  let saved = 0;
  let persisted = 0;
  const deps = {
    saveCurrentEditorScrollPosition: () => { saved += 1; },
    persistScrollPositions: () => { persisted += 1; }
  };

  await withMockWindow(async (listeners) => {
    const { bindWindowEvents } = await import(
      '../../lib/events/window-events.js'
    );
    bindWindowEvents({ state: {}, elements: {}, deps });

    const handler = listeners.get('beforeunload');
    assert.ok(handler, 'beforeunload handler should be registered');
    handler({});

    assert.equal(saved, 1);
    assert.equal(persisted, 1);
  });
});
