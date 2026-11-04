import assert from 'node:assert/strict';
import { createRequiredDependencyGetter } from '../../src/controllers/controller-utils.js';

const get = createRequiredDependencyGetter({ renderAll: () => 'ok' }, 'test-controller');

assert.equal(get('renderAll')(), 'ok');
assert.throws(
  () => get('missingDep'),
  /test-controller missing dependency: missingDep/
);

console.log('controller-utils tests passed');
