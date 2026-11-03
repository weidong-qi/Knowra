import fs from 'node:fs';
import path from 'node:path';

export function readCssWithImports(file, visited = new Set()) {
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
