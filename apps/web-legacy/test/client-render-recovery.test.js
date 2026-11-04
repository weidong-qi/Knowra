import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const clientJs = fs.readFileSync(path.resolve(__dirname, '../src/client.js'), 'utf8');
const shellControllerJs = fs.readFileSync(
  path.resolve(__dirname, '../src/controllers/shell-controller.js'),
  'utf8'
);

assert.match(
  shellControllerJs,
  /function safeRenderStep\(/,
  'client rendering should isolate failures to a single render step'
);
assert.match(
  shellControllerJs,
  /safeRenderStep\('navigation'/,
  'navigation rendering should not be allowed to stop editor and sidebar rendering'
);
assert.match(
  clientJs,
  /window\.addEventListener\('error'/,
  'runtime errors should be surfaced in the workspace status area'
);
const initializeBody = clientJs.match(/function initialize\(\) \{([\s\S]*?)\n\}/)?.[1] ?? '';
assert.match(
  initializeBody,
  /cacheElements\(\);[\s\S]*createControllers\(\);[\s\S]*bindEvents\(\);/,
  'client initialization should create controllers before binding events'
);
assert.match(
  initializeBody,
  /createControllers\(\);[\s\S]*startWorkspaceLoad\(\);/,
  'client initialization should create controllers before first render or data load'
);

console.log('ok - client render recovery hooks are present');
