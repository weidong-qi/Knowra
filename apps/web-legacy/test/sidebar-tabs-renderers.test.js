import assert from 'node:assert/strict';
import { renderAsideTabs } from '../lib/sidebar/renderers.js';

const html = renderAsideTabs({
  tabs: [
    { key: 'info', label: '<信息>' },
    { key: 'outline', label: '大纲' }
  ],
  activeKey: 'outline'
});

assert.match(html, /data-aside-tab="info"/);
assert.match(html, /data-active="false"/);
assert.match(html, /data-aside-tab="outline"[\s\S]*data-active="true"/);
assert.match(html, /&lt;信息&gt;/);

console.log('ok - sidebar tabs renderer marks the active tab and escapes labels');
