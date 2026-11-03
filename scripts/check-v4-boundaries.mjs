import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const v4Root = path.join(workspaceRoot, 'apps', 'web');
const v4Source = path.join(v4Root, 'src');
const webCoreSource = path.join(workspaceRoot, 'packages', 'web-core', 'src');
const violations = [];
const warnings = [];

// Extensionless imports must resolve consistently on case-insensitive filesystems.
for (const root of [v4Source, webCoreSource]) {
  const modules = new Map();
  for (const filePath of collectSourceFiles(root)) {
    const stem = filePath.replace(/\.[cm]?[jt]sx?$/, '').toLowerCase();
    const previous = modules.get(stem);
    if (previous) {
      violations.push(
        `Case-insensitive module collision: ${toWorkspacePath(previous)} and ${toWorkspacePath(filePath)}`
      );
    } else {
      modules.set(stem, filePath);
    }
  }
}

for (const filePath of collectSourceFiles(v4Source)) {
  const source = fs.readFileSync(filePath, 'utf8');
  const relativeFile = toWorkspacePath(filePath);

  for (const specifier of collectImportSpecifiers(source)) {
    if (isV3Import(filePath, specifier)) {
      violations.push(`${relativeFile}: V4 must not import V3 module or asset: ${specifier}`);
    }

    if (specifier === 'react-aria-components' && !isWithin(filePath, path.join(v4Source, 'components', 'ui'))) {
      violations.push(`${relativeFile}: react-aria-components is restricted to src/components/ui`);
    }
  }

  // 按钮类别约束为提醒而非失败：业务代码应使用 components/ui/button 的四类按钮；确有例外时在评审中说明。
  if (!isWithin(filePath, path.join(v4Source, 'components', 'ui')) && /<button[\s>]/.test(source)) {
    warnings.push(`${relativeFile}: 原生 <button>，请优先使用 Button / IconButton / PressableButton / SegmentedButton`);
  }

  for (const bannedApi of ['dangerouslySetInnerHTML', '.innerHTML', 'document.querySelector']) {
    if (source.includes(bannedApi)) {
      violations.push(`${relativeFile}: banned React-owned DOM API: ${bannedApi}`);
    }
  }
}

if (fs.existsSync(webCoreSource)) {
  for (const filePath of collectSourceFiles(webCoreSource)) {
    const source = fs.readFileSync(filePath, 'utf8');
    const executableSource = stripCommentsAndLiterals(source);
    const relativeFile = toWorkspacePath(filePath);

    for (const specifier of collectImportSpecifiers(source)) {
      if (
        specifier === 'react' ||
        specifier === 'react-dom' ||
        specifier.startsWith('react/') ||
        specifier.startsWith('react-dom/') ||
        /\.css(?:$|\?)/.test(specifier) ||
        isWorkspaceAppImport(filePath, specifier)
      ) {
        violations.push(`${relativeFile}: web-core must remain framework and CSS independent: ${specifier}`);
      }
    }

    for (const domGlobal of ['document', 'window', 'HTMLElement', 'localStorage']) {
      if (new RegExp(`\\b${domGlobal}\\b`).test(executableSource)) {
        violations.push(`${relativeFile}: web-core must not reference DOM global: ${domGlobal}`);
      }
    }
  }
}

if (warnings.length > 0) {
  console.warn(`按钮类别提醒 (${warnings.length}，不影响通过):\n- ${warnings.join('\n- ')}`);
}

if (violations.length > 0) {
  console.error(`V4 boundary check failed (${violations.length}):\n- ${violations.join('\n- ')}`);
  process.exitCode = 1;
} else {
  console.log('V4 boundary check passed.');
}

function collectSourceFiles(root) {
  if (!fs.existsSync(root)) return [];

  return fs.readdirSync(root, { withFileTypes: true }).flatMap(entry => {
    const entryPath = path.join(root, entry.name);
    if (entry.isDirectory()) return collectSourceFiles(entryPath);
    return /\.(?:[cm]?[jt]sx?)$/.test(entry.name) && !entry.name.includes('.test.') ? [entryPath] : [];
  });
}

function collectImportSpecifiers(source) {
  const specifiers = [];
  const matcher = /(?:import|export)\s+(?:[^'";]+?\s+from\s+)?['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  for (const match of source.matchAll(matcher)) specifiers.push(match[1] ?? match[2]);
  return specifiers;
}

function stripCommentsAndLiterals(source) {
  return source
    .replace(/(['"`])(?:\\.|(?!\1)[\s\S])*?\1/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
}

function isV3Import(importer, specifier) {
  if (specifier === '@study-accelerator/web-legacy' || specifier.startsWith('@study-accelerator/web-legacy/')) {
    return true;
  }
  if (!specifier.startsWith('.')) return false;
  const resolved = path.resolve(path.dirname(importer), specifier);
  const v3Root = path.join(workspaceRoot, 'apps', 'web-legacy');
  return isWithin(resolved, v3Root);
}

function isWorkspaceAppImport(importer, specifier) {
  if (!specifier.startsWith('.')) return false;
  return isWithin(path.resolve(path.dirname(importer), specifier), path.join(workspaceRoot, 'apps'));
}

function isWithin(candidate, root) {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function toWorkspacePath(filePath) {
  return path.relative(workspaceRoot, filePath).split(path.sep).join('/');
}
