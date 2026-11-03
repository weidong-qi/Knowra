import assert from 'node:assert/strict';
import { Fragment, Schema, Slice } from '@milkdown/kit/prose/model';
import {
  looksLikeMarkdown,
  removeSpuriousEmptyCodeBlocks,
  shouldPreferPlainMarkdown,
  stripPastedInlineStyles
} from '../lib/editor/markdown-paste.js';

const fencedMarkdown = `# Self-Attention

CNN 的卷积是局部操作：

\`\`\`
一个卷积核主要看附近几个像素
\`\`\``;

assert.equal(looksLikeMarkdown(fencedMarkdown), true);
assert.equal(
  shouldPreferPlainMarkdown({
    text: fencedMarkdown,
    html: '<h1>Self-Attention</h1><pre><code>一个卷积核主要看附近几个像素</code></pre>',
    vscodeData: ''
  }),
  true,
  'Markdown-looking plain text must win even when the clipboard also contains HTML'
);
assert.equal(
  shouldPreferPlainMarkdown({ text: '普通的一句话', html: '<strong>普通的一句话</strong>', vscodeData: '' }),
  false,
  'ordinary rich text should continue through the HTML clipboard path'
);
assert.equal(
  shouldPreferPlainMarkdown({ text: fencedMarkdown, vscodeData: '{"mode":"javascript"}' }),
  false,
  'VS Code clipboard metadata should keep its language-aware code paste behavior'
);

const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: { content: 'text*', group: 'block' },
    code_block: { content: 'text*', group: 'block', code: true },
    text: { group: 'inline' }
  }
});
const paragraph = schema.nodes.paragraph.create(null, schema.text('before'));
const emptyCode = schema.nodes.code_block.create();
const filledCode = schema.nodes.code_block.create(null, schema.text('const answer = 42;'));
const originalSlice = new Slice(Fragment.fromArray([paragraph, emptyCode, filledCode]), 0, 0);
const cleanedSlice = removeSpuriousEmptyCodeBlocks(originalSlice);

assert.equal(cleanedSlice.content.childCount, 2);
assert.equal(cleanedSlice.content.child(0).type.name, 'paragraph');
assert.equal(cleanedSlice.content.child(1).textContent, 'const answer = 42;');
assert.equal(
  removeSpuriousEmptyCodeBlocks(new Slice(Fragment.fromArray([emptyCode, paragraph]), 0, 0)).content.childCount,
  2,
  'an intentional empty code block must remain when it is not followed by a populated code block'
);

// --- stripPastedInlineStyles ---
// Node test environment: no DOMParser, the function must be a no-op.
assert.equal(
  stripPastedInlineStyles('<p style="color: red">hi</p>'),
  '<p style="color: red">hi</p>',
  'without DOMParser the input HTML is returned unchanged'
);
assert.equal(stripPastedInlineStyles(''), '', 'empty string is a no-op');
assert.equal(stripPastedInlineStyles(null), null, 'non-string is returned as-is');

// When run under a browser-like environment, a real DOMParser is used.
if (typeof globalThis.DOMParser !== 'undefined') {
  const before = '<p>plain <span style="background: rgba(245, 243, 255); color: rgb(64, 65, 168);">关键词</span> rest</p>';
  const after = stripPastedInlineStyles(before);
  assert.equal(after.includes('style='), false, 'inline style must be stripped');
  assert.equal(after.includes('关键词'), true, 'text content must be preserved');
  assert.equal(after.includes('plain'), true, 'sibling text must be preserved');
  assert.equal(after.includes('rest'), true, 'trailing text must be preserved');
} else {
  console.log('ok - stripPastedInlineStyles (no DOMParser available, skipped browser-level assertions)');
}

console.log('ok - Markdown clipboard text is preferred over rich HTML when appropriate');
