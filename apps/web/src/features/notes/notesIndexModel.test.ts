import type { Folder, Note, Tag } from '@study-accelerator/web-core';
import { describe, expect, it } from 'vitest';
import type { NotesIndexState } from '../../store/types';
import { filterNotes, folderRecentActivity, getScopeCount } from './notesIndexModel';

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

describe('folderRecentActivity', () => {
  const folder: Folder = {
    id: 'root',
    name: '根',
    parentId: null,
    updatedAt: '2026-01-01T00:00:00.000Z',
    children: [{ id: 'child', name: '子', parentId: 'root', children: [] }]
  };
  const at = (id: string, title: string, folderId: string, updatedAt: string, deleted = false): Note => ({
    ...createNote(id, title, folderId, { deleted }),
    updatedAt
  });

  it('按更新时间取最近的标题，包含子文件夹，忽略回收站内容', () => {
    const result = folderRecentActivity(
      folder,
      [
        at('a', '较早', 'root', '2026-02-01T00:00:00.000Z'),
        at('b', '最新', 'child', '2026-03-01T00:00:00.000Z'),
        at('c', '已删除', 'root', '2026-04-01T00:00:00.000Z', true),
        at('d', '别处', 'other', '2026-05-01T00:00:00.000Z'),
        at('e', '  ', 'root', '2026-01-15T00:00:00.000Z')
      ],
      2
    );
    expect(result.titles).toEqual(['最新', '较早']);
    expect(result.updatedAt).toBe('2026-03-01T00:00:00.000Z');
  });

  it('没有内容时回退到文件夹自己的更新时间', () => {
    expect(folderRecentActivity(folder, [])).toEqual({ titles: [], updatedAt: '2026-01-01T00:00:00.000Z' });
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
