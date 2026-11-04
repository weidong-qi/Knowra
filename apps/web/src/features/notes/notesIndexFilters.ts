import type { IndexItem } from './notesIndexPresentation';

export type UpdatedWithin = 'today' | '7d' | '30d' | null;
export type FilterLevel = 'root' | 'status' | 'tags' | 'updated';
export interface IndexFilters { statuses: readonly string[]; updatedWithin: UpdatedWithin }
export const FILTER_LABELS: Record<Exclude<UpdatedWithin, null>, string> = { today: '今天', '7d': '过去 7 天', '30d': '过去 30 天' };
export const NOTE_STATUS_LABELS: Record<string, string> = { draft: '草稿', active: '进行中', completed: '已完成', published: '已发布', archived: '已归档', unknown: '未知状态' };

export function normalizeNoteStatus(status: unknown): string {
  if (status === undefined || status === null || status === '') return 'draft';
  if (typeof status !== 'string') return 'unknown';
  const value = status.trim();
  const aliases: Record<string, string> = { 草稿: 'draft', 待整理: 'draft', 'in-progress': 'active', in_progress: 'active', 进行中: 'active', done: 'completed', 已完成: 'completed', 已发布: 'published', 已归档: 'archived' };
  return value ? Object.hasOwn(aliases, value) ? aliases[value] : value : 'draft';
}

/** 按用户本地日历计算，避免夏令时使“昨天”跨过 23/25 小时边界。 */
export function updatedDayAge(value: unknown, now: Date | number = new Date()): number | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const date = new Date(value);
  const current = new Date(now);
  if (!Number.isFinite(date.getTime()) || !Number.isFinite(current.getTime()) || date.getTime() > current.getTime()) return null;
  const day = (input: Date) => Date.UTC(input.getFullYear(), input.getMonth(), input.getDate());
  return Math.round((day(current) - day(date)) / 86_400_000);
}

/** 只过滤传入的已加载项目；不表示服务端完整结果，不改变分页游标。 */
export function filterIndexItems(items: readonly IndexItem[], filters: IndexFilters, now: Date | number = new Date()): IndexItem[] {
  const statuses = new Set(filters.statuses.map(normalizeNoteStatus));
  const hasDateFilter = filters.updatedWithin !== null;
  if (!statuses.size && !hasDateFilter) return [...items];
  const days = filters.updatedWithin === 'today' ? 0 : filters.updatedWithin === '7d' ? 7 : 30;
  return items.filter(item => {
    if (item.kind === 'folder') return false;
    if (statuses.size && !statuses.has(normalizeNoteStatus(item.note.status))) return false;
    if (!hasDateFilter) return true;
    const age = updatedDayAge(item.note.updatedAt, now);
    return age !== null && age <= days;
  });
}

/** 状态筛选菜单的展示顺序。 */
export const STATUS_ORDER = ['active', 'draft', 'completed', 'published', 'archived'] as const;
