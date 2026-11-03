import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractMarkdownHeadings, renderMarkdownPreview } from '../lib/markdown.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const outlineControllerJs = fs.readFileSync(path.resolve(__dirname, '../src/controllers/sidebar/outline-controller.js'), 'utf8');
const outlinePanelJs = fs.readFileSync(path.resolve(__dirname, '../lib/sidebar/outline-panel.js'), 'utf8');

const headings = extractMarkdownHeadings(`# 一级
## 二级
### 三级
#### 四级
##### 五级
###### 六级`);

assert.deepEqual(
  headings.map((heading) => heading.level),
  [1, 2, 3, 4],
  'outline extraction should expose only the supported H1 through H4 hierarchy'
);

const duplicateHeadings = extractMarkdownHeadings(`# 重复标题
## 重复标题
### 重复标题`);

assert.equal(
  new Set(duplicateHeadings.map((heading) => heading.id)).size,
  duplicateHeadings.length,
  'outline extraction should generate unique anchor ids even when headings reuse the same title'
);

const previewHtml = renderMarkdownPreview(`#### 四级标题

##### 五级标题

###### 六级标题`);

assert.match(
  previewHtml,
  /<h4 id="[^"]+">四级标题<\/h4>/,
  'markdown preview should render H4 headings with anchor ids for outline jumps'
);
assert.match(
  previewHtml,
  /<h5 id="[^"]+">五级标题<\/h5>/,
  'markdown preview should preserve legacy H5 content without exposing a creation control'
);
assert.match(
  previewHtml,
  /<h6 id="[^"]+">六级标题<\/h6>/,
  'markdown preview should preserve legacy H6 content without exposing a creation control'
);

assert.match(
  outlinePanelJs,
  /data-outline-index="\$\{heading\.index\}"/,
  'outline items should keep their heading order so rich editor jumps can fall back to DOM heading position'
);
assert.match(
  outlinePanelJs,
  /data-outline-toggle-id="\$\{escapeAttribute\(heading\.id\)\}"/,
  'outline items with child headings should expose a dedicated collapse toggle'
);
assert.match(
  outlineControllerJs,
  /querySelectorAll\('h1, h2, h3, h4'\)/,
  'outline click handling should inspect only the supported H1-H4 elements'
);

console.log('ok - V1.4.3 outline navigation supports full heading ranges and stable jumps');
