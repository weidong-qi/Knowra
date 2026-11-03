import type { Note } from '@study-accelerator/web-core';

export interface NoteUpdateDay { date: string; count: number; level: number; today: boolean; future: boolean }
const dateKey = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

/** A snapshot of loaded notes, not edit history: each live note contributes once. */
export function buildNoteUpdateDistribution(notes: readonly Pick<Note, 'id' | 'updatedAt' | 'deleted'>[], now = new Date()) {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const start = new Date(today);
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7) - 11 * 7);
  const latest = new Map<string, number>();
  for (const note of notes) {
    if (note.deleted || !note.updatedAt) continue;
    const time = Date.parse(note.updatedAt);
    if (Number.isFinite(time) && time <= now.getTime() && time > (latest.get(note.id) ?? -Infinity)) latest.set(note.id, time);
  }
  const counts = new Map<string, number>();
  for (const time of latest.values()) {
    const key = dateKey(new Date(time));
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const days: NoteUpdateDay[] = Array.from({ length: 84 }, (_, index) => {
    const day = new Date(start);
    day.setDate(start.getDate() + index);
    const date = dateKey(day);
    const count = counts.get(date) ?? 0;
    return { date, count, level: Math.min(4, count), today: date === dateKey(today), future: day > today };
  });
  return { days, total: days.reduce((total, day) => total + day.count, 0) };
}
