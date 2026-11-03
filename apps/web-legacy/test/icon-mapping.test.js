import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ICON_MAP,
  ICON_NAMES,
  getIconPath,
  renderIcon
} from '../lib/icons/icon-map.js';
import { renderHtml } from '../src/server/shell-html.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const iconRoot = path.resolve(__dirname, '../styles/icons/remix');

assert.ok(ICON_NAMES.length >= 40, 'the formal icon inventory should cover the migrated surfaces');

for (const name of ICON_NAMES) {
  const iconPath = getIconPath(name);
  assert.match(iconPath, /^\/styles\/icons\/remix\/[a-z0-9-]+\.svg$/);
  assert.doesNotMatch(iconPath, /^https?:\/\//);

  const assetFile = path.resolve(iconRoot, path.basename(iconPath));
  assert.equal(fs.existsSync(assetFile), true, `${name} should resolve to a checked-in SVG asset`);
  const svg = fs.readFileSync(assetFile, 'utf8');
  assert.match(svg, /^<svg\s/);
  assert.match(svg, /viewBox="0 0 24 24"/);
}

assert.equal(Object.isFrozen(ICON_MAP), true);
assert.equal(getIconPath('missing-icon'), null);
assert.equal(renderIcon('missing-icon'), '');

const rendered = renderIcon('search', {
  className: 'top-bar-search-icon-glyph',
  data: { 'data-test-icon': 'true' }
});
assert.match(rendered, /class="semantic-icon top-bar-search-icon-glyph"/);
assert.match(rendered, /data-icon="search"/);
assert.match(rendered, /aria-hidden="true"/);
assert.match(rendered, /data-test-icon="true"/);
assert.match(rendered, /\/styles\/icons\/remix\/search-line\.svg/);
assert.doesNotMatch(rendered, /<svg|<path|https?:\/\//);

const shellHtml = renderHtml();
assert.match(shellHtml, /class="back-index"[^>]*aria-label="返回资料索引"[\s\S]*data-icon="back"/);
assert.match(shellHtml, /class="semantic-icon library-mark-icon"[\s\S]*data-icon="libraryMark"/);
assert.match(shellHtml, /class="semantic-icon masthead-create-icon"[\s\S]*data-icon="create"/);

const iconRendererFiles = [
  '../lib/editor/context-menu-icons.js',
  '../lib/editor/context-menu-renderers.js',
  '../lib/editor/editor-panel-renderers.js',
  '../lib/editor/tab-renderers.js',
  '../lib/editor/milkdown/host/editor-factory.js',
  '../lib/editor/milkdown/table/table-buttons.js',
  '../lib/library-index/filter-renderers.js',
  '../lib/library-index/renderers.js',
  '../lib/navigation/section-menu-renderers.js',
  '../lib/navigation/tree-renderers.js',
  '../lib/search/renderers.js',
  '../lib/shell/rail-renderers.js',
  '../lib/sidebar/info-panel.js',
  '../lib/sidebar/outline-panel.js',
  '../lib/sidebar/renderers.js',
  '../src/controllers/navigation/render/tree-render-controller.js',
  '../src/server/shell-html.js'
];

for (const relativeFile of iconRendererFiles) {
  const source = fs.readFileSync(path.resolve(__dirname, relativeFile), 'utf8');
  assert.doesNotMatch(source, /\/styles\/icons\/(?!remix\/)/, `${relativeFile} should not copy an asset path`);
  assert.doesNotMatch(source, /phosphor-/i, `${relativeFile} should not retain the legacy icon family`);
  assert.doesNotMatch(source, /<svg|<path/, `${relativeFile} should not duplicate icon SVG paths`);
  assert.doesNotMatch(source, /https?:\/\//, `${relativeFile} should not introduce runtime icon CDN URLs`);
  assert.doesNotMatch(source, /[›‹⌄⌃▼▲◀▶]/, `${relativeFile} should not emit Unicode icon glyphs directly`);
}

console.log('ok - formal icon mapping resolves local Remix SVG assets without inline paths or CDN URLs');
