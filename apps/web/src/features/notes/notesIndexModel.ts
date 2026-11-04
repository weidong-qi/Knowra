import type { Folder, Note, Tag } from '@study-accelerator/web-core';
import type { NotesIndexScope, NotesIndexState } from '../../store/types';

export const RECENT_NOTE_LIMIT = 6;
export const NOTES_SEARCH_DEBOUNCE_MS = 220;

export interface NotesIndexSelection {
  notesIndex: NotesIndexState;
  selectedFolderId: string | null;
}

export function getScopeCount(scope: NotesIndexScope, notes: Note[]): number {
  const activeNotes = notes.filter((note) => !note.deleted);
  switch (scope) {
    case 'recent': return Math.min(activeNotes.length, RECENT_NOTE_LIMIT);
    case 'favorites': return activeNotes.filter((note) => note.favorite).length;
    case 'unfiled': return activeNotes.filter((note) => !note.folderId).length;
    case 'root': return activeNotes.filter((note) => !note.folderId).length;
    case 'trash': return notes.filter((note) => note.deleted).length;
    default: return activeNotes.length;
  }
}

export function filterNotes(
  notes: Note[],
  tags: Tag[],
  selection: NotesIndexSelection
): Note[] {
  const { notesIndex, selectedFolderId } = selection;
  let visible = notes.filter((note) => notesIndex.scope === 'trash' ? note.deleted : !note.deleted);

  if (notesIndex.scope === 'favorites') visible = visible.filter((note) => note.favorite);
  if (notesIndex.scope === 'unfiled') visible = visible.filter((note) => !note.folderId);
  if (notesIndex.scope === 'root') visible = visible.filter((note) => !note.folderId);
  if (selectedFolderId) visible = visible.filter((note) => note.folderId === selectedFolderId);
  if (notesIndex.selectedTagId) {
    visible = visible.filter((note) => note.tagIds.includes(notesIndex.selectedTagId as string));
  }

  const query = notesIndex.query.trim().toLocaleLowerCase();
  if (query) {
    const matchingIds = new Set(notesIndex.matchingNoteIds ?? []);
    const matchingTagIds = new Set(tags
      .filter((tag) => tag.name?.toLocaleLowerCase().includes(query))
      .map((tag) => tag.id));
    visible = visible.filter((note) => (
      matchingIds.has(note.id)
      || note.title.toLocaleLowerCase().includes(query)
      || note.tagIds.some((tagId) => matchingTagIds.has(tagId))
      || getSummary(note).includes(query)
    ));
  }

  visible = [...visible].sort(compareUpdatedDescending);
  return notesIndex.scope === 'recent' ? visible.slice(0, RECENT_NOTE_LIMIT) : visible;
}

export function countFolderNotes(folder: Folder, notes: Note[]): number {
  const folderIds = new Set<string>();
  collectFolderIds(folder, folderIds);
  return notes.filter((note) => !note.deleted && note.folderId && folderIds.has(note.folderId)).length;
}

export function folderMatchesQuery(folder: Folder, notes: Note[], query: string): boolean {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (!normalizedQuery) return true;
  if (folder.name.toLocaleLowerCase().includes(normalizedQuery)) return true;
  const folderIds = new Set<string>();
  collectFolderIds(folder, folderIds);
  return notes.some((note) => (
    !note.deleted
    && Boolean(note.folderId && folderIds.has(note.folderId))
    && note.title.toLocaleLowerCase().includes(normalizedQuery)
  ));
}

export function compareUpdatedDescending(left: Note, right: Note): number {
  return toTimestamp(right.updatedAt) - toTimestamp(left.updatedAt);
}

export function formatUpdatedAt(value?: string): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  }).format(date);
}

function collectFolderIds(folder: Folder, target: Set<string>) {
  target.add(folder.id);
  folder.children.forEach((child) => collectFolderIds(child, target));
}

function getSummary(note: Note): string {
  const summary = note.summary;
  return typeof summary === 'string' ? summary.toLocaleLowerCase() : '';
}

function toTimestamp(value?: string): number {
  if (!value) return 0;
  const timestamp = new Date(value).getTime();
  return Number.isNaN(timestamp) ? 0 : timestamp;
}
