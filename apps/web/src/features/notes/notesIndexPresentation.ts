import type { Folder, Note } from '@study-accelerator/web-core';
import styles from './NotesIndexItems.module.css';
export type ViewMode = 'list' | 'grid' | 'card';
export type TypeFilter = 'all' | 'folder' | 'note';
export type SortMode = 'updated-desc' | 'updated-asc' | 'name-asc' | 'name-desc';
export type IndexItem = { kind: 'folder'; folder: Folder } | { kind: 'note'; note: Note };
export const SORT_LABELS: Record<SortMode, string> = { 'updated-desc': '最近更新', 'updated-asc': '最早更新', 'name-asc': '名称 A→Z', 'name-desc': '名称 Z→A' };

export type GroupMode = 'none' | 'updated' | 'folder' | 'status';
export const GROUP_LABELS: Record<GroupMode, string> = { none: '不分组', updated: '更新时间', folder: '文件夹', status: '状态' };
export interface IndexDisplayProperties { summary: boolean; tags: boolean; status: boolean; location: boolean; updated: boolean }
export const DEFAULT_DISPLAY_PROPERTIES: IndexDisplayProperties = { summary: true, tags: true, status: true, location: true, updated: true };

export function statusClassName(status: string): string {
  if (status === '文件夹') return styles.statusFolder;
  if (status === '回收站') return styles.statusMuted;
  if (/完成|已完成/.test(status)) return styles.statusDone;
  return /草稿|待整理|文稿/.test(status) ? styles.statusDraft : styles.statusActive;
}

export function sortNotes(notes: Note[], sort: SortMode): Note[] {
  if (sort === 'name-asc' || sort === 'name-desc') {
    const direction = sort === 'name-asc' ? 1 : -1;
    return [...notes].sort((left, right) => direction * left.title.localeCompare(right.title, 'zh-CN'));
  }
  const direction = sort === 'updated-desc' ? -1 : 1;
  return [...notes].sort((left, right) => {
    const leftTime = Date.parse(left.updatedAt ?? '');
    const rightTime = Date.parse(right.updatedAt ?? '');
    if (!Number.isFinite(leftTime)) return Number.isFinite(rightTime) ? 1 : 0;
    if (!Number.isFinite(rightTime)) return -1;
    return direction * (leftTime - rightTime);
  });
}

export function compareFolderItems(left: IndexItem, right: IndexItem): number {
  if (left.kind !== 'folder' || right.kind !== 'folder') return 0;
  return left.folder.name.localeCompare(right.folder.name, 'zh-CN');
}

export function nextSort(sort: SortMode): SortMode {
  if (sort === 'updated-desc') return 'updated-asc';
  if (sort === 'updated-asc') return 'name-asc';
  if (sort === 'name-asc') return 'name-desc';
  return 'updated-desc';
}

export function itemKey(item: IndexItem): string {
  return `${item.kind}:${item.kind === 'folder' ? item.folder.id : item.note.id}`;
}
