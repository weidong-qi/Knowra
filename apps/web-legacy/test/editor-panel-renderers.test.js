import assert from 'node:assert/strict';
import {
  getEditorPanelStatusText,
  renderEditorPanelMarkup
} from '../lib/editor/editor-panel-renderers.js';

const findPanel = {
  mode: 'find',
  query: '<needle>',
  replacement: '',
  matchCount: 0
};

assert.equal(getEditorPanelStatusText({ query: '', matchCount: 0 }), '输入内容后开始查找');
assert.equal(getEditorPanelStatusText({ query: 'alpha', matchCount: 0 }), '未找到匹配项');
assert.equal(getEditorPanelStatusText({ query: 'alpha', matchCount: 2 }), '已找到 2 处');

const findHtml = renderEditorPanelMarkup(findPanel);
assert.match(findHtml, /editor-utility-panel-title[\s\S]*查找/);
assert.match(findHtml, /value="&lt;needle&gt;"/);
assert.match(findHtml, /data-editor-panel-action="submit-previous"[\s\S]*查找上一个/);
assert.match(findHtml, /F3 下一个，Shift\+F3 上一个/);
assert.doesNotMatch(findHtml, /data-panel-field="replacement"/);
assert.doesNotMatch(findHtml, /data-editor-panel-action="replace-all"/);

const replaceHtml = renderEditorPanelMarkup({
  mode: 'replace',
  query: 'alpha',
  replacement: '"beta"',
  matchCount: 3
});
assert.match(replaceHtml, /editor-utility-panel-title[\s\S]*替换/);
assert.match(replaceHtml, /data-panel-field="replacement"[\s\S]*value="&quot;beta&quot;"/);
assert.match(replaceHtml, /data-editor-panel-action="replace-all"[\s\S]*全部替换/);
assert.match(replaceHtml, /data-editor-panel-action="submit"[\s\S]*替换一次/);
assert.doesNotMatch(replaceHtml, /submit-previous/);

console.log('ok - editor panel renderers build find and replace panel markup');
