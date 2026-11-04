import assert from 'node:assert/strict';
import {
  normalizeTableDialogValue,
  renderTableInsertDialogMarkup
} from '../lib/editor/table-dialog-renderers.js';

assert.equal(normalizeTableDialogValue('7', 4), 7);
assert.equal(normalizeTableDialogValue('0', 4), 1);
assert.equal(normalizeTableDialogValue('99', 4), 20);
assert.equal(normalizeTableDialogValue('not-number', 4), 4);

const html = renderTableInsertDialogMarkup({
  rows: '2',
  cols: '"3"'
});

assert.match(html, /editor-table-dialog-backdrop[\s\S]*data-editor-table-dialog-action="cancel"/);
assert.match(html, /editor-table-dialog-title[\s\S]*插入表格/);
assert.match(html, /data-table-dialog-field="rows"[\s\S]*value="2"/);
assert.match(html, /data-table-dialog-field="cols"[\s\S]*value="&quot;3&quot;"/);
assert.match(html, /data-editor-table-dialog-action="confirm"[\s\S]*确定/);

console.log('ok - table dialog renderers normalize values and build dialog markup');
