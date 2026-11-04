import { readFile, mkdir, cp, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = dirname(dirname(fileURLToPath(import.meta.url)));
export const readJson = async path => JSON.parse(await readFile(path, 'utf8'));

export function tokensCss(tokens) {
  const common = {
    'font-ui': tokens.type.families.ui,
    'font-mono': tokens.type.families.mono
  };
  for (const section of ['spacing', 'radius', 'size']) {
    for (const token of tokens[section].tokens) common[token.name] = token.value;
  }
  const declarations = values =>
    Object.entries(values)
      .map(([name, value]) => `  --${name}: ${value};`)
      .join('\n');
  let css = `/* 从 project/tokens.json 生成；请修改源 JSON。 */\n:root {\n${declarations(common)}\n}\n`;
  for (const theme of tokens.color.themes) {
    const values = {};
    for (const section of ['color', 'shadow']) {
      for (const token of tokens[section].tokens) {
        values[token.name] =
          typeof token.value === 'object' ? (token.value[theme.id] ?? token.value.light) : token.value;
      }
    }
    const selector = theme.id === 'light' ? ':root, [data-theme="light"]' : `[data-theme="${theme.id}"]`;
    css += `${selector} {\n  color-scheme: ${theme.id.endsWith('dark') ? 'dark' : 'light'};\n${declarations(values)}\n}\n`;
  }
  return css;
}

export function previewHtml(source, theme = 'light') {
  if (!['light', 'dark'].includes(theme)) theme = 'light';
  const mode = theme.endsWith('dark') ? 'dark' : 'light';
  const runtime = `<link rel="stylesheet" href="/generated/tokens.css">
<link rel="stylesheet" href="/project/components/bundle.css">
<style>html,body{margin:0;min-height:100%;background:var(--surface-page);color:var(--text-primary);font:13px/1.5 var(--font-ui)}body{padding:16px;box-sizing:border-box}*,*::before,*::after{box-sizing:border-box}</style>
<script>var theme = new URLSearchParams(location.search).get('theme') || ${JSON.stringify(theme)}; if(!/^(light|dark)$/.test(theme))theme='light';document.documentElement.dataset.theme=theme;document.documentElement.dataset.niMode=theme.endsWith('dark')?'dark':'light';</script>
<script src="/vendor/react.production.min.js"></script>
<script src="/vendor/react-dom.production.min.js"></script>
<script src="/project/components/bundle.js"></script>`;
  return source
    .replace(/<html([^>]*)>/i, `<html$1 data-theme="${theme}" data-ni-mode="${mode}">`)
    .replace(/<head>/i, `<head>\n${runtime}\n`);
}

export async function copyVendor(target) {
  await mkdir(join(target, 'vendor'), { recursive: true });
  for (const [source, filename] of [
    ['react/umd/react.production.min.js', 'react.production.min.js'],
    ['react-dom/umd/react-dom.production.min.js', 'react-dom.production.min.js'],
    ['marked/lib/marked.esm.js', 'marked.esm.js']
  ])
    await cp(join(root, 'node_modules', source), join(target, 'vendor', filename));
}

export async function generateTokens(target) {
  await mkdir(join(target, 'generated'), { recursive: true });
  await writeFile(join(target, 'generated/tokens.css'), tokensCss(await readJson(join(root, 'project/tokens.json'))));
}
