import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const stylesFile = process.env.STYLES_FILE
  ? path.resolve(__dirname, '..', process.env.STYLES_FILE)
  : path.resolve(__dirname, '../styles/components.css');

function readCssWithImports(file, visited = new Set()) {
  const resolved = path.resolve(file);
  if (visited.has(resolved)) {
    return '';
  }
  visited.add(resolved);

  const content = fs.readFileSync(resolved, 'utf8');
  const importRegex = /@import\s+['"]([^'"]+)['"]\s*;/g;
  const importedCss = [];
  let match;
  while ((match = importRegex.exec(content)) !== null) {
    importedCss.push(readCssWithImports(path.resolve(path.dirname(resolved), match[1]), visited));
  }

  return [content, ...importedCss].join('\n');
}

const css = readCssWithImports(stylesFile);
const hiddenContextMenuRule = /\.library-context-menu\[hidden\]\s*\{[^}]*display\s*:\s*none\b[^}]*\}/m;

assert.match(
  css,
  hiddenContextMenuRule,
  `hidden context menu elements must not render as empty white bars (checked in ${path.relative(path.resolve(__dirname, '..'), stylesFile)})`
);

console.log(`ok - hidden context menus are fully removed from layout (${path.relative(path.resolve(__dirname, '..'), stylesFile)})`);
