import { describe, expect, it } from 'vitest';
import type { Annotation } from '@study-accelerator/web-core';
import { buildAnnotationListRows } from './annotationListModel';

function annotation(id: string, start: number, end: number, importance: Annotation['importance'] = null): Annotation {
  return {
    id, spaceId: 'space', noteId: 'note', noteVersionId: null, kind: 'important',
    importance, sourceMode: 'manual', quoteText: id, headingPath: [],
    fromPosition: start, toPosition: end, prefixText: '', suffixText: '',
    anchorFingerprint: id, noteContentHash: 'same-version', idempotencyKey: id,
    status: 'active', anchorStatus: 'resolved'
  };
}

describe('annotation list ordering and overlap', () => {
  it('keeps contained section and block marks separate while grouping them in document order', () => {
    const rows = buildAnnotationListRows([
      annotation('inner-section', 30, 70),
      annotation('outer-section', 0, 100),
      annotation('inner-block', 45, 55),
      annotation('later', 120, 140)
    ], 'document');

    expect(rows.map((row) => row.annotation.id)).toEqual(['outer-section', 'inner-section', 'inner-block', 'later']);
    expect(rows.map((row) => row.depth)).toEqual([0, 1, 2, 0]);
    expect(rows[0].containedCount).toBe(2);
    expect(rows[2].parentId).toBe('inner-section');
  });

  it('marks partial overlap without grouping while retaining approximate order for unverified positions', () => {
    const stale = { ...annotation('stale', 12, 22), anchorStatus: 'needsReview' as const };
    const rows = buildAnnotationListRows([
      annotation('first', 10, 30), annotation('second', 20, 40), stale
    ], 'document');
    expect(rows.map((row) => row.annotation.id)).toEqual(['first', 'stale', 'second']);
    expect(Object.fromEntries(rows.map((row) => [row.annotation.id, [row.depth, row.overlapCount]])))
      .toEqual({ first: [0, 1], second: [0, 1], stale: [0, 0] });
  });

  it('places an earlier mark needing review before a later resolved mark', () => {
    const intro = {
      ...annotation('1.0 引言', 0, 80),
      anchorStatus: 'needsReview' as const,
      status: 'stale' as const,
      originSnapshot: {
        contentHash: 'original-version', scopeType: 'section' as const,
        quoteText: '1.0 引言', headingPath: ['1.0 引言'],
        segments: [{ start: 0, end: 80, path: 'intro' }]
      }
    };
    const rows = buildAnnotationListRows([
      annotation('1.2.1 数据', 120, 180), intro
    ], 'document');
    expect(rows.map((row) => row.annotation.id)).toEqual(['1.0 引言', '1.2.1 数据']);
  });

  it('shows the original containment of marks needing review when their snapshots share a version', () => {
    const original = (id: string, start: number, end: number): Annotation => ({
      ...annotation(id, start, end),
      anchorStatus: 'needsReview',
      noteContentHash: 'changed-version',
      originSnapshot: {
        contentHash: 'original-version', scopeType: 'section', quoteText: id, headingPath: [],
        segments: [{ start, end, path: id }]
      }
    });
    const rows = buildAnnotationListRows([original('二级标题', 20, 50), original('一级标题', 0, 80)], 'document');
    expect(rows.map((row) => row.annotation.id)).toEqual(['一级标题', '二级标题']);
    expect(rows[0]).toMatchObject({ containedCount: 1, historicalRelation: true });
    expect(rows[1]).toMatchObject({ depth: 1, parentId: '一级标题', historicalRelation: true });
  });

  it('sorts by importance first and document position second, leaving unset last', () => {
    const rows = buildAnnotationListRows([
      annotation('normal', 0, 50, 'normal'),
      annotation('core-later', 20, 30, 'core'),
      annotation('unset', 5, 10),
      annotation('core-earlier', 2, 8, 'core')
    ], 'importance');
    expect(rows.map((row) => row.annotation.id)).toEqual(['core-earlier', 'core-later', 'normal', 'unset']);
    expect(rows.every((row) => row.depth === 0)).toBe(true);
    expect(rows[1].parentId).toBe('normal');
  });
});
