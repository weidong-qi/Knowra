import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const aggregateCss = readFileSync(new URL('../styles/components/knowra-inkgrid.css', import.meta.url), 'utf8');
const reflowCss = readFileSync(new URL('../styles/components/knowra-inkgrid-reflow.css', import.meta.url), 'utf8');
const tokensCss = readFileSync(new URL('../styles/components/knowra-theme-tokens.css', import.meta.url), 'utf8');

assert.match(aggregateCss, /@import '.\/knowra-inkgrid-reflow\.css';/);
assert.match(reflowCss, /@media \(max-width:\s*700px\)/);
assert.match(
  reflowCss,
  /body:has\(\.knowra-production-shell\)\s*\{[^}]*min-width:\s*0;/,
  '200% zoom reflow must release the 1024px page minimum'
);
assert.match(
  tokensCss,
  /--ink-shell-nav-zoom-w:\s*56px;/,
  'zoomed function rail width should remain a named InkGrid token'
);
assert.match(
  reflowCss,
  /--shell-nav-w:\s*var\(--shell-nav-zoom-width\);/,
  'zoomed layouts should retain a compact, keyboard-reachable function rail'
);
assert.match(
  reflowCss,
  /\.shell-body[\s\S]*grid-template-columns:\s*var\(--shell-nav-w\) minmax\(0, 1fr\);/,
  'zoomed workspaces should reserve only the compact rail and a fluid content track'
);
assert.match(
  reflowCss,
  /data-function-navigation-hidden='true'\]\[data-directory-hidden='true'\] \.shell-body,[\s\S]*data-left-hidden='true'\]\[data-directory-hidden='true'\] \.shell-body\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\);/,
  'closing the zoomed editor directory should release the compact rail track as well'
);
assert.match(
  reflowCss,
  /\.shell-body \.kb-sidebar[\s\S]*position:\s*absolute;[\s\S]*width:\s*min\(var\(--catalog-w\), calc\(100% - var\(--shell-nav-w\)\)\);/,
  'the directory should overlay instead of widening the zoomed page'
);
assert.match(
  reflowCss,
  /data-screen='editor'\]\[data-editor-layout='overlay'\] \.library-index-directory-toggle[\s\S]*display:\s*inline-grid;/,
  'the zoomed editor directory overlay should expose its close trigger'
);
assert.match(
  reflowCss,
  /data-screen='editor'\]\[data-editor-layout='overlay'\] \.library-index-directory-reopen[\s\S]*position:\s*absolute;/,
  'the zoomed editor should expose a reopen trigger after closing the directory'
);
assert.match(
  reflowCss,
  /\.editor-workspace-view \.kb-workspace\[data-editor-layout='overlay'\] \.editor-inspector\s*\{[^}]*display:\s*grid;[^}]*grid-template-rows:\s*auto auto minmax\(0, 1fr\);[^}]*height:\s*calc\(100% - var\(--document-tab-height\)\);[^}]*padding:\s*var\(--space-1\) var\(--space-3\);/,
  'the zoomed marginalia should reserve a non-zero scroll track below its compact header and tabs'
);
assert.match(
  reflowCss,
  /\.kb-workspace\[data-editor-layout='overlay'\] \.editor-inspector \.aside-heading span\s*\{[^}]*display:\s*none;/,
  'the decorative marginalia label should not wrap and consume the zoomed scroll track'
);
assert.match(
  reflowCss,
  /\.kb-workspace\[data-editor-layout='overlay'\] \.editor-inspector \.aside-panel-scroll\s*\{[^}]*min-height:\s*0;[^}]*overflow-y:\s*auto;/,
  'the zoomed marginalia content track should remain vertically scrollable'
);

console.log('ok - M4-07 supports 200% zoom reflow without page-width locking');
