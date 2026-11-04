import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readCssWithImports } from './helpers/read-css.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const componentsCss = readCssWithImports(path.resolve(__dirname, '../styles/components.css'));
const shellControllerJs = fs.readFileSync(
  path.resolve(__dirname, '../src/controllers/shell-controller.js'),
  'utf8'
);
const viewStateJs = fs.readFileSync(path.resolve(__dirname, '../lib/shell/view-state.js'), 'utf8');

assert.match(
  shellControllerJs,
  /elements\.workspace\.dataset\.leftHidden = String\(!effectiveView\.showLeftSidebar\);/,
  'workspace view state should expose left-sidebar visibility as a data attribute'
);
assert.match(
  shellControllerJs,
  /elements\.workspace\.dataset\.rightHidden = String\(!effectiveView\.showRightSidebar\);/,
  'workspace view state should expose right-sidebar visibility as a data attribute'
);
assert.match(
  shellControllerJs,
  /elements\.sidebar\.hidden = !showLibraryDirectory;/,
  'workspace view state should keep the Materials directory separate from the global function navigation'
);
assert.match(
  shellControllerJs,
  /elements\.aside\.hidden = isHome \|\| isIndex \|\| !effectiveView\.showRightSidebar;/,
  'workspace view state should hide the editor marginalia on the home/index screen or when toggled off'
);

assert.match(
  componentsCss,
  /@media \(max-width: 1320px\)[\s\S]*\.kb-workspace\[data-left-hidden='true'\]\[data-right-hidden='false'\][\s\S]*grid-template-columns: minmax\(0, 1fr\);/,
  'tablet breakpoint should collapse to a single editor column when the left sidebar is hidden and the right rail is already absent'
);
assert.match(
  componentsCss,
  /@media \(max-width: 1320px\)[\s\S]*\.kb-workspace\[data-left-hidden='true'\]\[data-right-hidden='true'\][\s\S]*grid-template-columns: minmax\(0, 1fr\);/,
  'tablet breakpoint should keep focus mode as a single editor column'
);
assert.match(
  componentsCss,
  /\.kb-sidebar\[hidden\],\s*\.kb-aside\[hidden\]\s*\{[\s\S]*display:\s*none\s*!important;/,
  'sidebar hidden state must beat the base flex layout so hidden panels truly disappear'
);
assert.match(
  viewStateJs,
  /view\.mode === 'focus' \? false : view\.showLeftSidebar/,
  'focus mode should force the left sidebar off through the effective view state'
);
assert.match(
  viewStateJs,
  /view\.mode === 'focus' \? false : view\.showRightSidebar/,
  'focus mode should force the right sidebar off through the effective view state'
);

console.log('ok - workspace layout state hooks are present');
