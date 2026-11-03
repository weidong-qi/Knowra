import { describe, expect, it } from 'vitest';
import type { Note, Tag } from '@study-accelerator/web-core';
import { computeStats, formatRecentTime, formatToday, greetingFor, summaryLine } from './homeViewModel';

const note = (id: string, patch: Partial<Note> = {}) => ({ id, title: id, tagIds: [], deleted: false, ...patch }) as Note;

describe('首页活动统计', () => {
  it.each([12, 14])('在10月%s日以近7天而非本周描述跨周数据', day => {
    const now = new Date(2026, 9, day, 12).getTime();
    const at = (age: number) => new Date(2026, 9, day - age, 10).toISOString();
    const stats = computeStats([
      note('today', { updatedAt: at(0) }),
      note('previous-week', { updatedAt: at(6) }),
      note('too-old', { updatedAt: at(7) }),
      note('future', { updatedAt: at(-1) }),
      note('invalid', { updatedAt: 'invalid' }),
      note('deleted', { updatedAt: at(0), deleted: true })
    ], [], [], now);
    expect(stats.todayCount).toBe(1);
    expect(stats.recentWeekCount).toBe(2);
    expect(summaryLine(stats)).toContain('近7天 2 篇');
    expect(summaryLine(stats)).not.toContain('本周');
  });

  it('复用状态顺序，未知状态放最后，剔除已删除笔记的统计', () => {
    const tags = [{ id: 'tag', name: '标签' }] as Tag[];
    const stats = computeStats([
      note('unknown', { status: 'custom' }), note('draft', { status: 'draft' }),
      note('done', { status: 'completed' }), note('active', { status: 'active', favorite: true, tagIds: ['tag'] }),
      note('deleted', { deleted: true, status: 'published', favorite: true, tagIds: ['tag'] })
    ], [], tags, new Date(2026, 9, 14).getTime());
    expect(stats.statusSegments.map(item => item.key)).toEqual(['active', 'draft', 'completed', 'custom']);
    expect(stats.favoriteCount).toBe(1);
    expect(stats.activeNotes).toBe(4);
    expect(stats.topTags).toEqual([{ tag: tags[0], count: 1 }]);
    expect(stats.recentNotes.some(item => item.deleted)).toBe(false);
  });

  it('可注入时钟验证问候、日期与相对时间', () => {
    const now = new Date(2026, 9, 14, 9, 30);
    expect(greetingFor(now)).toBe('早安，创造者。');
    expect(formatToday(now)).toContain('10月14日');
    expect(formatRecentTime(new Date(2026, 9, 14, 9).toISOString(), now.getTime())).toBe('30分钟前');
    expect(formatRecentTime(undefined, now.getTime())).toBe('—');
    expect(formatRecentTime('invalid', now.getTime())).toBe('invalid');
    expect(summaryLine(computeStats([], [], [], now.getTime()))).toContain('还没有笔记');
  });
});
