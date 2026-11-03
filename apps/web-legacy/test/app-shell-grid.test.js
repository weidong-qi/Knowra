import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderHtml } from '../src/server/shell-html.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const shellCss = fs.readFileSync(
  path.resolve(__dirname, '../styles/components/knowra-inkgrid-shell.css'),
  'utf8'
);
const editorCss = fs.readFileSync(
  path.resolve(__dirname, '../styles/components/knowra-inkgrid-editor.css'),
  'utf8'
);
const responsiveCss = fs.readFileSync(
  path.resolve(__dirname, '../styles/components/responsive.css'),
  'utf8'
);
const shellHtml = renderHtml('<!-- initial workspace -->');

const topBarIndex = shellHtml.indexOf('data-ui-topbar');
const shellBodyIndex = shellHtml.indexOf('data-ui-shell-body');
const statusBarIndex = shellHtml.indexOf('data-ui-status-bar');

assert.match(
  shellHtml,
  /<div class="app-shell workspace-shell app-root knowra-production-shell"[^>]*id="workspace-shell"/,
  'SSR should keep the formal AppShell marker and existing workspace-shell ID'
);
assert.ok(topBarIndex >= 0, 'SSR should expose the TopBar slot');
assert.ok(shellBodyIndex > topBarIndex, 'ShellBody should follow TopBar in the AppShell');
assert.ok(statusBarIndex > shellBodyIndex, 'StatusBarHost should follow ShellBody in the AppShell');
assert.match(
  shellHtml,
  /<div class="shell-body" data-ui-shell-body>[\s\S]*<nav class="function-navigation"[^>]*id="module-rail"[\s\S]*<aside class="kb-sidebar knowra-rail"[^>]*id="kb-sidebar"[\s\S]*<div class="feature-stage workspace-main" data-ui-feature-stage>/,
  'ShellBody should own the pure function navigation, directory rail and feature stage'
);
assert.match(
  shellHtml,
  /<footer class="status-bar status-bar-host"[^>]*data-region="shell-footer"[\s\S]*id="status-indicators"[^>]*data-ui-status-feature[^>]*data-status-slot="feature"[\s\S]*id="status-meta"[^>]*data-ui-status-global[^>]*data-status-slot="global"/,
  'StatusBarHost should keep independent feature and global status slots'
);
assert.match(shellHtml, /id="library-context-menu"[^>]*hidden/, 'library context menu host should remain in SSR');
assert.match(shellHtml, /id="markdown-import-input"[^>]*multiple hidden/, 'markdown import input should remain in SSR');
assert.match(shellHtml, /<nav class="content-tabs" id="library-index-tabs" role="tablist" aria-label="资料筛选"><\/nav>/, 'library index tabs should expose a tablist host');
assert.match(shellHtml, /<div class="library-index-content" id="library-index-content" role="tabpanel" aria-labelledby="library-index-tab-all" tabindex="0"><\/div>/, 'library index content should expose the initial tabpanel relationship');
assert.match(shellHtml, /<aside class="index-inspector" id="library-index-inspector" aria-label="资料详情"><\/aside>/, 'library index inspector should expose a named complementary region');
assert.match(shellHtml, /id="library-index-directory-toggle"[^>]*data-index-directory-toggle[^>]*aria-expanded="true"[^>]*aria-controls="kb-sidebar"/, 'the index directory should expose a collapsible header control');
assert.match(shellHtml, /id="library-index-directory-reopen"[^>]*data-index-directory-toggle[^>]*aria-expanded="false"[^>]*hidden/, 'the collapsed index directory should expose a reopen control');
assert.match(shellHtml, /<aside class="kb-aside editor-inspector"[^>]*id="kb-aside"[^>]*aria-labelledby="editor-aside-title"/, 'the editor marginalia should expose a named complementary region');
assert.match(shellHtml, /id="editor-aside-toggle"[^>]*data-editor-aside-toggle[^>]*aria-expanded="true"[^>]*aria-controls="kb-aside"/, 'the open marginalia control should expose its expanded relationship');
assert.match(shellHtml, /id="editor-aside-reopen"[^>]*data-editor-aside-toggle[^>]*aria-expanded="false"[^>]*aria-controls="kb-aside"[^>]*aria-label="展开资料边注"/, 'the collapsed marginalia should expose a labelled reopen control');
assert.match(shellHtml, /<!-- initial workspace -->/, 'SSR initial workspace script slot should remain available');

assert.match(
  shellCss,
  /\.knowra-production-shell\s*\{[\s\S]*grid-template-rows:\s*var\(--ink-topbar-h\)\s+minmax\(0,\s*1fr\)\s+var\(--ink-statusbar-h\);/,
  'AppShell should use the canonical three-row TopBar/ShellBody/StatusBar grid'
);
assert.match(
  shellCss,
  /\.knowra-production-shell \.shell-body\s*\{[\s\S]*grid-template-columns:\s*var\(--shell-nav-w\)\s+var\(--catalog-w\)\s+minmax\(0,\s*1fr\);[\s\S]*overflow:\s*hidden;/,
  'ShellBody should contain the function navigation, directory and feature stage without page overflow'
);
assert.match(
  shellCss,
  /data-function-navigation-hidden='true'\]\[data-directory-hidden='true'\][\s\S]*grid-template-columns:\s*minmax\(0,\s*1fr\);/,
  'when both left rails are hidden, ShellBody should not leave an empty 208px gutter'
);
assert.match(
  shellCss,
  /data-screen='editor'\]\[data-editor-layout='overlay'\][\s\S]*\.shell-body \.kb-sidebar\s*\{[\s\S]*position:\s*absolute;[\s\S]*top:\s*calc\(var\(--document-tab-height\) \+ var\(--menu-height\)\);[\s\S]*left:\s*var\(--shell-nav-w\);[\s\S]*height:\s*auto;/,
  'editor Overlay mode should float the contextual directory instead of compressing the正文 track'
);
assert.match(
  shellCss,
  /data-screen='editor'\]\[data-editor-layout='overlay'\][\s\S]*\.shell-body:has\(\.editor-menu-text\[data-open='true'\]\)[\s\S]*\.kb-sidebar\s*\{[^}]*visibility:\s*hidden;[^}]*pointer-events:\s*none;/,
  'an open editor menu should clear the floating directory hit area'
);
assert.match(
  shellCss,
  /data-screen='editor'\]\[data-editor-layout='overlay'\][\s\S]*\.workspace-main\s*\{[^}]*z-index:\s*auto;/,
  'editor Overlay mode should not trap the menu inside the legacy workspace stacking context'
);
assert.match(
  editorCss,
  /data-screen='editor'\]\[data-editor-layout='overlay'\][\s\S]*\.editor-menu-bar\s*\{[^}]*z-index:\s*23;/,
  'editor Overlay mode should keep the View menu above the floating directory rail'
);
assert.match(
  shellCss,
  /\.knowra-production-shell \.status-bar-host\s*\{[\s\S]*z-index:\s*25;[\s\S]*height:\s*var\(--ink-statusbar-h\);[\s\S]*overflow:\s*hidden;/,
  'StatusBarHost should keep a fixed height and stacking context outside the body'
);
assert.doesNotMatch(
  shellCss,
  /data-screen='index'[\s\S]*status-bar[^}]*display:\s*none/,
  'the global status host should not disappear on the index screen'
);

assert.match(
  responsiveCss,
  /@media \(max-width:\s*1040px\)[\s\S]*\.kb-sidebar\s*\{\s*order:\s*2;/,
  'responsive.css still carries the legacy flex order rule for <=1040px'
);
assert.match(
  shellCss,
  /\.knowra-production-shell \.shell-body \.function-navigation\s*\{\s*order:\s*0;/,
  'ShellBody must keep the function navigation in the first grid slot'
);
assert.match(
  shellCss,
  /\.knowra-production-shell \.shell-body \.kb-sidebar\s*\{\s*order:\s*1;/,
  'ShellBody must keep the directory rail after the function navigation'
);
assert.match(
  editorCss,
  /@media \(max-width:\s*1040px\)[\s\S]*\.knowra-production-shell \.editor-workspace-view \.kb-workspace\s*\{\s*grid-template-columns:\s*minmax\(0,\s*1fr\);/,
  'the compact editor must collapse its hidden marginalia column instead of forcing 700px + 240px into the FeatureStage'
);
assert.match(
  editorCss,
  /@media \(max-width:\s*1040px\)[\s\S]*\.knowra-production-shell \.editor-workspace \.editor-content\[data-source-open='true'\]\s*\{\s*grid-template-columns:\s*minmax\(0,\s*1fr\);/,
  'the compact source editor must remain single-column and reachable'
);
assert.match(
  editorCss,
  /\.knowra-production-shell \.status-action\s*\{[^}]*height:\s*var\(--control-height-sm\);[^}]*padding:\s*0\s+var\(--space-2\);/,
  'StatusBarHost actions must override the shared button padding and fit the compact control height'
);

const sidebarDomIndex = shellHtml.indexOf('id="kb-sidebar"');
const functionNavigationDomIndex = shellHtml.indexOf('id="module-rail"');
const featureStageDomIndex = shellHtml.indexOf('data-ui-feature-stage');
assert.ok(
  functionNavigationDomIndex >= 0
    && sidebarDomIndex > functionNavigationDomIndex
    && featureStageDomIndex > sidebarDomIndex,
  'the function navigation and directory rail must precede the feature stage in SSR DOM order'
);
assert.match(
  shellHtml,
  /data-ui-feature-stage>[\s\S]*id="work-domain-view"[\s\S]*id="library-index-view"[\s\S]*id="editor-workspace-view"/,
  'index, editor and knowledge domain views must stay inside the FeatureStage'
);

console.log('ok - AppShell renders the canonical three-row InkGrid grid');
