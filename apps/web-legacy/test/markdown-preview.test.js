import assert from 'node:assert/strict';
import { renderMarkdownPreview } from '../lib/markdown.js';

const dividerHtml = renderMarkdownPreview('***');
assert.match(
  dividerHtml,
  /<hr ?\/?>/,
  'markdown thematic breaks should render as <hr> in read mode instead of literal ***'
);

const lineBreakHtml = renderMarkdownPreview('第一行<br />第二行');
assert.doesNotMatch(
  lineBreakHtml,
  /&lt;br ?\/?&gt;/i,
  'allowed inline <br /> tags should not leak as escaped source text in read mode'
);
assert.match(
  lineBreakHtml,
  /第一行<br ?\/?>第二行/i,
  'allowed inline <br /> tags should render as line breaks in read mode'
);

const hardBreakHtml = renderMarkdownPreview('**Abstract 摘要**\\\n摘要浓缩了整篇论文的研究背景。');
assert.doesNotMatch(
  hardBreakHtml,
  /\\<\/?(strong|p)|\\$/,
  'markdown hard line breaks should not leak a visible backslash into read mode'
);
assert.match(
  hardBreakHtml,
  /<strong>Abstract 摘要<\/strong><br ?\/?>摘要浓缩了整篇论文的研究背景。/,
  'markdown hard line breaks should render as <br /> after inline formatting'
);

const tableHtml = renderMarkdownPreview(`| 列1 | 列2 |
| --- | --- |
| A | B |
| C | D |`);
assert.match(tableHtml, /<table>/, 'markdown tables should render a table wrapper');
assert.match(tableHtml, /<thead>/, 'markdown tables should render table headers');
assert.match(tableHtml, /<tbody>/, 'markdown tables should render table bodies');
assert.match(tableHtml, /<th>列1<\/th>/, 'markdown tables should render header cells');
assert.match(tableHtml, /<td>A<\/td>/, 'markdown tables should render body cells');

const blockedHttpImage = renderMarkdownPreview('![legacy](http://example.com/legacy.png)');
assert.match(blockedHttpImage, /preview-blocked-image/);
assert.doesNotMatch(blockedHttpImage, /<img[^>]+http:\/\//i);

console.log('ok - markdown preview renders reading-mode structures');
