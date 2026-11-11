import { conflictError } from '../../src/modules/knowledge/application/knowledge-errors.js';

// 基线 84013784f0cc698c95840a3bd4e4d48824700487，第 25 批迁移前两个模块的 hooks 冻结副本。
// 只在合成依赖上执行，不读取生产源码，也不将新实现当作预期值。
export function legacyNoteDependencyLifecycle({
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
}) {
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

export function legacyAsyncNoteDependencyLifecycle({
  createAnnotationService,
  contentAnnotationRepository,
  noteVersionRepository,
  knowledgeEvidenceRepository,
  questionSourceRepository,
  analysisScopeRepository,
  knowledgeItemService,
  questionService
}) {
  const transaction = {
    contentAnnotationRepository,
    noteVersionRepository,
    knowledgeEvidenceRepository,
    questionSourceRepository,
    analysisScopeRepository
  };
  const formalServices = { knowledgeItemService, questionService };
  const buildTransactionAnnotationServices = () => ({ annotationService: createAnnotationService() });
  return {
    onNoteContentChanged: async (note, version, annotationChange) => {
      const transactionAnnotationService = buildTransactionAnnotationServices(transaction).annotationService;
      const reconciliation = await transactionAnnotationService.reconcileForNote(
        note.id,
        version.contentHash,
        annotationChange
      );
      const changed = [];
      for (const annotationId of reconciliation.contentChangedAnnotationIds) {
        const annotation = await transaction.contentAnnotationRepository.findById(annotationId);
        changed.push(
          ...(await formalServices.knowledgeItemService.markEvidenceByAnnotationId(
            annotationId,
            annotation?.anchorStatus === 'missing' ? 'insufficient' : 'stale'
          ))
        );
      }
      await formalServices.questionService.markSourcesStale(
        'knowledgeEvidence',
        changed.map(evidence => evidence.id)
      );
      const oldVersionIds = (await transaction.noteVersionRepository.listIds({ noteId: note.id })).filter(
        id => id !== version.id
      );
      const directEvidence = await formalServices.knowledgeItemService.markEvidenceByNoteVersionIds(
        oldVersionIds,
        'stale',
        'noteVersion'
      );
      await formalServices.questionService.markSourcesStale(
        'knowledgeEvidence',
        directEvidence.map(record => record.id)
      );
      await formalServices.questionService.markSourcesStale('noteVersion', oldVersionIds);
    },
    onNoteDeleted: async noteId => {
      const changed = await formalServices.knowledgeItemService.markEvidenceByNoteId(noteId, 'invalid');
      await formalServices.questionService.markSourcesStale(
        'knowledgeEvidence',
        changed.map(evidence => evidence.id)
      );
      const versions = await transaction.noteVersionRepository.list({ noteId });
      await formalServices.questionService.markSourcesStale(
        'noteVersion',
        versions.map(version => version.id)
      );
    },
    onBeforePermanentDelete: async noteId => {
      if ((await transaction.knowledgeEvidenceRepository.list({ noteId })).length > 0) {
        throw conflictError(
          'NOTE_HAS_KNOWLEDGE_EVIDENCE',
          'Note has formal knowledge evidence and cannot be permanently deleted'
        );
      }
      const versions = await transaction.noteVersionRepository.list({ noteId });
      const versionIds = new Set(versions.map(version => version.id));
      const sources = await transaction.questionSourceRepository.list();
      if (sources.some(source => source.sourceType === 'noteVersion' && versionIds.has(source.sourceId))) {
        throw conflictError(
          'NOTE_HAS_QUESTION_SOURCE',
          'Note has a formal question source and cannot be permanently deleted'
        );
      }
      const snapshots = await transaction.analysisScopeRepository.list();
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
