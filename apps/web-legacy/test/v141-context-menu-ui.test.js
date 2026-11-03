import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readCssWithImports } from './helpers/read-css.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const clientJs = fs.readFileSync(path.resolve(__dirname, '../src/client.js'), 'utf8');
const editorContextMenuControllerJs = fs.readFileSync(path.resolve(__dirname, '../src/controllers/editor/context-menu-controller.js'), 'utf8');
const shellHtmlJs = fs.readFileSync(path.resolve(__dirname, '../src/server/shell-html.js'), 'utf8');
const componentsCss = readCssWithImports(path.resolve(__dirname, '../styles/components.css'));
const milkdownEntry = fs.readFileSync(path.resolve(__dirname, '../lib/editor/milkdown-entry.js'), 'utf8');
const sidebarInfoPanelJs = fs.readFileSync(path.resolve(__dirname, '../lib/sidebar/info-panel.js'), 'utf8');
const editorContextModelJs = fs.readFileSync(path.resolve(__dirname, '../lib/editor/context-menu-model.js'), 'utf8');
const editorContentEventsJs = fs.readFileSync(
  path.resolve(__dirname, '../lib/events/editor-content-events.js'),
  'utf8'
);

assert.match(
  sidebarInfoPanelJs,
  /stats\.characterCount/,
  'info tab should only show a single character-count row in V1.4.1'
);
assert.doesNotMatch(
  sidebarInfoPanelJs,
  /paragraphCount|headingCount/,
  'info tab should no longer show paragraph and heading counts'
);

assert.match(
  shellHtmlJs,
  /id="editor-context-menu"/,
  'workspace shell should expose a dedicated editor context menu mount'
);
assert.match(
  editorContentEventsJs,
  /elements\.editorContent\?\.addEventListener\('contextmenu'/,
  'editor surface should intercept right-clicks to open the custom quick menu'
);
assert.match(
  editorContextModelJs,
  /EDITOR_CONTEXT_PRIMARY_ACTIONS = \[[\s\S]*cut[\s\S]*copy[\s\S]*paste[\s\S]*delete[\s\S]*\];/,
  'context menu should define the four primary actions at the top'
);
assert.match(
  editorContextModelJs,
  /EDITOR_CONTEXT_FORMAT_ACTIONS = \[[\s\S]*bold[\s\S]*italic[\s\S]*code[\s\S]*quote[\s\S]*\];/,
  'context menu should include inline-code in the quick formatting actions'
);
assert.match(
  editorContextModelJs,
  /EDITOR_CONTEXT_LIST_ACTIONS = \[[\s\S]*ordered[\s\S]*bullet[\s\S]*task-list[\s\S]*\];/,
  'context menu should expose ordered, bullet, and task list actions'
);
assert.match(
  editorContextModelJs,
  /EDITOR_CONTEXT_INDENT_ACTIONS = \[[\s\S]*outdent[\s\S]*indent[\s\S]*\];/,
  'context menu should expose outdent and indent actions'
);
assert.match(
  editorContextModelJs,
  /EDITOR_CONTEXT_PARAGRAPH_ITEMS = \[[\s\S]*paragraph[\s\S]*heading-1[\s\S]*heading-2[\s\S]*heading-3[\s\S]*heading-4[\s\S]*\];/,
  'paragraph submenu should expose H0-H4 entries'
);
assert.doesNotMatch(editorContextModelJs, /'heading-5'|'heading-6'/, 'context menus should remove H5 and H6');
assert.match(
  editorContextModelJs,
  /EDITOR_CONTEXT_INSERT_ITEMS = \[[\s\S]*hr[\s\S]*image[\s\S]*codeblock[\s\S]*quote[\s\S]*paragraph-above[\s\S]*paragraph-below[\s\S]*\];/,
  'insert submenu should expose image, divider, code block, quote, and paragraph insertion actions'
);
assert.match(
  editorContextMenuControllerJs,
  /function renderEditorContextMenu\(\)/,
  'context menu should render through a dedicated function'
);
assert.match(
  componentsCss,
  /\.editor-context-menu[\s\S]*position:\s*fixed;/,
  'context menu should use fixed positioning near the cursor'
);
assert.match(
  componentsCss,
  /\.editor-context-submenu/,
  'context menu should provide dedicated submenu styling'
);
assert.match(
  milkdownEntry,
  /if \(commandKey === 'paragraph-above'\)/,
  'editor host should understand paragraph-above insertions'
);
assert.match(
  milkdownEntry,
  /if \(commandKey === 'paragraph-below'\)/,
  'editor host should understand paragraph-below insertions'
);

console.log('ok - V1.4.1 context menu hooks are present');
