import type { Note, Tag } from '@study-accelerator/web-core';

/** 仅统计调用方给定范围；每条存活笔记对已知标签只计一次，含零计数。 */
export function countTagUsage(tags: Pick<Tag, 'id'>[], notes: Pick<Note, 'tagIds' | 'deleted'>[]): Record<string, number> {
  const counts = new Map(tags.map(tag => [tag.id, 0]));
  for (const note of notes) {
    if (note.deleted) continue;
    for (const id of new Set(note.tagIds)) {
      if (counts.has(id)) counts.set(id, counts.get(id)! + 1);
    }
  }
  return Object.fromEntries(counts);
}
