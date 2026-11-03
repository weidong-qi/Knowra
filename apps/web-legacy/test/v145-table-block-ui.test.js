import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readCssWithImports } from './helpers/read-css.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const clientJs = fs.readFileSync(path.resolve(__dirname, '../src/client.js'), 'utf8');
const tableDialogControllerJs = fs.readFileSync(path.resolve(__dirname, '../src/controllers/editor/panel/table-dialog-controller.js'), 'utf8');
const menuRenderersJs = fs.readFileSync(path.resolve(__dirname, '../lib/editor/menu-renderers.js'), 'utf8');
const editorContextModelJs = fs.readFileSync(path.resolve(__dirname, '../lib/editor/context-menu-model.js'), 'utf8');
const milkdownEntry = fs.readFileSync(path.resolve(__dirname, '../lib/editor/milkdown-entry.js'), 'utf8');
const tableButtonsJs = fs.readFileSync(path.resolve(__dirname, '../lib/editor/milkdown/table/table-buttons.js'), 'utf8');
const commandResolversJs = fs.readFileSync(path.resolve(__dirname, '../lib/editor/milkdown/commands/command-resolvers.js'), 'utf8');
const tableDimensionsJs = fs.readFileSync(path.resolve(__dirname, '../lib/editor/milkdown/table/table-dimensions.js'), 'utf8');
const tableDocumentJs = fs.readFileSync(path.resolve(__dirname, '../lib/editor/milkdown/table/table-document.js'), 'utf8');
const tableHandleControllerJs = fs.readFileSync(path.resolve(__dirname, '../lib/editor/milkdown/table/table-handle-controller.js'), 'utf8');
const tableHandleEventsJs = fs.readFileSync(path.resolve(__dirname, '../lib/editor/milkdown/table/table-handle-events.js'), 'utf8');
const tablePinnedActionsJs = fs.readFileSync(path.resolve(__dirname, '../lib/editor/milkdown/table/table-pinned-actions.js'), 'utf8');
const tablePinnedMenuRecoveryJs = fs.readFileSync(path.resolve(__dirname, '../lib/editor/milkdown/table/table-pinned-menu-recovery.js'), 'utf8');
const tablePinnedStateJs = fs.readFileSync(path.resolve(__dirname, '../lib/editor/milkdown/table/table-pinned-state.js'), 'utf8');
const editorFactoryJs = fs.readFileSync(path.resolve(__dirname, '../lib/editor/milkdown/host/editor-factory.js'), 'utf8');
const milkdownTableCss = fs.readFileSync(path.resolve(__dirname, '../styles/components/milkdown-table.css'), 'utf8');
const componentsCss = readCssWithImports(path.resolve(__dirname, '../styles/components.css'));
const milkdownTableJs = [
  editorFactoryJs,
  commandResolversJs,
  tableButtonsJs,
  tableDimensionsJs,
  tableDocumentJs,
  tableHandleControllerJs,
  tableHandleEventsJs,
  tablePinnedActionsJs,
  tablePinnedMenuRecoveryJs,
  tablePinnedStateJs
].join('\n');

assert.match(
  menuRenderersJs,
  /const PARAGRAPH_MENU_ITEMS = \[[\s\S]*\{ key: 'table', label: '表格' \}[\s\S]*\];/,
  'format menu should expose a table insertion entry'
);

assert.match(
  editorContextModelJs,
  /EDITOR_CONTEXT_INSERT_ITEMS = \[[\s\S]*'table'[\s\S]*\];/,
  'context menu insert submenu should expose table insertion'
);

assert.match(
  editorContextModelJs,
  /table: \{ label: '表格'(?:, icon: 'table')? \}/,
  'table insertion should have a localized menu label'
);

assert.match(
  `${clientJs}\n${tableDialogControllerJs}`,
  /editorTableDialog|renderTableInsertDialog|data-editor-table-dialog-action/,
  'editor UI should provide an in-app table insert dialog instead of relying on browser prompts'
);

assert.match(
  editorFactoryJs,
  /import\s*\{[^}]*tableBlock[^}]*tableBlockConfig[^}]*\}\s*from '@milkdown\/kit\/component\/table-block';|import\s*\{[^}]*tableBlockConfig[^}]*tableBlock[^}]*\}\s*from '@milkdown\/kit\/component\/table-block';/,
  'editor host should import the official Milkdown table block component'
);

assert.match(
  editorFactoryJs,
  /\.use\(tableBlock\)/,
  'editor host should register the Milkdown table block component'
);

assert.match(
  milkdownTableJs,
  /addRowAfterCommand|addRowBeforeCommand|addColAfterCommand|addColBeforeCommand|deleteSelectedCellsCommand|setAlignCommand|selectRowCommand|selectColCommand/,
  'editor host should import table operation commands for row, column, delete, and alignment actions'
);

assert.match(
  milkdownTableJs,
  /table:\s*\([^)]*\)\s*=>\s*\(\{\s*key:\s*insertTableCommand\.key,[\s\S]*?payload:\s*\{[\s\S]*?row:[\s\S]*?col:[\s\S]*?\}\s*\}\)/,
  'table insertion command should accept custom row and column counts'
);

assert.match(
  milkdownTableJs,
  /function syncTableHandleLabels\(|setAttribute\('title', '删除列'\)|setAttribute\('title', '删除行'\)/,
  'table handles should expose clear labels for add and delete actions'
);

assert.match(
  milkdownTableJs,
  /class TableHandleController|pinCell\(|clearPinnedTable\(|attachTableHandleController\(|syncPinnedHandleFromSelection\(|findCellFromCurrentSelection\(|openMenuKind|applyPinnedMenuState\(/,
  'editor host should keep row and column handles pinned after a cell is selected'
);

assert.match(
  milkdownTableJs,
  /schedulePinnedMenuRecovery\(|clearPinnedMenuRecovery\(|menuRecoveryTimer|menuRecoveryKind/,
  'table handle controller should keep reopening the pinned handle menu until Milkdown finishes replacing transient handle DOM'
);

assert.match(
  milkdownTableJs,
  /tryRebindPinnedCell\(controller\)[\s\S]*findCellFromCurrentSelection\(controller\)[\s\S]*pinCell\(controller, reboundCell\)|if \(!\(tableBlock instanceof HTMLElement\) \|\| !\(table instanceof HTMLTableElement\) \|\| !tableBlock\.isConnected \|\| !table\.isConnected\)[\s\S]*tryRebindPinnedCell\(controller\)/,
  'pinned table handles should rebind to the freshly rendered table DOM after Milkdown replaces the selected table block'
);

assert.match(
  milkdownTableJs,
  /table-add-row-before|table-add-row-after|table-add-col-before|table-add-col-after/,
  'table handle menus should expose add-row and add-column actions directly'
);

assert.match(
  milkdownTableJs,
  /table-delete-row|table-delete-col|deleteSelectedCellsCommand/,
  'table handle menus should expose explicit delete-row and delete-column actions'
);

assert.match(
  milkdownTableJs,
  /handleRootPointerOver|handleRootPointerOut|hoverMenuKind|data-pinned-menu-visible/,
  'table handle controller should preserve the active menu while the pointer moves between the handle and its popup'
);
assert.match(
  milkdownTableJs,
  /TABLE_POINTER_GRACE_MS|pointerGraceTimer|clearTablePointerGrace[\s\S]*setTimeout/,
  'table handle menus should keep a short pointer grace period while crossing the handle-to-popup gap'
);

assert.match(
  milkdownTableJs,
  /handleDocumentPointerDown[\s\S]*button-group button[\s\S]*return|data-table-pinned-action[\s\S]*return/,
  'table handle controller should not toggle or swallow events when a pinned menu button itself is being clicked'
);

assert.match(
  milkdownTableJs,
  /ensureTableHasHeaderRowAtPos|table_header_row|table_header[\s\S]*table_row/,
  'table row and column deletes should repair the table header row when the first row is downgraded into plain cells'
);

assert.match(
  milkdownTableJs,
  /updatePinnedActionAvailability|setPinnedActionDisabled|table-add-row-before|table-delete-row/,
  'row handle actions should be able to enter a disabled state for the header row and the final remaining data row'
);

assert.doesNotMatch(
  milkdownTableJs,
  /col_drag_handle[\s\S]*?<circle[\s\S]*?row_drag_handle[\s\S]*?<circle/s,
  'drag handles should not rely on invisible circle-only icons'
);

assert.match(
  componentsCss,
  /\.milkdown-host \.ProseMirror table/,
  'editor styles should render visible table borders in the Milkdown editing surface'
);

assert.match(
  componentsCss,
  /\.milkdown-table-block|\.table-wrapper|\.line-handle|\.cell-handle/,
  'editor styles should include table-block interaction affordances'
);

assert.match(
  componentsCss,
  /\[data-role='x-line-drag-handle'\][\s\S]*display:\s*none/,
  'legacy floating row-add handle should be removed once row actions move into the side handle menu'
);

assert.match(
  componentsCss,
  /\[data-role='y-line-drag-handle'\][\s\S]*display:\s*none/,
  'legacy floating column-add handle should be removed once column actions move into the top handle menu'
);

assert.match(
  componentsCss,
  /\.milkdown-table-block \.semantic-icon/,
  'table block controls should style their local semantic icons so the handles remain visible'
);

assert.match(
  componentsCss,
  /\[data-pinned='true'\][\s\S]*row-drag-handle|col-drag-handle/,
  'pinned tables should keep row and column handles visible even after leaving the cell area'
);

assert.match(
  componentsCss,
  /\[data-role='row-drag-handle'\]\s+\.button-group[\s\S]*left:\s*calc\(100%\s*\+\s*(?:8px|var\(--space-2\))\)|left:\s*100%/,
  'row handle menu should expand to the visible right side instead of getting clipped on the left'
);

assert.match(
  componentsCss,
  /\[data-role='col-drag-handle'\]\s+\.button-group[\s\S]*top:\s*calc\(100%\s*\+\s*(?:8px|var\(--space-2\))\)|top:\s*100%/,
  'column handle menu should drop below the top handle so inserted actions remain visible'
);

assert.match(
  componentsCss,
  /data-pinned-menu-visible='row'[\s\S]*data-pinned-menu-visible='col'[\s\S]*pointer-events:\s*auto\s*!important/s,
  'pinned menu visibility should override transient Milkdown hide states for both row and column popups'
);

assert.match(
  componentsCss,
  /button\[disabled\][\s\S]*cursor:\s*not-allowed[\s\S]*opacity:\s*0\./s,
  'disabled table handle actions should look inactive and non-clickable'
);

assert.match(
  milkdownTableCss,
  /\.cell-handle[\s\S]*border-radius:\s*var\(--radius-none\)/,
  'table handles should use the square editorial control shape'
);

assert.match(
  milkdownTableCss,
  /\.button-group[\s\S]*border-top:\s*var\(--border-accent\)\s+solid\s+var\(--blue\)/,
  'table operation menus should carry the current blue editorial accent'
);

assert.match(
  milkdownTableCss,
  /\.button-group[\s\S]*box-shadow:\s*var\(--shadow-editorial\)/,
  'table operation menus should use the shared editorial shadow token'
);
assert.match(
  milkdownTableCss,
  /row-drag-handle'\]::after[\s\S]*col-drag-handle'\]::after[\s\S]*content:\s*''/,
  'row and column handles should provide a transparent hover bridge toward their popup'
);

assert.doesNotMatch(
  milkdownTableCss,
  /rgba\(60,\s*104,\s*255|#4d5d79|#1d4ed8|#c2410c/,
  'table operation styles should not keep the old blue-gray hardcoded palette'
);

console.log('ok - table block insertion and editing hooks are present');
