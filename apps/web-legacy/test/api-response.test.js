import assert from 'node:assert/strict';

import { asArray, asItems, getData } from '../src/services/api-response.js';

assert.deepEqual(asArray(['a']), ['a'], 'asArray should keep arrays');
assert.deepEqual(asArray(null), [], 'asArray should normalize missing values');

assert.deepEqual(asItems(['a', 'b']), ['a', 'b'], 'asItems should keep arrays');
assert.deepEqual(asItems({ id: 'one' }), [{ id: 'one' }], 'asItems should wrap single items');
assert.deepEqual(asItems(null), [], 'asItems should normalize missing items');

assert.deepEqual(getData({ data: { id: 'payload' } }), { id: 'payload' });
assert.equal(getData(null), undefined);

console.log('ok - api response helpers normalize service payloads');
