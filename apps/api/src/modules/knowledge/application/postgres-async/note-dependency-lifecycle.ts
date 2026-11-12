import { conflictError } from '../knowledge-errors.ts';

export type MaybePromise<Value> = Value | PromiseLike<Value>;
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
export interface AsyncNoteDependencyOptions {
  createAnnotationService: () => {
    reconcileForNote: (
      noteId: unknown,
      contentHash: unknown,
      annotationChange: unknown
    ) => MaybePromise<{ contentChangedAnnotationIds: Iterable<unknown> }>;
  };
  contentAnnotationRepository: {
    findById: (id: unknown) => MaybePromise<DependencyAnnotationRecord | null | undefined>;
  };
  noteVersionRepository: {
    listIds: (options: { noteId: unknown }) => MaybePromise<Pick<readonly unknown[], 'filter'>>;
    list: (options: { noteId: unknown }) => MaybePromise<Pick<readonly DependencyIdRecord[], 'map'>>;
  };
  knowledgeEvidenceRepository: {
    list: (options: { noteId: unknown }) => MaybePromise<{ readonly length: number }>;
  };
  questionSourceRepository: {
    list: () => MaybePromise<Pick<readonly DependencyQuestionSource[], 'some'>>;
  };
  analysisScopeRepository: {
    list: () => MaybePromise<Pick<readonly DependencyScopeSnapshot[], 'some'>>;
  };
  knowledgeItemService: {
    markEvidenceByAnnotationId: (
      annotationId: unknown,
      status: 'insufficient' | 'stale'
    ) => MaybePromise<Iterable<DependencyIdRecord>>;
    markEvidenceByNoteVersionIds: (
      versionIds: unknown[],
      status: 'stale',
      sourceType: 'noteVersion'
    ) => MaybePromise<Pick<readonly DependencyIdRecord[], 'map'>>;
    markEvidenceByNoteId: (
      noteId: unknown,
      status: 'invalid'
    ) => MaybePromise<Pick<readonly DependencyIdRecord[], 'map'>>;
  };
  questionService: {
    markSourcesStale: (sourceType: 'knowledgeEvidence' | 'noteVersion', sourceIds: unknown[]) => unknown;
  };
}
export interface AsyncNoteDependencyLifecycle {
  onNoteContentChanged: (
    note: DependencyIdRecord,
    version: DependencyVersionRecord,
    annotationChange: unknown
  ) => Promise<void>;
  onNoteDeleted: (noteId: unknown) => Promise<void>;
  onBeforePermanentDelete: (noteId: unknown) => Promise<void>;
}

/** 只使用调用者装配的事务内依赖；标注服务仍在正文变更时惰性创建。 */
export function createAsyncNoteDependencyLifecycle({
  createAnnotationService,
  contentAnnotationRepository,
  noteVersionRepository,
  knowledgeEvidenceRepository,
  questionSourceRepository,
  analysisScopeRepository,
  knowledgeItemService,
  questionService
}: AsyncNoteDependencyOptions): AsyncNoteDependencyLifecycle {
  return {
    onNoteContentChanged: async (note, version, annotationChange) => {
      const transactionAnnotationService = createAnnotationService();
      const reconciliation = await transactionAnnotationService.reconcileForNote(
        note.id,
        version.contentHash,
        annotationChange
      );
      const changed: DependencyIdRecord[] = [];
      for (const annotationId of reconciliation.contentChangedAnnotationIds) {
        const annotation = await contentAnnotationRepository.findById(annotationId);
        changed.push(
          ...(await knowledgeItemService.markEvidenceByAnnotationId(
            annotationId,
            annotation?.anchorStatus === 'missing' ? 'insufficient' : 'stale'
          ))
        );
      }
      await questionService.markSourcesStale(
        'knowledgeEvidence',
        changed.map(evidence => evidence.id)
      );
      const oldVersionIds = (await noteVersionRepository.listIds({ noteId: note.id })).filter(id => id !== version.id);
      const directEvidence = await knowledgeItemService.markEvidenceByNoteVersionIds(
        oldVersionIds,
        'stale',
        'noteVersion'
      );
      await questionService.markSourcesStale(
        'knowledgeEvidence',
        directEvidence.map(record => record.id)
      );
      await questionService.markSourcesStale('noteVersion', oldVersionIds);
    },
    onNoteDeleted: async noteId => {
      const changed = await knowledgeItemService.markEvidenceByNoteId(noteId, 'invalid');
      await questionService.markSourcesStale(
        'knowledgeEvidence',
        changed.map(evidence => evidence.id)
      );
      const versions = await noteVersionRepository.list({ noteId });
      await questionService.markSourcesStale(
        'noteVersion',
        versions.map(version => version.id)
      );
    },
    onBeforePermanentDelete: async noteId => {
      if ((await knowledgeEvidenceRepository.list({ noteId })).length > 0) {
        throw conflictError(
          'NOTE_HAS_KNOWLEDGE_EVIDENCE',
          'Note has formal knowledge evidence and cannot be permanently deleted'
        );
      }
      const versions = await noteVersionRepository.list({ noteId });
      const versionIds = new Set(versions.map(version => version.id));
      const sources = await questionSourceRepository.list();
      if (sources.some(source => source.sourceType === 'noteVersion' && versionIds.has(source.sourceId))) {
        throw conflictError(
          'NOTE_HAS_QUESTION_SOURCE',
          'Note has a formal question source and cannot be permanently deleted'
        );
      }
      const snapshots = await analysisScopeRepository.list();
      if (
        snapshots.some(snapshot =>
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
