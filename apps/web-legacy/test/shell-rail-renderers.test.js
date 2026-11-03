import assert from 'node:assert/strict';
import {
  getFunctionNavigationGroups,
  getRailLabel,
  renderFunctionNavigation,
  renderModuleRail,
  renderRailIcon
} from '../lib/shell/rail-renderers.js';

assert.equal(getRailLabel('knowledge'), '知识');
assert.equal(getRailLabel('materials'), '资料');
assert.equal(getRailLabel('training'), '训练');
assert.equal(getRailLabel('learning'), '学习档案');
assert.equal(getRailLabel('paper'), '题库');
assert.equal(getRailLabel('unknown <module>'), 'unknown <module>');

const html = renderModuleRail([
  { key: 'knowledge', active: true },
  { key: 'unknown <module>', active: false }
]);

assert.match(html, /class="rail-item"/);
assert.match(html, /data-active="true"/);
assert.match(html, /aria-label="知识"/);
assert.match(html, /rail-item-label">知识</);
assert.match(html, /data-active="false"/);
assert.match(html, /aria-label="unknown &lt;module&gt;"/);
assert.match(html, /rail-item-label">unknown &lt;module&gt;</);
assert.match(html, /rail-item-icon/);
assert.match(html, /data-icon="moduleKnowledge"[\s\S]*remix\/book-2-line\.svg/);
assert.doesNotMatch(html, /<svg/);

assert.match(renderRailIcon('paper'), /data-icon="modulePaper"[\s\S]*remix\/file-text-line\.svg/);
assert.equal(renderRailIcon('settings'), '');
assert.equal(renderRailIcon('missing'), '');

const functionNavigation = renderFunctionNavigation('knowledge');
assert.equal(getFunctionNavigationGroups().length, 5);
assert.match(functionNavigation, /data-nav-group="workbench"/);
assert.match(functionNavigation, /data-nav-group="knowledge"/);
assert.match(functionNavigation, /data-module-key="materials"/);
assert.match(functionNavigation, /data-module-key="knowledge"[^>]*aria-current="page"/);
assert.match(functionNavigation, /data-nav-item="home"[^>]*data-active="false"/);
assert.doesNotMatch(functionNavigation, /data-nav-item="home"[^>]*disabled/);
assert.match(functionNavigation, /data-nav-placeholder="create-space"[^>]*aria-disabled="true"/);
assert.match(functionNavigation, /data-icon="navKnowledge"/);
assert.doesNotMatch(functionNavigation, /data-hook=/);

console.log('ok - shell rail renderers produce stable module rail markup');
