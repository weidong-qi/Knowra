import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const milkdownEntrySource = fs.readFileSync(
  path.resolve(__dirname, '../lib/editor/milkdown-entry.js'),
  'utf8'
);
const markdownPasteSource = fs.readFileSync(
  path.resolve(__dirname, '../lib/editor/milkdown/host/markdown-paste-controller.js'),
  'utf8'
);

assert.match(
  milkdownEntrySource,
  /import\s*\{\s*attachSelectionMemory,\s*restoreLastSelection\s*\}\s*from '.\/milkdown\/host\/selection-memory-controller\.js';/,
  'MilkdownHost should load the shared selection memory helpers'
);

assert.match(
  milkdownEntrySource,
  /this\.lastSelectionRange = null;[\s\S]*this\.detachSelectionMemory = null;/,
  'MilkdownHost should track selection memory state on the host instance'
);

assert.match(
  milkdownEntrySource,
  /this\.attachTableHandleController\(\);[\s\S]*this\.attachSelectionMemory\(\);/,
  'MilkdownHost mount should register selection memory after the editor is created'
);

assert.match(
  milkdownEntrySource,
  /async focus\(\) \{[\s\S]*if \(restoreLastSelection\(this\)\) \{[\s\S]*return;[\s\S]*\}[\s\S]*view\.focus\(\);[\s\S]*\}/,
  'MilkdownHost focus should restore the last editor selection before falling back to plain focus'
);

assert.match(
  markdownPasteSource,
  /if \(typeof view\.hasFocus === 'function' && !view\.hasFocus\(\)\) \{[\s\S]*restoreLastSelection\(host\);[\s\S]*\}/,
  'markdown paste should restore the last known editor selection when the editor is currently blurred'
);

assert.match(
  markdownPasteSource,
  /view\.dispatch\(view\.state\.tr\.replaceSelection\(slice\)\.scrollIntoView\(\)\);[\s\S]*rememberCurrentSelection\(host\);/,
  'markdown paste should refresh the remembered selection after inserting content'
);

console.log('editor selection memory source tests passed');
