import assert from 'node:assert/strict';
import { escapeAttribute, escapeHtml, formatDate } from '../../src/app/formatting.js';

assert.equal(formatDate(null), '-');
assert.notEqual(formatDate('2026-06-27T10:00:00Z'), '-');
assert.equal(
  escapeHtml(`<button data-x="1">'&</button>`),
  '&lt;button data-x=&quot;1&quot;&gt;&#39;&amp;&lt;/button&gt;'
);
assert.equal(
  escapeAttribute(`<value "quoted" & raw>`),
  '&lt;value &quot;quoted&quot; &amp; raw&gt;'
);

console.log('formatting tests passed');
