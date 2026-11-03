import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readCssWithImports } from './helpers/read-css.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const appStateJs = fs.readFileSync(path.resolve(__dirname, '../src/app/app-state.js'), 'utf8');
const viewCommandControllerJs = fs.readFileSync(path.resolve(__dirname, '../src/controllers/editor/commands/view-command-controller.js'), 'utf8');
const menuRenderersJs = fs.readFileSync(path.resolve(__dirname, '../lib/editor/menu-renderers.js'), 'utf8');
const previewRenderersJs = fs.readFileSync(path.resolve(__dirname, '../lib/editor/preview-renderers.js'), 'utf8');
const shellHtmlJs = fs.readFileSync(path.resolve(__dirname, '../src/server/shell-html.js'), 'utf8');
const componentsCss = readCssWithImports(path.resolve(__dirname, '../styles/components.css'));

assert.match(
  appStateJs,
  /view:\s*\{/,
  'workspace should store dedicated view state for task 5'
);
assert.match(
  menuRenderersJs,
  /function renderViewMenu/,
  'editor menu bar should render a view menu'
);
assert.match(
  menuRenderersJs,
  /data-view-menu-action=/,
  'view menu should expose actionable controls'
);
assert.match(
  menuRenderersJs,
  /data-editor-menu-toggle="view"/,
  'editor menu bar should expose a view menu toggle'
);
assert.match(
  previewRenderersJs,
  /class="markdown-input"/,
  'source editor view should render a markdown textarea'
);
assert.match(
  viewCommandControllerJs,
  /case 'toggle-source-editor':[\s\S]*state\.view\.mode !== 'focus'/,
  'source editor should remain available while focus mode controls layout'
);
assert.match(
  viewCommandControllerJs,
  /case 'mode-edit':[\s\S]*state\.view\.showSourceEditor = false;/,
  'switching back to edit mode should close the source editor'
);
assert.match(
  viewCommandControllerJs,
  /case 'mode-focus':[\s\S]*enterFocusMode\(\)/,
  'switching to focus mode should preserve the source editor preference'
);
assert.match(
  viewCommandControllerJs,
  /case 'toggle-focus':[\s\S]*exitFocusMode\(\)[\s\S]*enterFocusMode\(\)/,
  'the status-bar focus shortcut should restore the preceding read or edit mode'
);
assert.match(
  shellHtmlJs,
  /class="kb-sidebar knowra-rail" id="kb-sidebar"/,
  'left knowledge sidebar needs a stable DOM id for view toggles'
);
assert.match(
  shellHtmlJs,
  /class="kb-aside editor-inspector" id="kb-aside"/,
  'right assistant sidebar needs a stable DOM id for view toggles'
);
assert.match(
  componentsCss,
  /\.kb-workspace\[data-left-hidden='true'\]/,
  'workspace styles should support hiding the left sidebar'
);
assert.match(
  componentsCss,
  /data-right-hidden='true'/,
  'workspace styles should support hiding the right sidebar'
);
assert.match(
  componentsCss,
  /\.editor-content\[data-source-open='true'\]/,
  'source editor mode should define a dedicated split-layout style'
);
assert.match(
  componentsCss,
  /data-view-mode='focus'[\s\S]*\.milkdown-host \.ProseMirror[\s\S]*margin-inline:\s*auto/,
  'focus mode should center the bounded writing column'
);
assert.match(
  componentsCss,
  /data-screen='editor'\]\[data-view-mode='focus'\][\s\S]*\.top-bar[\s\S]*visibility:\s*hidden/,
  'focus mode should hide the top bar while leaving the status footer mounted'
);

console.log('ok - task 5 view menu UI hooks are present');
