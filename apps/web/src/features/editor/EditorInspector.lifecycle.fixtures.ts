import { vi } from 'vitest';
import type { AnalysisScopePreview, Annotation, AnnotationKnowledgeLinks, AnnotationPreview, Note } from '@study-accelerator/web-core';
import type { EditorInspectorProps } from './EditorInspector';

export const noteA: Note = {
  id: 'note-a', spaceId: 'space', title: '第一篇笔记', rawMarkdown: '第一篇正文',
  folderId: null, tagIds: [], internalLinks: [], contentLoaded: true, favorite: false, deleted: false
};
export const noteB: Note = { ...noteA, id: 'note-b', title: '第二篇笔记', rawMarkdown: '第二篇正文' };

function annotation(id: string, noteId: string, start: number): Annotation {
  return {
    id, noteId, spaceId: 'space', noteVersionId: 'version', kind: 'important',
    scopeType: 'selection', sourceMode: 'manual', quoteText: `${id} 原文`, comment: `${id} 备注`,
    headingPath: [], fromPosition: start, toPosition: start + 5, prefixText: '', suffixText: '',
    anchorFingerprint: id, noteContentHash: 'content-hash', idempotencyKey: id,
    status: 'active', lifecycleStatus: 'active', anchorStatus: 'resolved', revision: 3
  };
}
export const annotationA = annotation('annotation-a', noteA.id, 0);
export const annotationB = annotation('annotation-b', noteA.id, 20);
export const annotationOtherNote = annotation('annotation-other-note', noteB.id, 0);

export function annotationPreview(item: Annotation): AnnotationPreview {
  return {
    annotation: item,
    currentContentHash: 'content-hash',
    resolution: { status: 'resolved', reason: null, quoteText: `${item.id} 预览` },
    exclusions: [{
      id: 'exclusion', status: 'active', anchor: {
        projectionVersion: 1, scopeType: 'selection', segments: [{ start: 1, end: 3, path: 'p0' }],
        structurePath: null, quoteText: '已排除的片段', prefixText: '', suffixText: '',
        sourceStart: 1, sourceEnd: 3, projectedStart: 1, projectedEnd: 3
      }
    }]
  };
}

export function knowledgeLinks(item: Annotation): AnnotationKnowledgeLinks {
  return {
    annotationId: item.id,
    candidates: [{ evidence: { id: `evidence-${item.id}`, status: 'valid' }, knowledgeItem: { id: `candidate-${item.id}`, title: `${item.id} 候选` } }],
    confirmed: [], evidenceStatus: []
  };
}

export function analysisPreview(note: Note): AnalysisScopePreview {
  return {
    spaceId: 'space', mode: 'all', previewHash: `${note.id}-hash`,
    summary: { noteCount: 1, segmentCount: 1, annotationCount: 0 },
    segments: [{ noteId: note.id, noteVersionId: 'version', start: 0, end: 5, markdown: `${note.id} 分析预览`, annotationIds: [] }],
    omittedItems: [], ai: { available: false, message: '未开放' }
  };
}

export function inspectorProps(overrides: Partial<EditorInspectorProps> = {}): EditorInspectorProps {
  const annotations = [annotationA, annotationB, annotationOtherNote];
  return {
    note: noteA, notes: [noteA, noteB], folder: null, foldersById: {}, tags: [], markdown: noteA.rawMarkdown,
    open: true, canWrite: true, canInsertAttachment: true, attachments: [], attachmentsLoading: false,
    linkedNotes: [], linkedNotesLoading: false, annotations: [annotationA], annotationsLoading: false,
    focusedAnnotationId: null, onClose: vi.fn(), onOpenNote: vi.fn(), onNavigateHeading: vi.fn(),
    onSetTags: vi.fn().mockResolvedValue(undefined), onOrganizeNote: vi.fn().mockResolvedValue(undefined),
    onListVersions: vi.fn().mockResolvedValue([]), onGetVersion: vi.fn(), onUploadAttachment: vi.fn(),
    onInsertAttachment: vi.fn().mockResolvedValue(undefined), onRenameAttachment: vi.fn(),
    onDeleteAttachment: vi.fn().mockResolvedValue(undefined), onCreateAnnotation: vi.fn().mockResolvedValue(undefined),
    onSelectAnnotation: vi.fn(), onDeleteAnnotation: vi.fn().mockResolvedValue(undefined),
    onReanchorAnnotation: vi.fn().mockResolvedValue(undefined), onUpdateAnnotation: vi.fn().mockResolvedValue(undefined),
    onDeleteAnnotationExclusion: vi.fn().mockResolvedValue(undefined), onOpenKnowledgeItem: vi.fn(),
    onPreviewAnnotation: vi.fn(async id => annotationPreview(annotations.find(item => item.id === id)!)),
    onGetAnnotationKnowledgeLinks: vi.fn(async id => knowledgeLinks(annotations.find(item => item.id === id)!)),
    onPreviewAnalysisScope: vi.fn(async input => analysisPreview(input.noteIds?.[0] === noteB.id ? noteB : noteA)),
    ...overrides
  };
}

export function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}
