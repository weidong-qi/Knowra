import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readCssWithImports } from './helpers/read-css.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const editorContextMenuControllerJs = fs.readFileSync(path.resolve(__dirname, '../src/controllers/editor/context-menu-controller.js'), 'utf8');
const editorContextIconsJs = fs.readFileSync(path.resolve(__dirname, '../lib/editor/context-menu-icons.js'), 'utf8');
const componentsCss = readCssWithImports(path.resolve(__dirname, '../styles/components.css'));

assert.match(
  editorContextIconsJs,
  /function renderEditorContextIconSvg\(icon\)/,
  'V1.4.2 should keep a dedicated context icon renderer'
);
assert.match(
  editorContextIconsJs,
  /renderIcon\(CONTEXT_ICON_NAMES\[icon\]\s*\?\? 'editorQuestion'/,
  'context menu icons should resolve through the formal local icon mapping'
);
assert.doesNotMatch(
  editorContextIconsJs,
  /<svg|<path|📋|🗑|✂|⧉|❞|◯✓|⇤|⇥/,
  'context menu should not rely on inline paths, emoji, or mismatched text glyph icons'
);
assert.match(
  editorContextMenuControllerJs,
  /function syncEditorContextSubmenuLayout\(\)/,
  'submenu positioning should be synchronized through a dedicated layout pass'
);
assert.match(
  editorContextMenuControllerJs,
  /function syncEditorContextMenuPosition\(\)/,
  'context menu panel should reposition itself through a dedicated viewport-clamping pass'
);
assert.match(
  editorContextMenuControllerJs,
  /Math\.min\(Math\.max\(8,\s*state\.editorContextMenu\.x\)/,
  'context menu position should clamp horizontal placement inside the viewport'
);
assert.match(
  editorContextMenuControllerJs,
  /Math\.min\(Math\.max\(8,\s*state\.editorContextMenu\.y\)/,
  'context menu position should clamp vertical placement inside the viewport'
);
assert.match(
  editorContextMenuControllerJs,
  /submenuGroup\.dataset\.submenuSide\s*=/,
  'submenu layout should record left\/right placement decisions'
);
assert.match(
  editorContextMenuControllerJs,
  /submenuGroup\.dataset\.submenuAlign\s*=/,
  'submenu layout should record vertical alignment decisions when bottom space is limited'
);
assert.match(
  editorContextMenuControllerJs,
  /--submenu-offset-y/,
  'submenu layout should drive vertical offset through a CSS variable'
);

assert.match(
  componentsCss,
  /\.editor-context-submenu-group\[data-submenu-side='left'\]/,
  'submenu CSS should support flipping to the left when right-side space is insufficient'
);
assert.match(
  componentsCss,
  /\.editor-context-submenu\s*\{[\s\S]*max-height:/,
  'submenu CSS should cap height and allow scrolling instead of clipping'
);
assert.doesNotMatch(
  componentsCss,
  /left:\s*calc\(100%\s*\+\s*6px\);/,
  'submenu CSS should no longer hardcode a single rightward offset with a hover gap'
);

console.log('ok - V1.4.2 context menu polish hooks are present');
