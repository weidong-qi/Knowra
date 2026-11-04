import assert from 'node:assert/strict';
import { resolveAnnotationRange } from '../lib/editor/milkdown/plugins/annotation-highlight-plugin.js';

function createDocument({ size = 12, text = '重点文本', position = 2 } = {}) {
  let directReadCount = 0;
  return {
    content: { size },
    get directReadCount() {
      return directReadCount;
    },
    textBetween(from, to) {
      directReadCount += 1;
      if (from < 0 || to > size) {
        throw new Error('out-of-bounds textBetween call');
      }
      return text;
    },
    descendants(callback) {
      callback({ isText: true, text }, position);
    }
  };
}

const staleDocument = createDocument();
assert.deepEqual(
  resolveAnnotationRange(staleDocument, {
    quoteText: '重点文本',
    fromPosition: 3,
    toPosition: 99
  }),
  { from: 2, to: 6 },
  'stale annotation positions should fall back to a unique text match'
);
assert.equal(
  staleDocument.directReadCount,
  0,
  'out-of-bounds annotation positions must never reach doc.textBetween'
);

const missingDocument = createDocument({ text: '其他文本' });
assert.equal(
  resolveAnnotationRange(missingDocument, {
    quoteText: '已删除的重点文本',
    fromPosition: 3,
    toPosition: 99
  }),
  null,
  'a deleted annotation quote should resolve to no decoration without throwing'
);

const directDocument = createDocument({ size: 20, text: '重点文本' });
assert.deepEqual(
  resolveAnnotationRange(directDocument, {
    quoteText: '重点文本',
    fromPosition: 2,
    toPosition: 6
  }),
  { from: 2, to: 6 },
  'a valid stored range should remain the primary resolution path'
);
assert.equal(directDocument.directReadCount, 1);

console.log('ok - annotation ranges ignore stale positions and survive quote deletion');
