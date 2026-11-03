import type { Folder } from '@study-accelerator/web-core';
import type { GroupMode, IndexItem } from './notesIndexPresentation';
import { normalizeNoteStatus, NOTE_STATUS_LABELS, updatedDayAge } from './notesIndexFilters';

export type { GroupMode } from './notesIndexPresentation';
export interface IndexItemGroup { id: string; label: string; items: IndexItem[]; detail?: string; total?: number }
export interface IndexGroupOptions {
  group: GroupMode;
  foldersById?: Readonly<Record<string, Folder>>;
  now?: Date | number;
}
const DATE_GROUPS = [
  ['today', '今天'], ['yesterday', '昨天'], ['7d', '近 7 天'],
  ['30d', '近 30 天'], ['earlier', '更早'], ['unknown', '未知时间']
] as const;
const STATUS_ORDER = ['draft', 'active', 'completed', 'published', 'archived'];

/** 分组内部保持传入顺序，文件夹条目始终单列一组，不生成空组。 */
export function groupIndexItems(items: readonly IndexItem[], { group, foldersById = {}, now = new Date() }: IndexGroupOptions): IndexItemGroup[] {
  if (!items.length) return [];
  if (group === 'none') return [{ id: 'all', label: '', items: [...items] }];
  const groups = new Map<string, IndexItemGroup & { order: number }>();
  for (const item of items) {
    let id: string;
    let label: string;
    let order: number;
    if (item.kind === 'folder') {
      id = 'folders'; label = '文件夹'; order = -1;
    } else if (group === 'updated') {
      const age = updatedDayAge(item.note.updatedAt, now);
      order = age === null ? 5 : age === 0 ? 0 : age === 1 ? 1 : age <= 7 ? 2 : age <= 30 ? 3 : 4;
      [id, label] = DATE_GROUPS[order];
      id = `updated:${id}`;
    } else if (group === 'status') {
      const status = normalizeNoteStatus(item.note.status);
      id = `status:${status}`;
      label = Object.hasOwn(NOTE_STATUS_LABELS, status) ? NOTE_STATUS_LABELS[status] : status;
      const index = STATUS_ORDER.indexOf(status);
      order = index < 0 ? STATUS_ORDER.length : index;
    } else {
      const folderId = item.note.folderId;
      id = folderId ? `folder:${folderId}` : 'unfiled';
      label = folderId ? foldersById[folderId]?.name || '未知文件夹' : '未归档';
      order = folderId ? 0 : 1;
    }
    const existing = groups.get(id);
    if (existing) existing.items.push(item);
    else groups.set(id, { id, label, items: [item], order });
  }
  return [...groups.values()].sort((left, right) => left.order - right.order).map(({ order: _order, ...entry }) => entry);
}


export interface IndexGroupPaginationOptions {
  page: number;
  pageSize: number;
  collapsed: ReadonlySet<string>;
}
export interface IndexGroupPage {
  groups: IndexItemGroup[];
  items: IndexItem[];
  pageCount: number;
  currentPage: number;
  totalVisibleSlots: number;
}

/** 先按完整分组顺序展开，再压缩折叠组并分页；标题本身不占展开组的分页名额。 */
export function paginateIndexGroups(groups: readonly IndexItemGroup[], { page, pageSize, collapsed }: IndexGroupPaginationOptions): IndexGroupPage {
  const size = Number.isFinite(pageSize) && pageSize >= 1 ? Math.floor(pageSize) : 20;
  const isCollapsed = (group: IndexItemGroup) => group.id !== 'all' && collapsed.has(group.id);
  const slotCount = (group: IndexItemGroup) => group.items.length ? isCollapsed(group) ? 1 : group.items.length : 0;
  const totalVisibleSlots = groups.reduce((sum, group) => sum + slotCount(group), 0);
  const pageCount = Math.max(1, Math.ceil(totalVisibleSlots / size));
  const currentPage = Math.min(pageCount - 1, Math.max(0, Number.isFinite(page) ? Math.floor(page) : 0));
  const start = currentPage * size;
  const end = start + size;
  let offset = 0;
  const visibleGroups: IndexItemGroup[] = [];
  for (const group of groups) {
    const slots = slotCount(group);
    const groupStart = offset;
    offset += slots;
    if (!slots || offset <= start || groupStart >= end) continue;
    visibleGroups.push({
      ...group,
      total: group.total ?? group.items.length,
      items: isCollapsed(group) ? [] : group.items.slice(Math.max(0, start - groupStart), Math.min(slots, end - groupStart))
    });
  }
  return { groups: visibleGroups, items: visibleGroups.flatMap(group => group.items), pageCount, currentPage, totalVisibleSlots };
}
