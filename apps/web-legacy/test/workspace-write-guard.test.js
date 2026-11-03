import assert from 'node:assert/strict';
import {
  guardWorkspaceWrite,
  isWorkspaceWritable
} from '../lib/workspace-write-guard.js';

assert.equal(isWorkspaceWritable('api'), true);
assert.equal(isWorkspaceWritable('local'), true);
assert.equal(isWorkspaceWritable('cache'), false);
assert.equal(isWorkspaceWritable('loading'), false);

{
  const messages = [];
  assert.equal(guardWorkspaceWrite({
    dataMode: 'cache',
    flashStatus: (message) => messages.push(message)
  }), false);
  assert.deepEqual(messages, ['当前显示的是只读缓存，请在后端恢复后刷新页面再修改']);
}

{
  const messages = [];
  assert.equal(guardWorkspaceWrite({
    dataMode: 'local',
    flashStatus: (message) => messages.push(message)
  }), true);
  assert.deepEqual(messages, []);
}

console.log('ok - workspace write guard keeps cache/loading read-only and local mock writable');
