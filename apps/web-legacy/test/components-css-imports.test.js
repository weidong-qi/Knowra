import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const stylesEntry = path.resolve(__dirname, '../src/styles.css');
const stylesRoot = path.resolve(__dirname, '../styles');

function collectImports(file, visited = new Set(), imports = []) {
  const resolved = path.resolve(file);
  if (visited.has(resolved)) {
    return imports;
  }
  visited.add(resolved);

  const content = fs.readFileSync(resolved, 'utf8');
  const importRegex = /@import\s+['"]([^'"]+)['"]\s*;/g;
  let match;
  while ((match = importRegex.exec(content)) !== null) {
    const target = path.resolve(path.dirname(resolved), match[1]);
    imports.push({ from: resolved, rel: match[1], target });
    if (fs.existsSync(target)) {
      collectImports(target, visited, imports);
    }
  }

  return imports;
}

const imports = collectImports(stylesEntry);
assert.ok(imports.length > 0, 'src/styles.css must load stylesheet files with @import');

const invalid = [];
for (const item of imports) {
  if (!fs.existsSync(item.target)) {
    invalid.push(`${path.relative(stylesRoot, item.from)} imports missing ${item.rel}`);
  } else if (!item.target.startsWith(stylesRoot)) {
    invalid.push(`${path.relative(stylesRoot, item.from)} imports outside styles: ${item.rel}`);
  }
}

assert.equal(invalid.length, 0, `invalid stylesheet imports:\n  - ${invalid.join('\n  - ')}`);

const componentImports = imports.filter((item) => path.basename(path.dirname(item.target)) === 'components');
assert.ok(componentImports.length > 0, 'components.css should aggregate split component styles');

console.log(`ok - stylesheet imports resolve recursively: ${imports.length} import(s), ${componentImports.length} component module(s)`);
