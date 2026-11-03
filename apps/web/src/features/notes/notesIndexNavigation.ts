import type { Folder } from '@study-accelerator/web-core';
import type { NotesIndexScope } from '../../store/types';
import type { PathSegment } from '../../shell/path';

export const INDEX_SCOPE_LABELS: Record<NotesIndexScope, string> = {
  all: '全部笔记', root: '笔记库', recent: '最近编辑', favorites: '收藏', unfiled: '未整理', trash: '回收站'
};

export function folderAncestors(folderId: string | null, folders: Record<string, Folder>): Folder[] {
  const result: Folder[] = [];
  const visited = new Set<string>();
  let current = folderId ? folders[folderId] : undefined;
  while (current && !visited.has(current.id)) {
    visited.add(current.id);
    result.unshift(current);
    current = current.parentId ? folders[current.parentId] : undefined;
  }
  return result;
}

export function folderLocation(folderId: string | null | undefined, folders: Record<string, Folder>): string {
  return ['笔记库', ...folderAncestors(folderId ?? null, folders).map((folder) => folder.name)].join(' / ');
}

export function indexRoute(scope: NotesIndexScope, folderId: string | null = null, tagId: string | null = null): string {
  const params = new URLSearchParams();
  if (folderId) params.set('folder', folderId);
  else if (scope !== 'all') params.set('scope', scope);
  if (tagId) params.set('tags', tagId);
  return `/materials${params.size ? `?${params}` : ''}`;
}

export function buildIndexPath(scope: NotesIndexScope, folderId: string | null, folders: Record<string, Folder>, navigate: (to: string) => void): PathSegment[] {
  const ancestors = folderAncestors(folderId, folders);
  const root: PathSegment = { id: 'materials:root', label: '笔记库', onNavigate: () => navigate(indexRoute('root')) };
  if (ancestors.length) return [root, ...ancestors.map((folder, index) => ({
    id: `folder:${folder.id}`, label: folder.name, current: index === ancestors.length - 1,
    onNavigate: () => navigate(indexRoute('all', folder.id))
  }))];
  if (scope === 'root') return [{ ...root, current: true }];
  return [root, { id: `scope:${scope}`, label: INDEX_SCOPE_LABELS[scope], current: true }];
}

export function displayNoteStatus(status?: string): string {
  const labels: Record<string, string> = { draft: '草稿', active: '进行中', in_progress: '进行中', 'in-progress': '进行中', completed: '已完成', done: '已完成', archived: '已归档' };
  return status ? labels[status] ?? status : '草稿';
}
