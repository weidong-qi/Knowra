import { conflictError } from './knowledge-errors.ts';

export interface DependencyIdRecord {
  id?: unknown;
}
export interface DependencyVersionRecord extends DependencyIdRecord {
  contentHash?: unknown;
}
export interface DependencyAnnotationRecord {
  anchorStatus?: unknown;
}
export interface DependencyQuestionSource {
  sourceType?: unknown;
  sourceId?: unknown;
}
export interface DependencyScopeVersion {
  noteId?: unknown;
  noteVersionId?: unknown;
}
export interface DependencyScopeSnapshot {
  noteVersions?: Pick<readonly DependencyScopeVersion[], 'some'> | null | undefined;
}
export interface NoteDependencyOptions {
  contentAnnotationService: {
    reconcileForNote: (
      noteId: unknown,
      contentHash: unknown,
      annotationChange: unknown
    ) => {
      contentChangedAnnotationIds: {
        flatMap: (
          callback: (annotationId: unknown) => DependencyIdRecord | readonly DependencyIdRecord[]
        ) => Pick<readonly DependencyIdRecord[], 'map'>;
      };
    };
  };
  contentAnnotationRepository: { findById: (id: unknown) => DependencyAnnotationRecord | null | undefined };
  annotationIdentityShadow: { observe: (note: DependencyIdRecord, annotationChange: unknown) => unknown };
  knowledgeItemService: {
    markEvidenceByAnnotationId: (
      annotationId: unknown,
      status: 'insufficient' | 'stale'
    ) => DependencyIdRecord | readonly DependencyIdRecord[];
    markEvidenceByNoteVersionIds: (
      versionIds: unknown[],
      status: 'stale',
      sourceType: 'noteVersion'
    ) => Pick<readonly DependencyIdRecord[], 'map'>;
    markEvidenceByNoteId: (noteId: unknown, status: 'invalid') => Pick<readonly DependencyIdRecord[], 'map'>;
  };
  questionService: {
    markSourcesStale: (sourceType: 'knowledgeEvidence' | 'noteVersion', sourceIds: unknown[]) => unknown;
  };
  noteVersionService: {
    listVersionIds: (options: { noteId: unknown }) => Pick<readonly unknown[], 'filter'>;
    listVersions: (options: { noteId: unknown }) => Pick<readonly DependencyIdRecord[], 'map'>;
  };
  noteVersionRepository: { list: (options: { noteId: unknown }) => Pick<readonly DependencyIdRecord[], 'map'> };
  knowledgeEvidenceRepository: { list: (options: { noteId: unknown }) => { readonly length: number } };
  questionSourceRepository: { list: () => Pick<readonly DependencyQuestionSource[], 'some'> };
  analysisScopeRepository: { list: () => Pick<readonly DependencyScopeSnapshot[], 'some'> };
  coalescePreviousVersion: (
    note: DependencyIdRecord,
    version: DependencyVersionRecord,
    annotationChange: unknown
  ) => unknown;
}
export interface NoteDependencyLifecycle {
  onNoteContentChanged: (note: DependencyIdRecord, version: DependencyVersionRecord, annotationChange: unknown) => void;
  onNoteDeleted: (noteId: unknown) => void;
  onBeforePermanentDelete: (noteId: unknown) => void;
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
            snapshot.noteVersions?.some(version => version.noteId === noteId || versionIds.has(version.noteVersionId))
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
