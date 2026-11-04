export function captureScrollPosition(positions, noteId, scrollTop) {
  if (noteId && typeof scrollTop === 'number' && scrollTop > 0) {
    positions[noteId] = scrollTop;
  }
}

export function getSavedScrollTop(positions, noteId) {
  const saved = positions[noteId];
  return typeof saved === 'number' && saved > 0 ? saved : null;
}

export function readScrollPositions(storage, key) {
  try {
    const raw = storage?.getItem(key);
    if (!raw) {
      return {};
    }

    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (error) {
    return {};
  }
}

export function writeScrollPositions(storage, key, positions) {
  try {
    storage?.setItem(key, JSON.stringify(positions));
  } catch (error) {
    // Ignore cache failures.
  }
}
