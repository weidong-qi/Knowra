import assert from 'node:assert/strict';
import fs from 'node:fs';

import { createCodeBlockComponentConfig } from '../lib/editor/milkdown/host/code-block-component-config.js';

const config = createCodeBlockComponentConfig();
assert.equal(config.copyText, '复制');
assert.equal(config.searchPlaceholder, '搜索语言');
assert.equal(config.noResultText, '暂无可用语言');
assert.ok(Array.isArray(config.extensions));
assert.ok(Array.isArray(config.languages));
assert.equal(
  config.extensions.length,
  1,
  'the official CodeMirror component should preserve Tab indentation through its extension API'
);

const factorySource = fs.readFileSync(
  new URL('../lib/editor/milkdown/host/editor-factory.js', import.meta.url),
  'utf8'
);
assert.match(
  factorySource,
  /\.use\(codeBlockComponent\)/,
  'the editor should use Milkdown official code block component'
);
assert.doesNotMatch(
  factorySource,
  /codeBlockInputBehavior|composition(start|update|end)|handleTextInput/,
  'the editor factory should not install a parallel code-block input pipeline'
);

console.log('ok - code blocks reuse the official Milkdown component without custom IME handlers');
