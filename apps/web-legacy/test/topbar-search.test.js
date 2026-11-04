import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { renderHtml } from '../src/server/shell-html.js';
import { renderSearchShell } from '../lib/search/renderers.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const shellCss = fs.readFileSync(
  path.resolve(__dirname, '../styles/components/knowra-inkgrid-shell.css'),
  'utf8'
);
const topbarCss = fs.readFileSync(
  path.resolve(__dirname, '../styles/components/knowra-inkgrid-topbar.css'),
  'utf8'
);
const keyboardEventsJs = fs.readFileSync(
  path.resolve(__dirname, '../lib/events/document-keyboard-events.js'),
  'utf8'
);
const shellHtml = renderHtml();
const searchHtml = renderSearchShell();

assert.match(shellHtml, /data-ui-topbar-brand/);
assert.match(shellHtml, /class="topbar-brand-mark"[^>]*aria-hidden="true"/);
assert.match(shellHtml, /知境 Knowra/);
assert.equal((shellHtml.match(/id="global-search-shell"/g) ?? []).length, 1);
assert.match(shellHtml, /id="global-search-shell"[^>]*role="search"[^>]*aria-label="全局搜索"/);
assert.match(shellHtml, /data-topbar-placeholder="notifications"[^>]*aria-label="通知（即将开放）"/);
assert.match(shellHtml, /data-topbar-placeholder="settings"[^>]*aria-label="设置（即将开放）"/);
assert.match(shellHtml, /data-topbar-placeholder="user"[^>]*aria-label="用户中心（即将开放）"/);
assert.doesNotMatch(shellHtml, /knowra-rail[\s\S]*settings-button/);
assert.doesNotMatch(shellHtml, /filter-row[\s\S]*global-search-shell/);

assert.match(topbarCss, /\.knowra-production-shell \.topbar-search-slot\s*\{[\s\S]*left:\s*50%;[\s\S]*width:\s*min\(var\(--topbar-search-width\),\s*42vw\)/);
assert.match(topbarCss, /\.knowra-production-shell \.topbar-brand-mark::before/);
assert.match(topbarCss, /\.knowra-production-shell \.topbar-actions/);
assert.match(topbarCss, /@media \(max-width:\s*1100px\)/);

assert.match(searchHtml, /data-search-input/);
assert.match(searchHtml, /aria-label="全局搜索"/);
assert.match(searchHtml, /class="top-bar-search-shortcut"[^>]*aria-hidden="true">⌘K/);
assert.match(keyboardEventsJs, /event\.metaKey \|\| event\.ctrlKey/);
assert.match(keyboardEventsJs, /normalizedKey === 'k'/);
assert.match(keyboardEventsJs, /state\.search\.isOpen = true;[\s\S]*focusSearchInput\(\)/);

console.log('ok - M2-02 TopBar and global search contract is present');
