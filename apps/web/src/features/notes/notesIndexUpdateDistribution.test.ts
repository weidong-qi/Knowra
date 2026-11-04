import { describe, expect, it } from 'vitest';
import { buildNoteUpdateDistribution } from './notesIndexUpdateDistribution';

const now = new Date('2026-10-13T12:00:00');
const note = (id: string, updatedAt: string, deleted = false) => ({ id, updatedAt, deleted });

describe('已加载笔记最近更新时间分布', () => {
  it('每篇存活笔记只计一次，排除删除、无效、未来与区间外的更新时间', () => {
    const { days, total } = buildNoteUpdateDistribution([
      note('a', '2026-10-12T10:00:00'), note('a', '2026-10-13T10:00:00'),
      note('b', '2026-10-13T11:00:00'), note('deleted', '2026-10-13T10:00:00', true),
      note('bad', 'invalid'), note('future', '2026-10-14T10:00:00'), note('old', '2025-01-01T10:00:00')
    ], now);
    expect(total).toBe(2);
    expect(days).toHaveLength(84);
    expect(days.find(day => day.today)).toMatchObject({ date: '2026-10-13', count: 2, level: 2 });
    expect(days.find(day => day.date === '2026-10-12')?.count).toBe(0);
    expect(days.filter(day => day.future)).toHaveLength(5);
  });

  it('空数据不生成示例热度，级别最多为四档', () => {
    expect(buildNoteUpdateDistribution([], now).days.every(day => day.count === 0)).toBe(true);
    const { days, total } = buildNoteUpdateDistribution(Array.from({ length: 9 }, (_, i) => note(String(i), '2026-10-13T11:00:00')), now);
    expect(total).toBe(9);
    expect(days.find(day => day.today)?.level).toBe(4);
  });
});
