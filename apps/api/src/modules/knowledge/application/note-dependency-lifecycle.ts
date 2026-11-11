import { conflictError } from './knowledge-errors.ts';

import type { NoteRecord } from '../infrastructure/note-repository.ts';
import type { NoteVersionRecord } from '../infrastructure/note-version-repository.ts';
import type { ContentAnnotationRecord } from '../infrastructure/content-annotation-repository.ts';
import type { AnnotationReconcileContext } from './content-annotation-service.ts';

export interface DependencyIdRecord {
  id?: unknown;
}
export interface DependencyQuestionSource {
  sourceType?: unknown;
  sourceId?: unknown;
}
export interface DependencyScopeSnapshot {
  noteVersions?: unknown;
}
export interface NoteDependencyOptions {
  contentAnnotationService: {
    reconcileForNote(
      noteId: string,
      contentHash: unknown,
      annotationChange: AnnotationReconcileContext | null | undefined
    ): { contentChangedAnnotationIds: unknown[] };
  };
  contentAnnotationRepository: { findById(id: unknown): ContentAnnotationRecord | null | undefined };
  annotationIdentityShadow: {
    observe(note: Pick<NoteRecord, 'id'>, annotationChange: AnnotationReconcileContext | null | undefined): unknown;
  };
  knowledgeItemService: {
    markEvidenceByAnnotationId(annotationId: unknown, status: 'insufficient' | 'stale'): readonly DependencyIdRecord[];
    markEvidenceByNoteVersionIds(
      versionIds: unknown[],
      status: 'stale',
      sourceType: 'noteVersion'
    ): readonly DependencyIdRecord[];
    markEvidenceByNoteId(noteId: string, status: 'invalid'): readonly DependencyIdRecord[];
  };
  questionService: { markSourcesStale(sourceType: 'knowledgeEvidence' | 'noteVersion', sourceIds: unknown[]): unknown };
  noteVersionService: {
    listVersionIds(options: { noteId: string }): unknown[];
    listVersions(options: { noteId: string }): readonly DependencyIdRecord[];
  };
  noteVersionRepository: { list(options: { noteId: string }): readonly DependencyIdRecord[] };
  knowledgeEvidenceRepository: { list(options: { noteId: string }): { readonly length: number } };
  questionSourceRepository: { list(): readonly DependencyQuestionSource[] };
  analysisScopeRepository: { list(): readonly DependencyScopeSnapshot[] };
  coalescePreviousVersion(
    note: Pick<NoteRecord, 'id'>,
    version: NoteVersionRecord,
    annotationChange: AnnotationReconcileContext | null | undefined
  ): unknown;
}
export interface NoteDependencyLifecycle {
  onNoteContentChanged(
    note: Pick<NoteRecord, 'id'>,
    version: NoteVersionRecord,
    annotationChange: AnnotationReconcileContext | null | undefined
  ): void;
  onNoteDeleted(noteId: string): void;
  onBeforePermanentDelete(noteId: string): void;
}

/** 笔记变更的同步依赖级联；由原笔记服务的事务包裹，不另开事务。 */
export function createNoteDependencyLifecycle({
  contentAnnotationService,
  contentAnnotationRepository,
  annotationIdentityShadow,
  knowledgeItemService,
  questionService,
  noteVersionService,
  noteVersionRepository,
  knowledgeEvidenceRepository,
  questionSourceRepository,
  analysisScopeRepository,
  coalescePreviousVersion
}: NoteDependencyOptions): NoteDependencyLifecycle {
  return {
    onNoteContentChanged: (note, version, annotationChange) => {
      const reconciliation = contentAnnotationService.reconcileForNote(note.id, version.contentHash, annotationChange);
      annotationIdentityShadow.observe(note, annotationChange);
      const changed = reconciliation.contentChangedAnnotationIds.flatMap(annotationId =>
        knowledgeItemService.markEvidenceByAnnotationId(
          annotationId,
          contentAnnotationRepository.findById(annotationId)?.anchorStatus === 'missing' ? 'insufficient' : 'stale'
        )
      );
      questionService.markSourcesStale(
        'knowledgeEvidence',
        changed.map(evidence => evidence.id)
      );
      const oldVersionIds = noteVersionService.listVersionIds({ noteId: note.id }).filter(id => id !== version.id);
      const directEvidence = knowledgeItemService.markEvidenceByNoteVersionIds(oldVersionIds, 'stale', 'noteVersion');
      questionService.markSourcesStale(
        'knowledgeEvidence',
        directEvidence.map(record => record.id)
      );
      questionService.markSourcesStale('noteVersion', oldVersionIds);
      coalescePreviousVersion(note, version, annotationChange);
    },
    onNoteDeleted: noteId => {
      const changed = knowledgeItemService.markEvidenceByNoteId(noteId, 'invalid');
      questionService.markSourcesStale(
        'knowledgeEvidence',
        changed.map(evidence => evidence.id)
      );
      questionService.markSourcesStale(
        'noteVersion',
        noteVersionService.listVersions({ noteId }).map(version => version.id)
      );
    },
    onBeforePermanentDelete: noteId => {
      if (knowledgeEvidenceRepository.list({ noteId }).length > 0) {
        throw conflictError(
          'NOTE_HAS_KNOWLEDGE_EVIDENCE',
          'Note has formal knowledge evidence and cannot be permanently deleted'
        );
      }
      const versionIds = new Set(noteVersionRepository.list({ noteId }).map(version => version.id));
      if (
        questionSourceRepository
          .list()
          .some(source => source.sourceType === 'noteVersion' && versionIds.has(source.sourceId))
      ) {
        throw conflictError(
          'NOTE_HAS_QUESTION_SOURCE',
          'Note has a formal question source and cannot be permanently deleted'
        );
      }
      if (
        analysisScopeRepository
          .list()
          .some(snapshot =>
            (
              snapshot.noteVersions as
                | { some(callback: (version: { noteId?: unknown; noteVersionId?: unknown }) => boolean): boolean }
                | null
                | undefined
            )?.some(version => version.noteId === noteId || versionIds.has(version.noteVersionId))
          )
      ) {
        throw conflictError(
          'NOTE_HAS_ANALYSIS_SCOPE',
          'NoteVersion is referenced by an analysis scope snapshot and cannot be deleted'
        );
      }
    }
  };
}
