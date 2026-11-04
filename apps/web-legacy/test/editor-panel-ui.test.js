import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readCssWithImports } from './helpers/read-css.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const clientJs = fs.readFileSync(path.resolve(__dirname, '../src/client.js'), 'utf8');
const editorPanelControllerJs = fs.readFileSync(path.resolve(__dirname, '../src/controllers/editor/panel-controller.js'), 'utf8');
const tableDialogControllerJs = fs.readFileSync(path.resolve(__dirname, '../src/controllers/editor/panel/table-dialog-controller.js'), 'utf8');
const menuRenderersJs = fs.readFileSync(path.resolve(__dirname, '../lib/editor/menu-renderers.js'), 'utf8');
const documentKeyboardEventsJs = fs.readFileSync(
  path.resolve(__dirname, '../lib/events/document-keyboard-events.js'),
  'utf8'
);
const milkdownEntry = fs.readFileSync(path.resolve(__dirname, '../lib/editor/milkdown-entry.js'), 'utf8');
const commandResolversJs = fs.readFileSync(path.resolve(__dirname, '../lib/editor/milkdown/commands/command-resolvers.js'), 'utf8');
const componentsCss = readCssWithImports(path.resolve(__dirname, '../styles/components.css'));
const milkdownContentCss = fs.readFileSync(path.resolve(__dirname, '../styles/components/milkdown-content.css'), 'utf8');
const milkdownCodeBlockCss = fs.readFileSync(
  path.resolve(__dirname, '../styles/components/milkdown-code-block.css'),
  'utf8'
);
const knowraEditorCss = fs.readFileSync(path.resolve(__dirname, '../styles/components/knowra-inkgrid-editor.css'), 'utf8');
const knowraThemeTokensCss = fs.readFileSync(
  path.resolve(__dirname, '../styles/components/knowra-theme-tokens.css'),
  'utf8'
);

assert.doesNotMatch(clientJs, /window\.prompt\(/, 'editor find/replace must not use browser prompt dialogs');
assert.doesNotMatch(clientJs, /window\.find\(/, 'editor find must use the in-app search panel instead of browser find');
assert.match(
  editorPanelControllerJs,
  /editor-utility-panel/,
  'editor should render a custom in-app utility panel for find and replace'
);
assert.match(
  editorPanelControllerJs,
  /submit-previous/,
  'editor find panel should expose an explicit previous-match action'
);
assert.match(
  tableDialogControllerJs,
  /renderTableInsertDialog/,
  'table insertion dialog should live in the table dialog controller'
);
assert.doesNotMatch(
  editorPanelControllerJs,
  /normalizeTableDialogValue/,
  'editor panel controller should not own table dialog input normalization'
);
assert.match(
  menuRenderersJs,
  /function renderFormatMenu/,
  'editor format menu should provide a render function for the popover content'
);
assert.match(
  menuRenderersJs,
  /actionAttr: 'data-format-menu-action'/,
  'editor format menu should render actionable format menu items'
);

const formatButtonsMatch = menuRenderersJs.match(/const FORMAT_MENU_ITEMS = \[([\s\S]*?)\];/);
assert.ok(formatButtonsMatch, 'editor format button definitions should exist');
assert.doesNotMatch(
  formatButtonsMatch[1],
  /heading-1|heading-2|heading-3|codeblock|label: 'H1'|label: 'H2'|label: 'H3'/,
  'editor format menu should not duplicate heading or code block entries that belong elsewhere'
);
assert.match(
  formatButtonsMatch[1],
  /label: '加粗'[\s\S]*label: '斜体'[\s\S]*label: '删除线'[\s\S]*label: '行内代码'[\s\S]*label: '高亮'/,
  'editor format menu should use Chinese labels and expose a highlight action'
);
assert.match(
  menuRenderersJs,
  /const PARAGRAPH_MENU_ITEMS = \[[\s\S]*label: 'H1'[\s\S]*label: 'H2'[\s\S]*label: 'H3'[\s\S]*label: 'H4'/,
  'editor paragraph menu should use the H1-H4 heading labels'
);
assert.doesNotMatch(menuRenderersJs, /label: 'H5'|label: 'H6'/, 'editor paragraph menu should remove H5 and H6');
assert.match(
  documentKeyboardEventsJs,
  /documentRef\.addEventListener\('keydown', \(event\) => \{[\s\S]*resolveEditorPanelKeyboardAction\(event\)[\s\S]*\}, true\);/,
  'editor find keyboard shortcuts should intercept Enter during capture so the editor cannot consume it first'
);
assert.match(
  componentsCss,
  /\.editor-utility-panel/,
  'custom editor utility panel needs dedicated styling'
);
assert.match(
  componentsCss,
  /\.editor-find-match-active/,
  'active find matches should have a dedicated highlight style'
);
assert.match(
  menuRenderersJs,
  /label: '内部链接'/,
  'editor format menu should expose an internal link action'
);
assert.match(
  commandResolversJs,
  /'internal-link': \(\) => \(\{ key: insertInternalLinkCommand\.key \}\)/,
  'milkdown command resolver should expose an internal link command'
);
assert.match(
  milkdownCodeBlockCss,
  /\.milkdown-host \.milkdown-code-block \{/,
  'code block styles should exist in the shared editor stylesheet'
);
assert.doesNotMatch(
  milkdownCodeBlockCss,
  /\.milkdown-host \.milkdown-code-block \{[\s\S]*background:\s*#10182b/,
  'code blocks should no longer use the legacy black background'
);
assert.match(
  milkdownCodeBlockCss,
  /\.milkdown-host \.milkdown-code-block \{[\s\S]*background:\s*var\(--code-surface\)/,
  'the production editor should use the shared code surface token'
);
assert.match(
  knowraEditorCss,
  /\.editor-workspace \.milkdown-host \.ProseMirror blockquote,[\s\S]*background:\s*var\(--blue-wash\)/,
  'blockquote should use a blue wash to read as an editorial annotation'
);
assert.match(
  milkdownCodeBlockCss,
  /\.milkdown-host \.milkdown-code-block \{[\s\S]*border-top:\s*var\(--border-accent\) solid var\(--blue\)/,
  'code blocks should use a blue top accent instead of the quote left rule'
);
assert.match(
  milkdownCodeBlockCss,
  /\.milkdown-host \.milkdown-code-block \{[\s\S]*box-shadow:\s*var\(--shadow-editorial\)/,
  'code blocks should use the technical panel shadow from the current UI'
);
assert.match(
  knowraThemeTokensCss,
  /--code-surface:\s*var\(--paper-raised\);[\s\S]*--code-text:\s*var\(--ink\);/,
  'the code surface should remain a light paper surface rather than a black fill'
);
assert.match(
  milkdownContentCss,
  /\.milkdown-host \.ProseMirror code \{[\s\S]*border:/,
  'inline code should restore a dedicated bordered visual treatment'
);

console.log('ok - editor utility panel uses in-app UI instead of browser prompts');
