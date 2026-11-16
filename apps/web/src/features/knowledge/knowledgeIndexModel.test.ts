import { filterKnowledgeItems, knowledgeStatusLabel } from './knowledgeViewModel';
import { describe, expect, it } from 'vitest';
import type { KnowledgeItem } from '@study-accelerator/web-core';
import { DEFAULT_KNOWLEDGE_DISPLAY, groupKnowledge, parseKnowledgeDisplay, sortKnowledge } from './knowledgeIndexModel';

const item = (id: string, patch: Partial<KnowledgeItem> = {}) =>
  ({
    id,
    title: id,
    canonicalStatement: '',
    userExplanation: '',
    knowledgeType: 'concept',
    reviewStatus: 'candidate',
    updatedAt: '2026-09-20T00:00:00.000Z',
    ...patch
  }) as KnowledgeItem;

describe('knowledgeIndexModel', () => {
  it('解析显示偏好时丢弃非法值', () => {
    expect(
      parseKnowledgeDisplay({ view: 'grid', group: 'x', sort: 1, properties: { type: false, status: 'no' } })
    ).toEqual({ ...DEFAULT_KNOWLEDGE_DISPLAY, properties: { ...DEFAULT_KNOWLEDGE_DISPLAY.properties, type: false } });
  });
  it('按最近、最早与名称排序', () => {
    const rows = [
      item('b', { updatedAt: '2026-09-01T00:00:00.000Z' }),
      item('a', { updatedAt: '2026-09-10T00:00:00.000Z' })
    ];
    expect(sortKnowledge(rows, 'updated-desc').map(row => row.id)).toEqual(['a', 'b']);
    expect(sortKnowledge(rows, 'updated-asc').map(row => row.id)).toEqual(['b', 'a']);
    expect(sortKnowledge(rows, 'name-asc').map(row => row.id)).toEqual(['a', 'b']);
  });
  it('按状态分组并固定组顺序，回收站单独成组', () => {
    const groups = groupKnowledge(
      [
        item('1', { reviewStatus: 'confirmed' }),
        item('2'),
        item('3', { deletedAt: 'x' }),
        item('4', { reviewStatus: 'needsRevision' })
      ],
      'status'
    );
    expect(groups.map(group => group.label)).toEqual(['待确认', '已确认', '回收站']);
    expect(groups[0].items.map(row => row.id)).toEqual(['2', '4']);
  });
  it('按更新时间分组，不分组时只有一组', () => {
    const now = Date.parse('2026-09-21T00:00:00.000Z');
    const rows = [
      item('a', { updatedAt: '2026-09-20T12:00:00.000Z' }),
      item('b', { updatedAt: '2026-09-10T00:00:00.000Z' }),
      item('c', { updatedAt: '2026-01-01T00:00:00.000Z' })
    ];
    expect(groupKnowledge(rows, 'updated', now).map(group => group.label)).toEqual(['今天', '近 30 天', '更早']);
    expect(groupKnowledge(rows, 'none')).toHaveLength(1);
  });
});

it('待确认筛选合并两种原始状态，排除归档与回收站且不修改数据', () => {
  const rows = [
    item('candidate'),
    item('revision', { reviewStatus: 'needsRevision' }),
    item('confirmed', { reviewStatus: 'confirmed' }),
    item('archived', { reviewStatus: 'archived' }),
    item('trash', { deletedAt: 'deleted' })
  ];
  for (const scope of ['candidate', 'needsRevision']) {
    expect(filterKnowledgeItems(rows, scope, '').map(row => row.id)).toEqual(['candidate', 'revision']);
  }
  expect(filterKnowledgeItems(rows, 'candidate', 'revision').map(row => row.id)).toEqual(['revision']);
  expect(rows[1].reviewStatus).toBe('needsRevision');
  expect(knowledgeStatusLabel('candidate')).toBe('待确认');
  expect(knowledgeStatusLabel('needsRevision')).toBe('待确认');
});
