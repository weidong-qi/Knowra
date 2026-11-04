import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const registrySource = fs.readFileSync(
  path.resolve(__dirname, '../../src/controllers/app-controller-registry.js'),
  'utf8'
);
const clientSource = fs.readFileSync(
  path.resolve(__dirname, '../../src/client.js'),
  'utf8'
);

assert.match(
  clientSource,
  /controllerActions:\s*actions/,
  'client should provide the shared lazy controller action port to the registry'
);
assert.match(
  registrySource,
  /createNote:\s*controllerActions\.createNote/,
  'editor-to-navigation calls should use the registered action port'
);
assert.match(
  registrySource,
  /insertAttachmentAtCursor:\s*controllerActions\.insertAttachmentAtCursor/,
  'navigation-to-editor calls should use the registered action port'
);
assert.doesNotMatch(
  registrySource,
  /let navigationController\s*=\s*null/,
  'controller assembly should not rely on a mutable circular controller closure'
);

console.log('ok - app controller registry resolves cross-controller calls through the action port');
