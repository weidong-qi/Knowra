import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readCssWithImports } from './helpers/read-css.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const clientJs = fs.readFileSync(path.resolve(__dirname, '../src/client.js'), 'utf8');
const appStateJs = fs.readFileSync(path.resolve(__dirname, '../src/app/app-state.js'), 'utf8');
const shellHtmlJs = fs.readFileSync(path.resolve(__dirname, '../src/server/shell-html.js'), 'utf8');
const componentsCss = readCssWithImports(path.resolve(__dirname, '../styles/components.css'));
const searchEventsJs = fs.readFileSync(path.resolve(__dirname, '../lib/events/search-events.js'), 'utf8');
const searchRenderersJs = fs.readFileSync(path.resolve(__dirname, '../lib/search/renderers.js'), 'utf8');
const searchStateJs = fs.readFileSync(path.resolve(__dirname, '../lib/search/state.js'), 'utf8');
const searchControllerJs = fs.readFileSync(path.resolve(__dirname, '../src/controllers/search-controller.js'), 'utf8');
const controllerActionProxiesJs = fs.readFileSync(
  path.resolve(__dirname, '../src/controllers/controller-action-proxies.js'),
  'utf8'
);

assert.doesNotMatch(
  clientJs,
  /\{ key: 'tags', label: '鏍囩' \}/,
  'left navigation should no longer expose a dedicated tags entry after V1.4.4'
);

assert.match(
  shellHtmlJs,
  /id="global-search-shell"/,
  'top bar should expose a dedicated search shell container for the tag-aware search UI'
);

assert.match(
  appStateJs,
  /search:\s*\{\s*keyword:\s*''[\s\S]*selectedTagIds:\s*\[\][\s\S]*isOpen:\s*false/,
  'workspace state should centralize keyword and selected tags inside a dedicated search state object'
);

assert.match(
  searchControllerJs,
  /function renderSearchShell\(\)/,
  'top bar should render its search shell through the search controller'
);

assert.match(
  controllerActionProxiesJs,
  /new Proxy\(\{\},[\s\S]*findControllerMethod\(getControllers\(\), property\)/,
  'client search shell compatibility entries should be provided by dynamic controller action proxies'
);

assert.match(
  searchEventsJs,
  /elements\.globalSearchShell\?\.addEventListener\('click',\s*\(event\)\s*=>\s*\{[\s\S]*event\.stopPropagation\(\);[\s\S]*if \(!state\.search\.isOpen\)/,
  'opening the search panel should stop click propagation so global document handlers do not immediately close it'
);

assert.match(
  searchRenderersJs,
  /inlineLimit\s*=\s*2[\s\S]*selectedTags\.slice\(0,\s*inlineLimit\)/,
  'top bar should only embed a compact subset of selected tags into the fixed-width search shell'
);

assert.match(
  searchRenderersJs,
  /class="top-search-chip"/,
  'selected search tags should render as compact chips inside the top bar search shell'
);

assert.match(
  searchRenderersJs,
  /data-search-chip-remove="\$\{escapeAttribute\(tag\.id\)\}"/,
  'embedded search chips should support removing a selected tag'
);

assert.match(
  searchControllerJs,
  /function renderSearchPanel\(\)/,
  'top bar should provide a dedicated dropdown panel through the search controller'
);

assert.match(
  searchRenderersJs,
  /data-search-tag-id="\$\{escapeAttribute\(tag\.id\)\}"/,
  'search panel should render clickable global tag options'
);

assert.doesNotMatch(
  clientJs,
  /鍖归厤绗旇/,
  'dropdown panel should focus on managing filter conditions, while note results remain in the left tree'
);

assert.match(
  searchStateJs,
  /function toggleSearchTagId\(selectedTagIds, tagId\)/,
  'global tag selection should be handled by a dedicated search filter toggle helper'
);

assert.match(
  searchControllerJs,
  /reconcileSelection\(\);\s*renderAll\(\);/,
  'changing keyword or tag filters should re-run the shared left-tree filtering flow'
);

assert.doesNotMatch(
  searchControllerJs,
  /addEventListener\('focusin'/,
  'search shell should not re-render itself on focusin, otherwise typing can become unstable'
);

assert.doesNotMatch(
  searchControllerJs,
  /function renderSearchShell\(\)[\s\S]{0,1600}requestAnimationFrame/,
  'search shell renderer should not force refocus after every open/render cycle'
);

assert.match(
  componentsCss,
  /\.top-bar-search\s*\{[\s\S]*max-width:\s*420px;[\s\S]*padding:\s*5px 10px;[\s\S]*border:\s*1px solid var\(--color-border\);[\s\S]*border-radius:\s*8px;/,
  'top search shell should keep the original compact width and frame styling'
);

assert.match(
  componentsCss,
  /\.top-search-chip/,
  'top bar chips should have dedicated compact styles'
);

assert.match(
  componentsCss,
  /\.search-panel/,
  'search dropdown panel should have dedicated styles'
);

assert.match(
  componentsCss,
  /\.search-panel-host\s*\{[\s\S]*z-index:\s*50;/,
  'search panel host should float above the workspace content when it expands from the top bar'
);

assert.match(
  componentsCss,
  /\.top-bar\s*\{[\s\S]*position:\s*relative;[\s\S]*z-index:\s*3;/,
  'top bar should establish a higher stacking context so the search dropdown is not covered by the workspace stage'
);

console.log('ok - V1.4.4 top search chips and left-tree filtering hooks are present');
