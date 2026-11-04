import type { Folder, Note } from '@study-accelerator/web-core';

export interface DraggableEntry {
  kind: 'folder' | 'note';
  id: string;
}

export function isFolderWithin(folderId: string, ancestorId: string, folders: Record<string, Folder>): boolean {
  const visited = new Set<string>();
  let current: Folder | undefined = folders[folderId];
  while (current) {
    if (visited.has(current.id)) return true;
    if (current.id === ancestorId) return true;
    visited.add(current.id);
    current = current.parentId ? folders[current.parentId] : undefined;
  }
  return false;
}

export function canMoveEntry(
  entry: DraggableEntry,
  destinationId: string | null,
  folders: Record<string, Folder>,
  notes: Note[],
  canWrite: boolean
): boolean {
  if (!canWrite || (destinationId !== null && !folders[destinationId])) return false;
  if (entry.kind === 'folder') {
    const folder = folders[entry.id];
    return Boolean(folder)
      && (folder.parentId ?? null) !== destinationId
      && (destinationId === null || !isFolderWithin(destinationId, entry.id, folders));
  }
  const note = notes.find((item) => item.id === entry.id);
  return Boolean(note && !note.deleted && (note.folderId ?? null) !== destinationId);
}
