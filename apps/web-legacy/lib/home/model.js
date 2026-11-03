const HOME_RECENT_LIMIT = 5;

export function selectHomeRecentNotes(state, limit = HOME_RECENT_LIMIT) {
  return (state?.allNotes ?? [])
    .filter((note) => !note.deleted)
    .sort(compareUpdatedNotes)
    .slice(0, limit);
}

export function selectHomeSummary(state, recentNotes = selectHomeRecentNotes(state)) {
  const notes = state?.allNotes ?? [];
  return {
    noteCount: notes.filter((note) => !note.deleted).length,
    folderCount: Object.keys(state?.foldersById ?? {}).length,
    recentCount: recentNotes.length,
    isLoading: state?.dataMode === 'loading' && notes.length === 0
  };
}

function compareUpdatedNotes(left, right) {
  const updatedDelta = toTimestamp(right?.updatedAt) - toTimestamp(left?.updatedAt);
  if (updatedDelta !== 0) return updatedDelta;
  return toTimestamp(right?.createdAt) - toTimestamp(left?.createdAt);
}

function toTimestamp(value) {
  const timestamp = new Date(value ?? 0).getTime();
  return Number.isNaN(timestamp) ? 0 : timestamp;
}
