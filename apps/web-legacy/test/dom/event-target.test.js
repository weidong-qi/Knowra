import assert from 'node:assert/strict';

import {
  closestFromEventTarget,
  getEventTargetElement
} from '../../lib/dom/event-target.js';

function makeElement() {
  return {
    closest(selector) {
      return selector === '[data-hit]' ? this : null;
    }
  };
}

const element = makeElement();
const textNodeTarget = { parentElement: element };

assert.equal(
  getEventTargetElement(element),
  element,
  'element targets should be returned as-is'
);
assert.equal(
  getEventTargetElement(textNodeTarget),
  element,
  'text-node-like targets should resolve to parentElement'
);
assert.equal(
  closestFromEventTarget(textNodeTarget, '[data-hit]'),
  element,
  'closestFromEventTarget should support text-node-like event targets'
);
assert.equal(
  closestFromEventTarget(null, '[data-hit]'),
  null,
  'closestFromEventTarget should safely ignore missing targets'
);

console.log('ok - event target helpers normalize text-node-like targets');
