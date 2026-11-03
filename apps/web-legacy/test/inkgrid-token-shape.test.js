import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tokensPath = path.resolve(__dirname, '../styles/components/knowra-theme-tokens.css');
const tokens = fs.readFileSync(tokensPath, 'utf8');

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const assertToken = (name, message = `${name} should be declared`) => {
  assert.match(tokens, new RegExp(`${escapeRegExp(name)}\\s*:`), message);
};
const assertTokenValue = (name, value) => {
  assert.match(
    tokens,
    new RegExp(`${escapeRegExp(name)}\\s*:\\s*${escapeRegExp(value)};`),
    `${name} should use ${value}`
  );
};

[
  '--ink-bg',
  '--ink-surface',
  '--ink-surface-sunken',
  '--ink-border',
  '--ink-text',
  '--ink-text-secondary',
  '--ink-dot-grid',
  '--ink-accent',
  '--ink-accent-hover',
  '--ink-accent-bg',
  '--ink-success',
  '--ink-success-hover',
  '--ink-success-bg',
  '--ink-warning',
  '--ink-warning-hover',
  '--ink-warning-bg',
  '--ink-danger',
  '--ink-danger-hover',
  '--ink-danger-bg',
  '--ink-line-shell',
  '--ink-line-panel',
  '--ink-line-soft',
  '--ink-line-shell-w',
  '--ink-line-panel-w',
  '--ink-line-soft-w',
  '--ink-border-w',
  '--ink-border-w-thin',
  '--ink-shadow-1',
  '--ink-shadow-2',
  '--ink-shadow-3',
  '--ink-shadow-hero',
  '--ink-shell-nav-w',
  '--ink-catalog-w',
  '--ink-index-inspector-w',
  '--ink-index-row-h',
  '--ink-index-entry-thumb',
  '--ink-index-entry-title',
  '--ink-index-create-h',
  '--ink-index-local-search-w',
  '--ink-marginalia-w',
  '--ink-inspector-wide-w',
  '--ink-menu-w',
  '--ink-statusbar-h',
  '--ink-topbar-h',
  '--ink-space-1',
  '--ink-space-2',
  '--ink-space-4',
  '--ink-space-6',
  '--ink-space-8',
  '--ink-space-12',
  '--ink-space-16',
  '--ink-type-micro',
  '--ink-type-control',
  '--ink-type-reading',
  '--ink-type-heading-1',
  '--ink-radius-none'
].forEach(assertToken);

[
  ['--ink-bg', '#F9F7F2'],
  ['--ink-surface', '#FFFFFF'],
  ['--ink-surface-sunken', '#F4F1EA'],
  ['--ink-border', '#1A1A1A'],
  ['--ink-text-secondary', '#666666'],
  ['--ink-accent', '#2563EB'],
  ['--ink-accent-hover', '#1D4ED8'],
  ['--ink-success', '#16A34A'],
  ['--ink-warning', '#EA580C'],
  ['--ink-danger', '#DC2626'],
  ['--ink-line-shell-w', '2px'],
  ['--ink-line-panel-w', '1px'],
  ['--ink-shadow-1', '2px 2px 0 var(--ink-border)'],
  ['--ink-shadow-3', '4px 4px 0 var(--ink-border)'],
  ['--ink-shell-nav-w', '208px'],
  ['--ink-catalog-w', '232px'],
  ['--ink-inspector-wide-w', '300px'],
  ['--ink-index-row-h', '100px'],
  ['--ink-index-entry-thumb', '44px'],
  ['--ink-index-entry-title', '15px'],
  ['--ink-index-create-h', '42px'],
  ['--ink-index-local-search-w', '220px'],
  ['--ink-menu-w', '220px'],
  ['--ink-statusbar-h', '32px']
].forEach(([name, value]) => assertTokenValue(name, value));

[
  ['--ink-font-ui', '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif'],
  ['--ink-font-reading', 'var(--ink-font-ui)'],
  ['--ink-font-display', 'var(--ink-font-ui)'],
  ['--ink-font-mono', '"SF Mono", "Menlo", monospace'],
  ['--ink-type-control', '14px'],
  ['--ink-type-heading-4', '13px'],
  ['--ink-type-heading-3', '14px'],
  ['--ink-type-heading-2', '16px'],
  ['--ink-type-heading-1', '28px'],
  ['--ink-type-display-sm', '42px']
].forEach(([name, value]) => assertTokenValue(name, value));

const canonicalSansFontBlocks = [
  tokens.match(/--ink-font-ui\s*:\s*([^;]+);/)?.[1],
  tokens.match(/--ink-font-reading\s*:\s*([^;]+);/)?.[1],
  tokens.match(/--ink-font-display\s*:\s*([^;]+);/)?.[1]
].filter(Boolean).join(' ');
assert.doesNotMatch(
  canonicalSansFontBlocks,
  /(?:Songti|Source Han Serif|Noto Serif|STSong|SimSun|Georgia|(?:^|[\s,'"])serif(?:[;,\s'"$]|$))/i,
  'canonical UI, reading, and display roles must remain sans-serif'
);

[
  ['--font-ui', '--ink-font-ui'],
  ['--font-reading', '--ink-font-reading'],
  ['--font-display', '--ink-font-display'],
  ['--font-body', '--ink-font-ui'],
  ['--font-mono', '--ink-font-mono'],
  ['--paper', '--ink-bg'],
  ['--paper-raised', '--ink-surface'],
  ['--paper-muted', '--ink-surface-sunken'],
  ['--ink', '--ink-text'],
  ['--blue', '--ink-accent'],
  ['--blue-dark', '--ink-accent-hover'],
  ['--line', '--ink-line'],
  ['--line-soft', '--ink-line-soft'],
  ['--muted', '--ink-text-secondary'],
  ['--color-success', '--ink-success'],
  ['--color-warning', '--ink-warning'],
  ['--color-danger', '--ink-danger'],
  ['--shadow-editorial', '--ink-shadow-3'],
  ['--shadow-search', '--ink-shadow-hero'],
  ['--space-4', '--ink-space-4'],
  ['--text-body', '--ink-type-reading'],
  ['--border-thin', '--ink-border-w-thin'],
  ['--border-tab-active', '--ink-border-tab-active'],
  ['--radius-none', '--ink-radius-none'],
  ['--shell-nav-w', '--ink-shell-nav-w'],
  ['--catalog-w', '--ink-catalog-w'],
  ['--aux-sidebar-w', '--ink-aux-sidebar-w'],
  ['--inspector-wide-w', '--ink-inspector-wide-w'],
  ['--index-row-height', '--ink-index-row-h'],
  ['--index-entry-thumb', '--ink-index-entry-thumb'],
  ['--index-entry-title', '--ink-index-entry-title'],
  ['--index-create-height', '--ink-index-create-h'],
  ['--index-local-search-width', '--ink-index-local-search-w']
].forEach(([alias, target]) => {
  assertTokenValue(alias, `var(${target})`);
});

assertTokenValue('--rail-width', 'var(--ink-shell-composite-w)');
assertTokenValue('--index-inspector-width', 'var(--ink-index-inspector-w)');
assert.match(tokens, /\[data-theme='dark'\]\s*\{/, 'dark theme token overrides should remain available');

console.log('ok - InkGrid canonical tokens and formal compatibility aliases are complete');
