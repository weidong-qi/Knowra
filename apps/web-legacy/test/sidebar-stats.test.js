import assert from 'node:assert/strict';
import { getNoteStats } from '../lib/sidebar/stats.js';

assert.deepEqual(getNoteStats('# 标题\n\n正文 **加粗** `code`\n\n[链接](https://example.com)'), {
  characterCount: 6
});

assert.deepEqual(getNoteStats(null), {
  characterCount: 0
});

console.log('ok - sidebar stats count readable note characters');
