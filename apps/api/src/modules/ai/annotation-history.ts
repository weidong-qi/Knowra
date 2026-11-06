import { calculateContentHash } from '@study-accelerator/content-anchor';
import { createAppError } from '../../errors/app-error.ts';
import { hashRecord } from './record-contract.ts';

interface Source {
  noteId: string;
  noteVersionId: string;
  contentHash: string;
  start: number;
  end: number;
  quoteHash: string;
}
export interface AnnotationHistorySnapshot {
  format: 'knowra-annotation-history';
  version: 1;
  readOnly: true;
  callId: string;
  entries: { annotationId: string; quoteText: string; truncated: boolean; source: Source }[];
  snapshotHash: string;
}
const object = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === 'object' && !Array.isArray(value));
const text = (value: unknown): value is string => typeof value === 'string' && value.length > 0;
function fail(): never {
  throw createAppError('AI_ANNOTATION_HISTORY_INVALID', '重点读取历史缺少匹配的原始引文证据；原记录已保留。', 422);
}

/** 只从当时工具结果与 sourceRefs 生成独立只读视图；不查当前重点或当前笔记。 */
export function readAnnotationToolHistory(input: unknown): AnnotationHistorySnapshot | null {
  if (!object(input) || input.toolName !== 'annotations_list' || input.status !== 'succeeded') return null;
  const result = input.resultJson;
  if (
    !text(input.callId) ||
    !object(result) ||
    !Array.isArray(result.annotations) ||
    !text(result.noteId) ||
    !text(result.noteVersionId) ||
    !Array.isArray(input.sourceRefs)
  )
    fail();
  const entries: AnnotationHistorySnapshot['entries'] = [];
  for (const annotation of result.annotations) {
    if (
      !object(annotation) ||
      !text(annotation.annotationId) ||
      typeof annotation.text !== 'string' ||
      typeof annotation.truncated !== 'boolean' ||
      !Number.isSafeInteger(annotation.start) ||
      !Number.isSafeInteger(annotation.end)
    )
      fail();
    const start = annotation.start as number,
      end = annotation.end as number;
    if (start < 0 || end <= start || annotation.text.length !== end - start) fail();
    const found = input.sourceRefs.find(
      (ref: unknown) =>
        object(ref) &&
        ref.noteId === result.noteId &&
        ref.noteVersionId === result.noteVersionId &&
        ref.start === start &&
        ref.end === end &&
        ref.quoteHash === calculateContentHash(annotation.text as string)
    );
    if (!object(found) || !text(found.contentHash) || !/^[a-f0-9]{64}$/.test(found.contentHash)) fail();
    const source: Source = {
      noteId: result.noteId,
      noteVersionId: result.noteVersionId,
      contentHash: found.contentHash,
      start,
      end,
      quoteHash: calculateContentHash(annotation.text)
    };
    entries.push({
      annotationId: annotation.annotationId,
      quoteText: annotation.text,
      truncated: annotation.truncated,
      source
    });
  }
  const snapshot = {
    format: 'knowra-annotation-history' as const,
    version: 1 as const,
    readOnly: true as const,
    callId: input.callId,
    entries
  };
  return { ...snapshot, snapshotHash: hashRecord(snapshot) };
}
