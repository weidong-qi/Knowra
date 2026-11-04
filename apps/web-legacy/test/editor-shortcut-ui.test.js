import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readCssWithImports } from './helpers/read-css.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const shortcutCommandControllerJs = fs.readFileSync(path.resolve(__dirname, '../src/controllers/editor/commands/shortcut-controller.js'), 'utf8');
const menuRenderersJs = fs.readFileSync(path.resolve(__dirname, '../lib/editor/menu-renderers.js'), 'utf8');
const documentKeyboardEventsJs = fs.readFileSync(
  path.resolve(__dirname, '../lib/events/document-keyboard-events.js'),
  'utf8'
);
const milkdownEntry = fs.readFileSync(path.resolve(__dirname, '../lib/editor/milkdown-entry.js'), 'utf8');
const commandResolversJs = fs.readFileSync(path.resolve(__dirname, '../lib/editor/milkdown/commands/command-resolvers.js'), 'utf8');
const shortcutHandlersJs = fs.readFileSync(path.resolve(__dirname, '../lib/editor/milkdown/commands/shortcut-handlers.js'), 'utf8');
const indentationHandlersJs = fs.readFileSync(path.resolve(__dirname, '../lib/editor/milkdown/commands/indentation-handlers.js'), 'utf8');
const componentsCss = readCssWithImports(path.resolve(__dirname, '../styles/components.css'));

assert.match(
  menuRenderersJs,
  /const PARAGRAPH_MENU_ITEMS = \[[\s\S]*label: '正文'[\s\S]*label: 'H1'[\s\S]*label: 'H2'[\s\S]*label: 'H3'[\s\S]*label: 'H4'/,
  'paragraph menu should expose the supported 正文+H1-H4 hierarchy'
);
assert.doesNotMatch(menuRenderersJs, /label: 'H5'|label: 'H6'/, 'H5 and H6 should not remain in the paragraph menu');
assert.match(
  menuRenderersJs,
  /label: '内部链接'/,
  'format menu should render readable Chinese labels instead of mojibake'
);
assert.match(
  menuRenderersJs,
  /editor-menu-shortcut/,
  'editor menus should render a dedicated shortcut label slot'
);
assert.doesNotMatch(
  menuRenderersJs,
  /FORMAT_QUICK_ACTIONS|data-format-quick-action|editor-format-quick-actions/,
  'editor menu bar should no longer render the removed top-right quick action buttons'
);
assert.match(
  documentKeyboardEventsJs,
  /resolveEditorShortcutAction\(event\)/,
  'editor should resolve custom keyboard shortcuts from the shared shortcut helper'
);
assert.match(
  shortcutCommandControllerJs,
  /function handleResolvedEditorShortcut\(action\)/,
  'editor should route resolved shortcuts through a dedicated action handler'
);
assert.match(
  shortcutCommandControllerJs,
  /editorRuntime\.currentEditorHost\.run\(action\)/,
  'resolved shortcuts should be executed through the editor host command system'
);
assert.match(
  commandResolversJs,
  /'paragraph': \(\) => \(\{ key: turnIntoTextCommand\.key \}\)/,
  'editor command resolver should support H0/paragraph shortcuts'
);
assert.doesNotMatch(
  commandResolversJs,
  /'heading-5':|'heading-6':/,
  'editor command resolver should not expose removed H5 or H6 actions'
);
assert.match(
  indentationHandlersJs,
  /sinkListItemCommand\.key/,
  'editor shortcut execution should support Tab-based list indentation'
);
assert.match(
  indentationHandlersJs,
  /liftListItemCommand\.key/,
  'editor shortcut execution should support Shift\+Tab outdent and list toggle removal'
);
assert.match(
  shortcutHandlersJs,
  /from '.\/indentation-handlers\.js'/,
  'shortcut handlers should delegate indentation shortcuts to the dedicated indentation module'
);
assert.match(
  componentsCss,
  /\.editor-menu-shortcut/,
  'shortcut labels need dedicated menu styling'
);
assert.match(
  menuRenderersJs,
  /const FORMAT_MENU_ITEMS = \[[\s\S]*key: 'code'[\s\S]*label: '行内代码'/,
  'inline code should stay in the format dropdown'
);
assert.match(
  menuRenderersJs,
  /const PARAGRAPH_MENU_ITEMS = \[[\s\S]*key: 'codeblock'[\s\S]*label: '代码块'/,
  'code blocks should stay in the paragraph dropdown'
);

console.log('ok - editor shortcut UI hooks are present');
