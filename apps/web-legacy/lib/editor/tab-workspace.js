function uniqueTabList(openTabs) {
  return [...new Set((openTabs ?? []).filter(Boolean))];
}

export function ensureOpenTab(openTabs, noteId) {
  const nextTabs = uniqueTabList(openTabs);
  if (!noteId || nextTabs.includes(noteId)) {
    return nextTabs;
  }
  return [...nextTabs, noteId];
}

export function closeTab(openTabs, noteId, activeId) {
  const nextTabs = uniqueTabList(openTabs);
  const index = nextTabs.indexOf(noteId);
  if (index === -1) {
    return { openTabs: nextTabs, nextActiveId: activeId ?? null };
  }

  const remainingTabs = nextTabs.filter((tabId) => tabId !== noteId);
  if (activeId !== noteId) {
    return { openTabs: remainingTabs, nextActiveId: activeId ?? remainingTabs[0] ?? null };
  }

  const fallbackTab = remainingTabs[index] ?? remainingTabs[index - 1] ?? null;
  return { openTabs: remainingTabs, nextActiveId: fallbackTab };
}

export function closeOtherTabs(openTabs, noteId) {
  if (!noteId) {
    return { openTabs: [], nextActiveId: null };
  }

  const nextTabs = uniqueTabList(openTabs);
  if (!nextTabs.includes(noteId)) {
    return { openTabs: [noteId], nextActiveId: noteId };
  }

  return { openTabs: [noteId], nextActiveId: noteId };
}

export function reorderTabs(openTabs, draggedId, targetId) {
  const nextTabs = uniqueTabList(openTabs);
  const fromIndex = nextTabs.indexOf(draggedId);
  const toIndex = nextTabs.indexOf(targetId);

  if (fromIndex === -1 || toIndex === -1 || fromIndex === toIndex) {
    return nextTabs;
  }

  const reordered = [...nextTabs];
  const [draggedTab] = reordered.splice(fromIndex, 1);
  reordered.splice(toIndex, 0, draggedTab);
  return reordered;
}

export function buildNoteTabPath(note, foldersById) {
  if (!note) {
    return '';
  }

  const segments = [];
  let cursor = note.folderId ? foldersById?.[note.folderId] ?? null : null;
  while (cursor) {
    segments.unshift(cursor.name);
    cursor = cursor.parentId ? foldersById?.[cursor.parentId] ?? null : null;
  }

  segments.push(note.title);
  return segments.join(' / ');
}
