import { calculateContentHash, sourceEdits, followListAnchorChanges, type ContentAnchor } from '@study-accelerator/content-anchor';
import type { CreateAnnotationInput, UpdateAnnotationAnchorInput } from '@study-accelerator/web-core';

export interface AnnotationSelection {
  quoteText: string;
  fromPosition: number;
  toPosition: number;
  prefixText: string;
  suffixText: string;
  headingPath: string[];
  scopeType: 'selection' | 'blocks' | 'section' | 'list';
  anchor: ContentAnchor;
}

export type AnnotationImportance = 'normal' | 'important' | 'core';

export async function buildCreateAnnotationInput(note: { id: string; spaceId?: string }, markdown: string, selection: AnnotationSelection, importance: AnnotationImportance = 'normal'): Promise<CreateAnnotationInput> {
  if (!note.spaceId) throw new Error('当前笔记缺少空间信息');
  const noteContentHash = calculateContentHash(markdown);
  return {
    spaceId: note.spaceId,
    noteId: note.id,
    ...selection,
    anchorFingerprint: calculateContentHash(JSON.stringify({ segments: selection.anchor.segments, structurePath: selection.anchor.structurePath })),
    noteContentHash,
    idempotencyKey: crypto.randomUUID(),
    kind: 'important',
    importance,
    schemaVersion: 2,
    sourceMode: 'manual'
  };
}

export async function buildUpdateAnnotationAnchorInput(markdown: string, selection: AnnotationSelection, expectedRevision: number): Promise<UpdateAnnotationAnchorInput> {
  return {
    ...selection,
    anchorFingerprint: calculateContentHash(JSON.stringify({ segments: selection.anchor.segments, structurePath: selection.anchor.structurePath })),
    noteContentHash: calculateContentHash(markdown),
    expectedRevision
  };
}

/** 仅允许原列表项内继续输入；结构或目标变化仍须用户重新选择。 */
export function canContinueListAnnotation(before: string, after: string, previous: AnnotationSelection, next: AnnotationSelection | null): next is AnnotationSelection {
  if (!next || previous.scopeType !== 'list' || next.scopeType !== 'list') return false;
  const edits = sourceEdits(before, after);
  if (!edits.length || edits.some(edit => edit.from !== edit.to || /[\r\n]/.test(edit.text)
    || edit.from < previous.fromPosition || edit.to > previous.toPosition)) return false;
  const followed = followListAnchorChanges(before, after, previous.anchor, edits);
  return followed.status === 'resolved' && Boolean(followed.anchor)
    && followed.anchor!.structurePath === next.anchor.structurePath
    && followed.anchor!.sourceStart === next.fromPosition && followed.anchor!.sourceEnd === next.toPosition
    && followed.anchor!.quoteText === next.quoteText
    && previous.anchor.list?.memberFingerprint === next.anchor.list?.memberFingerprint;
}
