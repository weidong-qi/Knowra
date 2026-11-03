import assert from 'node:assert/strict';
import { getSaveStateLabel } from '../lib/editor/save-indicator.js';

const formatDate = (value) => `formatted:${value}`;

assert.equal(getSaveStateLabel({ saveState: 'idle', formatDate }), '实时编辑');
assert.equal(getSaveStateLabel({ saveState: 'pending', formatDate }), '待保存');
assert.equal(getSaveStateLabel({ saveState: 'saving', formatDate }), '保存中...');
assert.equal(getSaveStateLabel({ saveState: 'saved', formatDate }), '已保存');
assert.equal(
  getSaveStateLabel({ saveState: 'saved', lastSavedAt: '2026-06-24T10:00:00Z', formatDate }),
  '已保存 formatted:2026-06-24T10:00:00Z'
);
assert.equal(getSaveStateLabel({ saveState: 'error', formatDate }), '保存失败');

console.log('ok - save indicator labels map save state to user-facing text');
