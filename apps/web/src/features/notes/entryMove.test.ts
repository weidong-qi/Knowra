import { describe, expect, it } from 'vitest';
import type { Folder, Note } from '@study-accelerator/web-core';
import { canMoveEntry, isFolderWithin } from './entryMove';

const folders = {
  a: { id: 'a', name: '甲', parentId: null, children: [] },
  b: { id: 'b', name: '乙', parentId: 'a', children: [] },
  c: { id: 'c', name: '丙', parentId: null, children: [] }
} as Record<string, Folder>;
const notes = [
  { id: 'note', folderId: 'a', deleted: false },
  { id: 'deleted', folderId: 'a', deleted: true }
] as Note[];

describe('目录拖放目标', () => {
  it('allows moving a note between folders and back to the library root', () => {
    expect(canMoveEntry({ kind: 'note', id: 'note' }, 'c', folders, notes, true)).toBe(true);
    expect(canMoveEntry({ kind: 'note', id: 'note' }, null, folders, notes, true)).toBe(true);
    expect(canMoveEntry({ kind: 'note', id: 'note' }, 'a', folders, notes, true)).toBe(false);
  });

  it('rejects a folder itself, its descendant, the same parent, and missing targets', () => {
    expect(isFolderWithin('b', 'a', folders)).toBe(true);
    expect(canMoveEntry({ kind: 'folder', id: 'a' }, 'a', folders, notes, true)).toBe(false);
    expect(canMoveEntry({ kind: 'folder', id: 'a' }, 'b', folders, notes, true)).toBe(false);
    expect(canMoveEntry({ kind: 'folder', id: 'a' }, null, folders, notes, true)).toBe(false);
    expect(canMoveEntry({ kind: 'folder', id: 'a' }, 'missing', folders, notes, true)).toBe(false);
    expect(canMoveEntry({ kind: 'folder', id: 'b' }, 'c', folders, notes, true)).toBe(true);
  });

  it('does not move deleted entries or entries while the workspace is read-only', () => {
    expect(canMoveEntry({ kind: 'note', id: 'deleted' }, 'c', folders, notes, true)).toBe(false);
    expect(canMoveEntry({ kind: 'note', id: 'note' }, 'c', folders, notes, false)).toBe(false);
  });
});
