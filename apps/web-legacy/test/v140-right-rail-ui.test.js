import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const appStateJs = fs.readFileSync(path.resolve(__dirname, '../src/app/app-state.js'), 'utf8');
const sidebarControllerJs = fs.readFileSync(path.resolve(__dirname, '../src/controllers/sidebar-controller.js'), 'utf8');
const shellHtmlJs = fs.readFileSync(path.resolve(__dirname, '../src/server/shell-html.js'), 'utf8');
const sidebarTabsJs = fs.readFileSync(path.resolve(__dirname, '../lib/sidebar/tabs.js'), 'utf8');
const sectionMenuRenderersJs = fs.readFileSync(
  path.resolve(__dirname, '../lib/navigation/section-menu-renderers.js'),
  'utf8'
);
const sidebarStatsJs = fs.readFileSync(path.resolve(__dirname, '../lib/sidebar/stats.js'), 'utf8');
const navigationSelectionJs = fs.readFileSync(
  path.resolve(__dirname, '../lib/navigation/selection.js'),
  'utf8'
);

assert.match(
  sectionMenuRenderersJs,
  /SECONDARY_SECTION_ITEMS = \[\s*\{ key: 'favorites', label: '收藏' },\s*\{ key: 'recent', label: '最近' },\s*\{ key: 'recycle', label: '回收站' }\s*\]/,
  'left navigation section toggles should only keep favorites, recent, and recycle sections after the tag redesign'
);

assert.match(
  shellHtmlJs,
  /id="aside-tabs"/,
  'right rail shell should keep a dedicated dynamic tab host'
);
assert.match(
  sidebarTabsJs,
  /key: 'info'[\s\S]*label: '信息'[\s\S]*key: 'outline'[\s\S]*label: '大纲'[\s\S]*key: 'concepts'[\s\S]*label: '重点'[\s\S]*key: 'ai'[\s\S]*label: 'AI'/,
  'right rail tab model should expose the four migrated tabs'
);

assert.match(
  appStateJs,
  /asideTab:\s*'info'/,
  'workspace state should track the active right-rail tab and default it to the info panel'
);

assert.match(
  sidebarStatsJs,
  /function getNoteStats\(markdown\)/,
  'info tab should derive note statistics through the sidebar stats module'
);

assert.match(
  navigationSelectionJs,
  /function buildNotePath\(/,
  'info tab should reconstruct the complete file-name path through the navigation selection module'
);

assert.match(
  sidebarControllerJs,
  /folderPath:\s*buildNotePath\(/,
  'info tab should pass the reconstructed note path into the info panel renderer'
);

console.log('ok - V1.4.0 right rail tab shell hooks are present');
