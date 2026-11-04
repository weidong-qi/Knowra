import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const editCommandControllerJs = fs.readFileSync(path.resolve(__dirname, '../src/controllers/editor/commands/edit-command-controller.js'), 'utf8');
const milkdownEntry = fs.readFileSync(path.resolve(__dirname, '../lib/editor/milkdown-entry.js'), 'utf8');
const editorFactoryJs = fs.readFileSync(path.resolve(__dirname, '../lib/editor/milkdown/host/editor-factory.js'), 'utf8');
const commandResolversJs = fs.readFileSync(path.resolve(__dirname, '../lib/editor/milkdown/commands/command-resolvers.js'), 'utf8');
const milkdownHistoryJs = `${milkdownEntry}\n${editorFactoryJs}\n${commandResolversJs}`;

assert.match(
  milkdownHistoryJs,
  /import\s*\{[^}]*history[^}]*\}\s*from '@milkdown\/kit\/plugin\/history';[\s\S]*import\s*\{[^}]*redoCommand[^}]*undoCommand[^}]*\}\s*from '@milkdown\/kit\/plugin\/history';|import\s*\{[^}]*history[^}]*\}\s*from '@milkdown\/kit\/plugin\/history';[\s\S]*import\s*\{[^}]*undoCommand[^}]*redoCommand[^}]*\}\s*from '@milkdown\/kit\/plugin\/history';/,
  'milkdown editor should import history support and undo/redo commands'
);
assert.match(
  milkdownHistoryJs,
  /\.use\(history\)/,
  'milkdown editor should enable the history plugin so format and paste transactions can be undone'
);
assert.match(
  commandResolversJs,
  /undo:\s*\(\)\s*=>\s*\(\{\s*key:\s*undoCommand\.key\s*\}\)/,
  'editor command resolver should expose undo through Milkdown history'
);
assert.match(
  commandResolversJs,
  /redo:\s*\(\)\s*=>\s*\(\{\s*key:\s*redoCommand\.key\s*\}\)/,
  'editor command resolver should expose redo through Milkdown history'
);
assert.match(
  editCommandControllerJs,
  /case 'undo':[\s\S]*await editorHost\.run\(action\);/,
  'edit menu undo should delegate to the editor host history instead of browser execCommand'
);
assert.match(
  editCommandControllerJs,
  /case 'redo':[\s\S]*await editorHost\.run\(action\);/,
  'edit menu redo should delegate to the editor host history instead of browser execCommand'
);
assert.doesNotMatch(
  editCommandControllerJs,
  /case 'undo':[\s\S]*document\.execCommand\(/,
  'undo should not use browser execCommand'
);
assert.doesNotMatch(
  editCommandControllerJs,
  /case 'redo':[\s\S]*document\.execCommand\(/,
  'redo should not use browser execCommand'
);

console.log('ok - editor undo/redo routes through Milkdown history');
