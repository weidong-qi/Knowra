import type { Note, Tag } from '@study-accelerator/web-core';
import { describe, expect, it } from 'vitest';
import type { NotesIndexState } from '../../store/types';
import { filterNotes, getScopeCount } from './notesIndexModel';

const notes: Note[] = [
  createNote('active', '普通笔记', 'folder-1'),
  createNote('favorite', '收藏笔记', null, { favorite: true, tagIds: ['tag-design'] }),
  createNote('deleted', '删除笔记', null, { deleted: true })
];
const tags: Tag[] = [{ id: 'tag-design', name: '设计' }];

describe('notes index filtering model', () => {
  it('derives real quick-entry counts without including deleted notes', () => {
    expect(getScopeCount('all', notes)).toBe(2);
    expect(getScopeCount('favorites', notes)).toBe(1);
    expect(getScopeCount('unfiled', notes)).toBe(1);
    expect(getScopeCount('root', notes)).toBe(1);
    expect(getScopeCount('trash', notes)).toBe(1);
  });

  it('combines folder, tag, recycle-bin, and backend text-search selections', () => {
    expect(filterNotes(notes, tags, selection({ scope: 'all' }, 'folder-1')).map((note) => note.id))
      .toEqual(['active']);
    expect(filterNotes(notes, tags, selection({ selectedTagId: 'tag-design' })).map((note) => note.id))
      .toEqual(['favorite']);
    expect(filterNotes(notes, tags, selection({ scope: 'trash' })).map((note) => note.id))
      .toEqual(['deleted']);
    expect(filterNotes(notes, tags, selection({ scope: 'root' })).map((note) => note.id))
      .toEqual(['favorite']);
    expect(filterNotes(notes, tags, selection({ query: '正文', matchingNoteIds: ['active'] })).map((note) => note.id))
      .toEqual(['active']);
    expect(filterNotes(notes, tags, selection({ query: '设计' })).map((note) => note.id))
      .toEqual(['favorite']);
  });
});

function selection(
  overrides: Partial<NotesIndexState>,
  selectedFolderId: string | null = null
) {
  return {
    selectedFolderId,
    notesIndex: {
      scope: 'all',
      selectedTagId: null,
      query: '',
      matchingNoteIds: null,
      searchState: 'idle',
      ...overrides
    } satisfies NotesIndexState
  };
}

function createNote(
  id: string,
  title: string,
  folderId: string | null,
  overrides: { favorite?: boolean; deleted?: boolean; tagIds?: string[] } = {}
): Note {
  return {
    id,
    title,
    folderId,
    tagIds: overrides.tagIds ?? [],
    internalLinks: [],
    rawMarkdown: '',
    contentLoaded: false,
    favorite: overrides.favorite ?? false,
    deleted: overrides.deleted ?? false,
    updatedAt: '2026-08-23T08:00:00.000Z'
  };
}
