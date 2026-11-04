import type { Note, Folder, Tag } from '@study-accelerator/web-core';
import { NOTE_STATUS_LABELS, normalizeNoteStatus, updatedDayAge, STATUS_ORDER } from '../features/notes/notesIndexFilters';

export interface HomeStats {
  activeNotes: number;
  favoriteCount: number;
  folderCount: number;
  todayCount: number;
  recentWeekCount: number;
  recentNotes: Note[];
  statusSegments: { key: string; label: string; count: number }[];
  topTags: { tag: Tag; count: number }[];
}

export function computeStats(notes: Note[], folders: Folder[], tags: Tag[], now = Date.now()): HomeStats {
  const active = notes.filter(note => !note.deleted);
  const recentNotes = [...active].sort((a, b) => timeOf(b) - timeOf(a)).slice(0, 8);
  const age = (note: Note) => updatedDayAge(note.updatedAt ?? note.createdAt, now);
  const counts = new Map<string, number>();
  const tagCounts = new Map<string, number>();
  for (const note of active) {
    const key = normalizeNoteStatus(note.status);
    counts.set(key, (counts.get(key) ?? 0) + 1);
    for (const id of note.tagIds) tagCounts.set(id, (tagCounts.get(id) ?? 0) + 1);
  }
  const statusRank = (key: string) => {
    const index = STATUS_ORDER.findIndex(status => status === key);
    return index < 0 ? STATUS_ORDER.length : index;
  };
  const statusSegments = [...counts.entries()]
    .sort(([a], [b]) => statusRank(a) - statusRank(b))
    .map(([key, count]) => ({ key, label: NOTE_STATUS_LABELS[key] ?? key, count }));
  const topTags = [...tagCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .flatMap(([id, count]) => { const tag = tags.find(item => item.id === id); return tag ? [{ tag, count }] : []; })
    .slice(0, 6);
  return {
    activeNotes: active.length,
    favoriteCount: active.filter(note => note.favorite).length,
    folderCount: folders.length,
    todayCount: active.filter(note => age(note) === 0).length,
    recentWeekCount: active.filter(note => { const value = age(note); return value !== null && value <= 6; }).length,
    recentNotes,
    statusSegments,
    topTags
  };
}

const timeOf = (note: Note) => new Date(note.updatedAt ?? note.createdAt ?? 0).getTime();

export function statusLabel(note: Note): string {
  const key = normalizeNoteStatus(note.status);
  return NOTE_STATUS_LABELS[key] ?? key;
}

export function summaryLine(stats: HomeStats): string {
  if (!stats.activeNotes) return '还没有笔记，从新建第一篇开始吧。';
  const today = stats.todayCount ? `今天更新了 ${stats.todayCount} 篇` : '今天还没有更新';
  return `${today}，近7天 ${stats.recentWeekCount} 篇 · 共 ${stats.activeNotes} 篇笔记。`;
}

export function greetingFor(date: Date): string {
  const hour = date.getHours();
  const word = hour < 5 ? '夜深了' : hour < 11 ? '早安' : hour < 14 ? '午安' : hour < 18 ? '下午好' : '晚上好';
  return `${word}，创造者。`;
}

export function formatToday(date = new Date()): string {
  return new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' }).format(date);
}

export function formatRecentTime(input: string | undefined | null, now = Date.now()): string {
  if (!input) return '—';
  const date = new Date(input);
  if (Number.isNaN(date.getTime())) return input;
  const elapsedMinutes = Math.max(0, Math.floor((now - date.getTime()) / 60000));
  if (elapsedMinutes < 60) return `${Math.max(1, elapsedMinutes)}分钟前`;
  const elapsedHours = Math.floor(elapsedMinutes / 60);
  if (elapsedHours < 24) return `${elapsedHours}小时前`;
  return new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(date).replaceAll('-', '/');
}
