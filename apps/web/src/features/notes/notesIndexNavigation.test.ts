import { describe, expect, it, vi } from 'vitest';
import type { Folder } from '@study-accelerator/web-core';
import { buildIndexPath, folderAncestors, folderLocation, indexRoute, displayNoteStatus } from './notesIndexNavigation';
const parent: Folder = { id: 'design', name: '产品设计', parentId: null, children: [] };
const child: Folder = { id: 'nested / 文稿', name: '交互研究', parentId: 'design', children: [] };
const folders = { [parent.id]: parent, [child.id]: child };

describe('index addresses', () => {
  it('shows every ancestor and makes the parent navigable', () => {
    const navigate = vi.fn();
    const path = buildIndexPath('all', child.id, folders, navigate);
    expect(path.map(segment => segment.label)).toEqual(['笔记库', '产品设计', '交互研究']);
    expect(path.at(-1)?.current).toBe(true);
    path[1]?.onNavigate?.();
    expect(navigate).toHaveBeenCalledWith('/materials?folder=design');
    expect(folderLocation(child.id, folders)).toBe('笔记库 / 产品设计 / 交互研究');
  });
  it('encodes folder ids and distinguishes scopes', () => {
    const route = indexRoute('all', child.id);
    expect(new URLSearchParams(route.split('?')[1]).get('folder')).toBe(child.id);
    expect(indexRoute('root')).toBe('/materials?scope=root');
    expect(indexRoute('favorites')).toBe('/materials?scope=favorites');
  });
  it('terminates malformed or deleted parent chains', () => {
    expect(folderAncestors('missing', folders)).toEqual([]);
    expect(folderAncestors(parent.id, { ...folders, design: { ...parent, parentId: child.id } })).toHaveLength(2);
  });
  it('translates persisted statuses without discarding custom status names', () => {
    expect(['draft', 'active', 'completed', '待复习'].map(displayNoteStatus)).toEqual(['草稿', '进行中', '已完成', '待复习']);
  });
});
