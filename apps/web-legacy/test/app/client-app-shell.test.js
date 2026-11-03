import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const clientJs = fs.readFileSync(path.resolve(__dirname, '../../src/client.js'), 'utf8');

assert.match(
  clientJs,
  /const state = createInitialAppState\(\);/,
  'client should create app state through app-state module'
);
assert.match(
  clientJs,
  /const railItems = createRailItems\(\);/,
  'client should create rail items through app-state module'
);
assert.match(
  clientJs,
  /const editorRuntime = createEditorRuntime\(\);/,
  'client should create editor runtime through editor-runtime module'
);
assert.match(
  clientJs,
  /function cacheElements\(\) \{\s*assignWorkspaceElements\(elements\);\s*\}/,
  'client should delegate DOM element lookup to element-cache module'
);
assert.doesNotMatch(
  clientJs,
  /const state = \{\s*dataMode:/,
  'client should not inline the full initial state object'
);
assert.doesNotMatch(
  clientJs,
  /from '\.\.\/lib\//,
  'client should not import feature-level lib modules directly'
);

console.log('client app shell tests passed');
