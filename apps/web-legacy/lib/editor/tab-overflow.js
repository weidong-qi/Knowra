export function resolveTabCapacity({
  containerWidth,
  minimumTabWidth,
  overflowControlWidth,
  tabCount
}) {
  if (tabCount <= 1 || !isPositiveNumber(containerWidth) || !isPositiveNumber(minimumTabWidth)) {
    return tabCount;
  }

  const fullCapacity = Math.floor(containerWidth / minimumTabWidth);
  if (fullCapacity >= tabCount) {
    return tabCount;
  }

  const reservedWidth = isPositiveNumber(overflowControlWidth) ? overflowControlWidth : minimumTabWidth;
  return Math.max(1, Math.floor((containerWidth - reservedWidth) / minimumTabWidth));
}

export function partitionTabsForOverflow(notes = [], selectedNoteId = null, capacity = notes.length) {
  const visibleCount = Math.max(0, Math.min(notes.length, capacity));
  if (visibleCount >= notes.length) {
    return { visibleNotes: notes, overflowNotes: [] };
  }

  const visibleNotes = notes.slice(0, visibleCount);
  const selectedNote = notes.find((note) => note.id === selectedNoteId);
  if (selectedNote && !visibleNotes.some((note) => note.id === selectedNote.id) && visibleNotes.length) {
    visibleNotes[visibleNotes.length - 1] = selectedNote;
  }

  const visibleIds = new Set(visibleNotes.map((note) => note.id));
  return {
    visibleNotes,
    overflowNotes: notes.filter((note) => !visibleIds.has(note.id))
  };
}

function isPositiveNumber(value) {
  return Number.isFinite(value) && value > 0;
}
