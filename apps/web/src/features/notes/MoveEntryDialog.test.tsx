import { describe, expect, it } from 'vitest';
import type { Folder } from '@study-accelerator/web-core';
import { moveDestinations } from './MoveEntryDialog';

describe('移动目录可选范围', () => {
  const folder = (id: string, parentId: string | null): Folder => ({ id, parentId, name: id, spaceId: 's', children: [] });
  const folders = { a: folder('a', null), b: folder('b', 'a'), c: folder('c', 'b'), d: folder('d', null) };
  it('文件夹不能移动到自身及任意层级子目录', () => {
    expect(moveDestinations(folders, { kind: 'folder', id: 'a', name: 'a' }).map(item => item.id)).toEqual(['d']);
  });
  it('笔记可以选择所有目录', () => {
    expect(moveDestinations(folders, { kind: 'note', id: 'n', name: 'n' })).toHaveLength(4);
  });
});
