import assert from 'node:assert/strict';
import { renderAnnotationPanel } from '../lib/sidebar/annotation-panel.js';

const markup = renderAnnotationPanel([
  {
    id: 'annotation-1" autofocus onfocus="globalThis.compromised=true',
    quoteText: '<img src=x onerror="globalThis.compromised=true">',
    status: 'active'
  }
]);

assert.doesNotMatch(markup, /<img/i);
assert.doesNotMatch(markup, /\sonfocus="/i);
assert.doesNotMatch(markup, /data-annotation-id="[^"]*"\s+autofocus/i);
assert.match(markup, /&lt;img src=x onerror=&quot;globalThis\.compromised=true&quot;&gt;/);
assert.match(markup, /annotation-1&quot; autofocus onfocus=&quot;globalThis\.compromised=true/);

assert.equal(
  renderAnnotationPanel([{ id: 'archived', quoteText: 'hidden', status: 'archived' }]),
  '<div class="aside-empty">暂无重要内容标注</div>'
);

console.log('ok - annotation panel escapes persisted text and attribute values');
