import assert from 'node:assert/strict';

export const markdownPreviewTests = [
  {
    name: 'renderMarkdownPreview renders headings, emphasis, lists and code blocks',
    async run() {
      const { renderMarkdownPreview } = await import('../src/presentation/markdown-preview.ts');

      const html = renderMarkdownPreview(`# Title

Hello **world** and *team*.

- one
- two

\`\`\`
const x = 1;
\`\`\``);

      assert.match(html, /<h1 id="title">Title<\/h1>/);
      assert.match(html, /<strong>world<\/strong>/);
      assert.match(html, /<em>team<\/em>/);
      assert.match(html, /<ul><li>one<\/li><li>two<\/li><\/ul>/);
      assert.match(html, /<pre><code>const x = 1;<\/code><\/pre>/);
    }
  },
  {
    name: 'extractMarkdownHeadings returns toc entries with ids',
    async run() {
      const { extractMarkdownHeadings } = await import('../src/presentation/markdown-preview.ts');

      const headings = extractMarkdownHeadings(`# Root
## Child One
Text
### Child Two`);

      assert.deepEqual(headings, [
        { level: 1, title: 'Root', id: 'root' },
        { level: 2, title: 'Child One', id: 'child-one' },
        { level: 3, title: 'Child Two', id: 'child-two' }
      ]);
    }
  },
  {
    name: 'renderMarkdownPreview escapes raw html',
    async run() {
      const { renderMarkdownPreview } = await import('../src/presentation/markdown-preview.ts');

      const html = renderMarkdownPreview('<script>alert(1)</script>');

      assert.doesNotMatch(html, /<script>/);
      assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
    }
  },
  {
    name: 'renderMarkdownPreview renders markdown image references',
    async run() {
      const { renderMarkdownPreview } = await import('../src/presentation/markdown-preview.ts');

      const html = renderMarkdownPreview('![diagram](/api/storage/attachments/a/content)');

      assert.match(html, /<img src="\/api\/storage\/attachments\/a\/content" alt="diagram" \/>/);
    }
  },
  {
    name: 'renderMarkdownPreview never emits an HTTP image request',
    async run() {
      const { renderMarkdownPreview } = await import('../src/presentation/markdown-preview.ts');
      const html = renderMarkdownPreview('![legacy](http://example.com/legacy.png)');

      assert.match(html, /preview-blocked-image/);
      assert.doesNotMatch(html, /<img[^>]+http:\/\//i);
    }
  }
];
