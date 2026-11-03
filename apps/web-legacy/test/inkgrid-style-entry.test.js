import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const stylesRoot = path.resolve(__dirname, '../styles');
const entryFile = path.resolve(stylesRoot, 'components.css');
const inkgridEntry = path.resolve(stylesRoot, 'components/knowra-inkgrid.css');
const responsibilityModules = [
  'knowra-inkgrid-shell.css',
  'knowra-inkgrid-navigation.css',
  'knowra-inkgrid-library-index.css',
  'knowra-inkgrid-editor.css',
  'knowra-inkgrid-editor-paper.css',
  'knowra-inkgrid-menus.css',
  'knowra-inkgrid-typography.css'
].map((name) => path.resolve(stylesRoot, 'components', name));

const importPattern = /@import\s+['"]([^'"]+)['"]\s*;/g;

function readImports(file) {
  const content = fs.readFileSync(file, 'utf8');
  return [...content.matchAll(importPattern)].map((match) => ({
    rel: match[1],
    target: path.resolve(path.dirname(file), match[1])
  }));
}

const missing = [];
const cycles = [];
const visited = new Set();

function visit(file, stack = []) {
  if (!fs.existsSync(file)) {
    missing.push(path.relative(stylesRoot, file));
    return;
  }

  if (stack.includes(file)) {
    cycles.push([...stack, file].map((item) => path.relative(stylesRoot, item)));
    return;
  }

  if (visited.has(file)) return;
  const nextStack = [...stack, file];
  for (const item of readImports(file)) visit(item.target, nextStack);
  visited.add(file);
}

visit(entryFile);

assert.equal(missing.length, 0, `InkGrid stylesheet graph has missing files:\n  - ${missing.join('\n  - ')}`);
assert.equal(cycles.length, 0, `InkGrid stylesheet graph has cycles:\n  - ${cycles.map((cycle) => cycle.join(' -> ')).join('\n  - ')}`);

const entryCss = fs.readFileSync(entryFile, 'utf8');
const inkgridCss = fs.readFileSync(inkgridEntry, 'utf8');
const libraryCss = fs.readFileSync(
  path.resolve(stylesRoot, 'components/knowra-inkgrid-library-index.css'),
  'utf8'
);
assert.match(entryCss, /@import\s+['"]\.\/components\/knowra-inkgrid\.css['"]\s*;/, 'components.css must load the InkGrid aggregate entry');
assert.doesNotMatch(entryCss, /@import\s+['"]\.\/components\/knowra-redesign\.css['"]\s*;/, 'components.css must not load the legacy aggregate entry');

for (const moduleFile of responsibilityModules) {
  const name = path.basename(moduleFile);
  assert.match(
    inkgridCss,
    new RegExp(`@import\\s+["']\\./${name}["']\\s*;`),
    `knowra-inkgrid.css must load ${name}`
  );
}

const legacyAliases = new Map([
  ['knowra-redesign.css', 'knowra-inkgrid.css'],
  ['knowra-shell.css', 'knowra-inkgrid-shell.css'],
  ['knowra-library-index.css', 'knowra-inkgrid-library-index.css'],
  ['knowra-editor.css', 'knowra-inkgrid-editor.css'],
  ['knowra-menus.css', 'knowra-inkgrid-menus.css'],
  ['knowra-typography.css', 'knowra-inkgrid-typography.css']
]);

for (const [legacyName, canonicalName] of legacyAliases) {
  const legacyFile = path.resolve(stylesRoot, 'components', legacyName);
  const legacyCss = fs.readFileSync(legacyFile, 'utf8');
  assert.match(
    legacyCss,
    new RegExp(`@import\\s+["']\\./${canonicalName}["']\\s*;`),
    `${legacyName} must remain a compatibility alias for ${canonicalName}`
  );
}

function splitSelectors(prelude) {
  const selectors = [];
  let current = '';
  let parentheses = 0;
  let brackets = 0;

  for (const character of prelude) {
    if (character === '(') parentheses += 1;
    if (character === ')') parentheses -= 1;
    if (character === '[') brackets += 1;
    if (character === ']') brackets -= 1;
    if (character === ',' && parentheses === 0 && brackets === 0) {
      selectors.push(current.trim());
      current = '';
      continue;
    }
    current += character;
  }

  if (current.trim()) selectors.push(current.trim());
  return selectors;
}

function collectRulePreludes(css) {
  const cleanCss = css.replace(/\/\*[\s\S]*?\*\//g, '');
  return [...cleanCss.matchAll(/([^{}]+)\{/g)]
    .map((match) => match[1].trim())
    .filter((prelude) => !prelude.startsWith('@'))
    .flatMap(splitSelectors);
}

const unscopedSelectors = [];
for (const moduleFile of responsibilityModules) {
  for (const selector of collectRulePreludes(fs.readFileSync(moduleFile, 'utf8'))) {
    if (
      selector.startsWith('.knowra-production-shell')
      || selector === 'body:has(.knowra-production-shell)'
    ) continue;
    unscopedSelectors.push(`${path.basename(moduleFile)}: ${selector}`);
  }
}

assert.equal(
  unscopedSelectors.length,
  0,
  `InkGrid responsibility modules contain selectors outside .knowra-production-shell:\n  - ${unscopedSelectors.join('\n  - ')}`
);

assert.match(
  libraryCss,
  /@media\s*\(max-width:\s*1180px\)\s*\{[\s\S]*\.knowra-production-shell\s*\{[^}]*--rail-width:\s*240px;[^}]*--aside-width:\s*var\(--rail-width\);[^}]*--index-inspector-width:\s*var\(--ink-index-inspector-w\);/,
  'the compact breakpoint must keep the 232px detail token independent from the composite rail'
);
assert.match(
  libraryCss,
  /@media\s*\(max-width:\s*1180px\)\s*\{[\s\S]*\.library-index-view[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)[\s\S]*\.index-inspector\s*\{[^}]*position:\s*absolute[^}]*width:\s*var\(--index-inspector-width\)/,
  'the compact breakpoint should keep the 232px detail panel reachable without widening the page'
);
assert.doesNotMatch(
  libraryCss,
  /\.knowra-production-shell\s+:root\s*\{[^}]*--rail-width/,
  'the compact breakpoint must not use the unreachable Shell-descendant :root selector'
);

console.log(`ok - InkGrid style entry graph is complete, acyclic, and shell-scoped (${visited.size} stylesheets)`);
