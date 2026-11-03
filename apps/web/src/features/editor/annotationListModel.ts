import type { Annotation } from '@study-accelerator/web-core';

export type AnnotationSort = 'document' | 'importance';

export interface AnnotationListRow {
  annotation: Annotation;
  depth: number;
  containedCount: number;
  parentId: string | null;
  overlapCount: number;
  historicalRelation: boolean;
}

interface Range { start: number; end: number }

function storedRangeOf(annotation: Annotation): Range | null {
  const start = annotation.anchor?.sourceStart ?? annotation.fromPosition;
  const end = annotation.anchor?.sourceEnd ?? annotation.toPosition;
  return Number.isInteger(start) && Number.isInteger(end) && start >= 0 && end > start
    ? { start, end }
    : null;
}

function currentRangeOf(annotation: Annotation): Range | null {
  if (annotation.anchorStatus && annotation.anchorStatus !== 'resolved') return null;
  if (annotation.status === 'stale') return null;
  return storedRangeOf(annotation);
}

function originalRangeOf(annotation: Annotation): Range | null {
  const segments = annotation.originSnapshot?.segments;
  if (!segments?.length) return null;
  const start = Math.min(...segments.map((segment) => segment.start));
  const end = Math.max(...segments.map((segment) => segment.end));
  return Number.isInteger(start) && Number.isInteger(end) && start >= 0 && end > start
    ? { start, end }
    : null;
}

function sharedRanges(left: Annotation, right: Annotation): { left: Range; right: Range; historical: boolean } | null {
  const leftCurrent = currentRangeOf(left);
  const rightCurrent = currentRangeOf(right);
  if (leftCurrent && rightCurrent && left.noteContentHash === right.noteContentHash) {
    return { left: leftCurrent, right: rightCurrent, historical: false };
  }
  const leftOriginal = originalRangeOf(left);
  const rightOriginal = originalRangeOf(right);
  if (leftOriginal && rightOriginal && left.originSnapshot?.contentHash
    && left.originSnapshot.contentHash === right.originSnapshot?.contentHash) {
    return { left: leftOriginal, right: rightOriginal, historical: true };
  }
  return null;
}

function contains(outer: Range, inner: Range): boolean {
  return outer.start <= inner.start && outer.end >= inner.end
    && (outer.start < inner.start || outer.end > inner.end);
}

const importanceRank: Record<string, number> = { core: 0, important: 1, normal: 2 };

export function buildAnnotationListRows(annotations: Annotation[], sort: AnnotationSort): AnnotationListRow[] {
  const currentRanges = new Map(annotations.map((annotation) => [annotation.id, currentRangeOf(annotation)]));
  const originalRanges = new Map(annotations.map((annotation) => [annotation.id, originalRangeOf(annotation)]));
  const parents = new Map<string, string>();
  const containedCounts = new Map<string, number>();
  const overlapCounts = new Map<string, number>();
  const historicalRelations = new Set<string>();

  for (const annotation of annotations) {
    const enclosing = annotations.filter((candidate) => {
      const pair = candidate.id !== annotation.id ? sharedRanges(candidate, annotation) : null;
      return pair && contains(pair.left, pair.right);
    }).sort((left, right) => {
      const leftRange = sharedRanges(left, annotation)!.left;
      const rightRange = sharedRanges(right, annotation)!.left;
      return (leftRange.end - leftRange.start) - (rightRange.end - rightRange.start)
        || left.id.localeCompare(right.id);
    });
    if (enclosing[0]) {
      parents.set(annotation.id, enclosing[0].id);
      if (sharedRanges(enclosing[0], annotation)?.historical) {
        historicalRelations.add(annotation.id);
        historicalRelations.add(enclosing[0].id);
      }
    }
  }

  for (const annotation of annotations) {
    let parentId = parents.get(annotation.id);
    while (parentId) {
      containedCounts.set(parentId, (containedCounts.get(parentId) ?? 0) + 1);
      parentId = parents.get(parentId);
    }
  }

  for (let index = 0; index < annotations.length; index += 1) {
    const left = annotations[index];
    for (const right of annotations.slice(index + 1)) {
      const pair = sharedRanges(left, right);
      if (!pair) continue;
      const leftRange = pair.left;
      const rightRange = pair.right;
      if (leftRange.start < rightRange.end && rightRange.start < leftRange.end
        && !contains(leftRange, rightRange) && !contains(rightRange, leftRange)) {
        overlapCounts.set(left.id, (overlapCounts.get(left.id) ?? 0) + 1);
        overlapCounts.set(right.id, (overlapCounts.get(right.id) ?? 0) + 1);
        if (pair.historical) {
          historicalRelations.add(left.id);
          historicalRelations.add(right.id);
        }
      }
    }
  }

  const documentOrder = (left: Annotation, right: Annotation): number => {
    const leftCurrent = currentRanges.get(left.id);
    const rightCurrent = currentRanges.get(right.id);
    // 待核对标记使用原始范围或旧锚点估算位置，避免被统一排到正文末尾。
    const leftRange = leftCurrent ?? originalRanges.get(left.id) ?? storedRangeOf(left);
    const rightRange = rightCurrent ?? originalRanges.get(right.id) ?? storedRangeOf(right);
    return (leftRange?.start ?? Number.POSITIVE_INFINITY) - (rightRange?.start ?? Number.POSITIVE_INFINITY)
      || (rightRange?.end ?? 0) - (leftRange?.end ?? 0)
      || (left.createdAt ?? '').localeCompare(right.createdAt ?? '')
      || left.id.localeCompare(right.id);
  };
  const sorted = [...annotations].sort((left, right) => sort === 'importance'
    ? (importanceRank[left.importance ?? ''] ?? 3) - (importanceRank[right.importance ?? ''] ?? 3) || documentOrder(left, right)
    : documentOrder(left, right));

  return sorted.map((annotation) => {
    let depth = 0;
    let parentId = parents.get(annotation.id);
    while (parentId) {
      depth += 1;
      parentId = parents.get(parentId);
    }
    return {
      annotation,
      depth: sort === 'document' ? depth : 0,
      parentId: parents.get(annotation.id) ?? null,
      containedCount: containedCounts.get(annotation.id) ?? 0,
      overlapCount: overlapCounts.get(annotation.id) ?? 0,
      historicalRelation: historicalRelations.has(annotation.id)
    };
  });
}
