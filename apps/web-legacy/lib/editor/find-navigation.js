export function resolveMatchNavigationIndex({
  currentIndex = -1,
  matchCount = 0,
  direction = 'next'
} = {}) {
  if (!Number.isInteger(matchCount) || matchCount <= 0) {
    return -1;
  }

  if (direction === 'previous') {
    if (currentIndex < 0) {
      return matchCount - 1;
    }
    return (currentIndex - 1 + matchCount) % matchCount;
  }

  if (currentIndex < 0) {
    return 0;
  }
  return (currentIndex + 1) % matchCount;
}

export function resolveEditorPanelKeyboardAction({
  key,
  shiftKey = false,
  altKey = false,
  ctrlKey = false,
  metaKey = false,
  isComposing = false,
  keyCode = 0
} = {}) {
  if (isComposing || keyCode === 229) {
    return null;
  }

  if (ctrlKey || metaKey || altKey) {
    return null;
  }

  if (key === 'F3' && !shiftKey) {
    return 'next';
  }
  if (key === 'F3' && shiftKey) {
    return 'previous';
  }

  return null;
}
