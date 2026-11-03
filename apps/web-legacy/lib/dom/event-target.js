export function getEventTargetElement(target) {
  if (isElementLike(target)) {
    return target;
  }

  if (isNodeLike(target)) {
    return target.parentElement;
  }

  return null;
}

export function closestFromEventTarget(target, selector) {
  return getEventTargetElement(target)?.closest(selector) ?? null;
}

function isElementLike(target) {
  return Boolean(target && typeof target.closest === 'function');
}

function isNodeLike(target) {
  return Boolean(target && typeof target === 'object' && 'parentElement' in target);
}
