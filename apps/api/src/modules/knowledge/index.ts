import { createNoteDependencyLifecycle } from './application/note-dependency-lifecycle.ts';
import {
  degradeInlineSourceEvidence,
  marksOnlyDependencies,
  withInlineAnnotations
} from './application/inline-annotations.ts';
import { createSpaceAssetLifecycle } from './application/space-asset-lifecycle.ts';
import { createInMemoryPdfAnnotationRepository } from '../pdf/repository.ts';
import { createNavigationReferencePolicy } from './application/navigation-reference-policy.ts';
import {
  taskCoverage,
  supplementPurgePreview,
  assertPurgeDatasetEpoch,
  assertManualPurgeScope
} from './application/asset-purge-guard.ts';
import { createNoteService } from './application/note-service.ts';
import { createFolderService } from './application/folder-service.ts';
import { createTagService } from './application/tag-service.ts';
import { createTagGroupService } from './application/tag-group-service.ts';
import { createKnowledgeSpaceService } from './application/knowledge-space-service.ts';
import { createSearchService } from './application/search-service.ts';
import { createContentAnnotationService } from './application/content-annotation-service.ts';
import { createInMemoryNoteRepository } from './infrastructure/note-repository.ts';
import { createInMemoryFolderRepository } from './infrastructure/folder-repository.ts';
import { createInMemoryTagRepository } from './infrastructure/tag-repository.ts';
import { createInMemoryTagGroupRepository } from './infrastructure/tag-group-repository.ts';
import { createInMemoryKnowledgeSpaceRepository } from './infrastructure/knowledge-space-repository.ts';
import { createInMemoryContentAnnotationRepository } from './infrastructure/content-annotation-repository.ts';
import {
  createInMemoryAnalysisScopeRepository,
  createInMemoryAnnotationExclusionRepository,
  createInMemoryAnnotationRevisionRepository
} from './infrastructure/annotation-support-repositories.ts';
import { createAnnotationScopeService } from './application/annotation-scope-service.ts';
import { createInMemoryNoteVersionRepository } from './infrastructure/note-version-repository.ts';
import { createInMemoryKnowledgeItemRepository } from './infrastructure/knowledge-item-repository.ts';
import { createKnowledgeArtifactProvenanceReader } from './application/knowledge-artifact-provenance-read.ts';
import { createInMemoryKnowledgeArtifactProvenanceRepository } from './infrastructure/knowledge-artifact-provenance-repository.ts';
import { createInMemoryKnowledgeEvidenceRepository } from './infrastructure/knowledge-evidence-repository.ts';
import { createInMemoryLearningObjectiveRepository } from './infrastructure/assessment-repository.ts';
import { createInMemoryExamProfileRepository } from './infrastructure/assessment-repository.ts';
import { createInMemoryExamFocusRepository } from './infrastructure/assessment-repository.ts';
import { createInMemoryQuestionRepository } from './infrastructure/assessment-repository.ts';
import { createInMemoryQuestionObjectiveRepository } from './infrastructure/assessment-repository.ts';
import { createInMemoryQuestionSourceRepository } from './infrastructure/assessment-repository.ts';
import { createNoteVersionService } from './application/note-version-service.ts';
import { buildNoteVersionPrunePreview } from './application/note-version-prune-preview.ts';
import { NOTE_VERSION_COALESCE_WINDOW_MS, selectCoalescibleVersion } from './application/note-version-coalescing.ts';
import { createKnowledgeItemService } from './application/knowledge-item-service.ts';
import { inspectKnowledgeItemPurge, assertKnowledgeItemPurgeAllowed } from './application/knowledge-item-purge.ts';
import { createLearningObjectiveService } from './application/learning-objective-service.ts';
import { createAssessmentContextService } from './application/assessment-context-service.ts';
import { createQuestionService } from './application/question-service.ts';
import { createLocalTrainingAssetLifecycle } from './application/training-asset-lifecycle.ts';
import { createWorkspaceQueryService } from './application/workspace-query-service.ts';
import { bindLocalServiceTransactions } from './application/local-service-transactions.ts';
import { conflictError, validationError } from './application/knowledge-errors.ts';

import type { NoteRecord } from './infrastructure/note-repository.ts';
import type { NoteVersionRecord } from './infrastructure/note-version-repository.ts';
import type {
  LocalTrainingAssetDependencies,
  TrainingPurgeInput
} from './application/training-asset-lifecycle-types.ts';
import type { SiblingNameInput } from './application/postgres-async/service-dependencies.ts';
import type { AnnotationReconcileContext } from './application/content-annotation-service.ts';
import type { FolderDeletionPackage } from './domain/folder.ts';

export interface KnowledgeModuleOptions {
  noteRepository?: ReturnType<typeof createInMemoryNoteRepository> | null;
  folderRepository?: ReturnType<typeof createInMemoryFolderRepository> | null;
  tagRepository?: ReturnType<typeof createInMemoryTagRepository> | null;
  tagGroupRepository?: ReturnType<typeof createInMemoryTagGroupRepository> | null;
  knowledgeSpaceRepository?: ReturnType<typeof createInMemoryKnowledgeSpaceRepository> | null;
  contentAnnotationRepository?: ReturnType<typeof createInMemoryContentAnnotationRepository> | null;
  pdfAnnotationRepository?: ReturnType<typeof createInMemoryPdfAnnotationRepository> | null;
  annotationExclusionRepository?: ReturnType<typeof createInMemoryAnnotationExclusionRepository> | null;
  annotationRevisionRepository?: ReturnType<typeof createInMemoryAnnotationRevisionRepository> | null;
  analysisScopeRepository?: ReturnType<typeof createInMemoryAnalysisScopeRepository> | null;
  noteVersionRepository?: ReturnType<typeof createInMemoryNoteVersionRepository> | null;
  knowledgeItemRepository?: ReturnType<typeof createInMemoryKnowledgeItemRepository> | null;
  knowledgeEvidenceRepository?: ReturnType<typeof createInMemoryKnowledgeEvidenceRepository> | null;
  knowledgeArtifactProvenanceRepository?: ReturnType<typeof createInMemoryKnowledgeArtifactProvenanceRepository> | null;
  learningObjectiveRepository?: ReturnType<typeof createInMemoryLearningObjectiveRepository> | null;
  examProfileRepository?: ReturnType<typeof createInMemoryExamProfileRepository> | null;
  examFocusRepository?: ReturnType<typeof createInMemoryExamFocusRepository> | null;
  questionRepository?: ReturnType<typeof createInMemoryQuestionRepository> | null;
  questionObjectiveRepository?: ReturnType<typeof createInMemoryQuestionObjectiveRepository> | null;
  questionSourceRepository?: ReturnType<typeof createInMemoryQuestionSourceRepository> | null;
  pdfAnnotations?: NonNullable<Parameters<typeof createInMemoryPdfAnnotationRepository>[0]>['records'];
  annotationExclusions?: NonNullable<Parameters<typeof createInMemoryAnnotationExclusionRepository>[0]>['records'];
  annotationRevisions?: NonNullable<Parameters<typeof createInMemoryAnnotationRevisionRepository>[0]>['records'];
  analysisScopeSnapshots?: NonNullable<Parameters<typeof createInMemoryAnalysisScopeRepository>[0]>['records'];
  noteVersions?: NonNullable<Parameters<typeof createInMemoryNoteVersionRepository>[0]>['records'];
  knowledgeItems?: NonNullable<Parameters<typeof createInMemoryKnowledgeItemRepository>[0]>['records'];
  knowledgeEvidence?: NonNullable<Parameters<typeof createInMemoryKnowledgeEvidenceRepository>[0]>['records'];
  knowledgeArtifactProvenance?: NonNullable<
    Parameters<typeof createInMemoryKnowledgeArtifactProvenanceRepository>[0]
  >['records'];
  learningObjectives?: NonNullable<Parameters<typeof createInMemoryLearningObjectiveRepository>[0]>['records'];
  examProfiles?: NonNullable<Parameters<typeof createInMemoryExamProfileRepository>[0]>['records'];
  examFocuses?: NonNullable<Parameters<typeof createInMemoryExamFocusRepository>[0]>['records'];
  questions?: NonNullable<Parameters<typeof createInMemoryQuestionRepository>[0]>['records'];
  questionObjectives?: NonNullable<Parameters<typeof createInMemoryQuestionObjectiveRepository>[0]>['records'];
  questionSources?: NonNullable<Parameters<typeof createInMemoryQuestionSourceRepository>[0]>['records'];
  inspectConceptPurge?: (id: string) => { links: number; relations: number };
  purgeConceptItem?: (id: string) => void;
  enforceReferences?: boolean;
  runTransaction?: <Result>(operation: () => Result) => Result;
  getPurgeTombstone?: LocalTrainingAssetDependencies['getTombstone'];
  readPurgeTaskState?: LocalTrainingAssetDependencies['readPurgeTaskState'];
  getPurgeDatasetEpoch?: LocalTrainingAssetDependencies['getPurgeDatasetEpoch'];
  noteVersionCoalescing?: { canDiscard?: (version: NoteVersionRecord) => boolean; windowMs?: number } | null;
}
type FolderDeleteInput = { mode?: string; destinationId?: string | null };
type KnowledgePurgeInput = TrainingPurgeInput & { expectedUpdatedAt?: unknown };

export function createKnowledgeModule(options: KnowledgeModuleOptions = {}) {
  const noteRepository = options.noteRepository ?? createInMemoryNoteRepository();
  const folderRepository = options.folderRepository ?? createInMemoryFolderRepository();
  const tagRepository = options.tagRepository ?? createInMemoryTagRepository();
  const tagGroupRepository = options.tagGroupRepository ?? createInMemoryTagGroupRepository();
  const knowledgeSpaceRepository = options.knowledgeSpaceRepository ?? createInMemoryKnowledgeSpaceRepository();
  const contentAnnotationRepository =
    options.contentAnnotationRepository ?? createInMemoryContentAnnotationRepository();
  const pdfAnnotationRepository =
    options.pdfAnnotationRepository ?? createInMemoryPdfAnnotationRepository({ records: options.pdfAnnotations ?? [] });
  const annotationExclusionRepository =
    options.annotationExclusionRepository ??
    createInMemoryAnnotationExclusionRepository({ records: options.annotationExclusions ?? [] });
  const annotationRevisionRepository =
    options.annotationRevisionRepository ??
    createInMemoryAnnotationRevisionRepository({ records: options.annotationRevisions ?? [] });
  const analysisScopeRepository =
    options.analysisScopeRepository ??
    createInMemoryAnalysisScopeRepository({ records: options.analysisScopeSnapshots ?? [] });
  const noteVersionRepository =
    options.noteVersionRepository ?? createInMemoryNoteVersionRepository({ records: options.noteVersions ?? [] });
  const knowledgeItemRepository =
    options.knowledgeItemRepository ?? createInMemoryKnowledgeItemRepository({ records: options.knowledgeItems ?? [] });
  const knowledgeEvidenceRepository =
    options.knowledgeEvidenceRepository ??
    createInMemoryKnowledgeEvidenceRepository({ records: options.knowledgeEvidence ?? [] });
  const knowledgeArtifactProvenanceRepository =
    options.knowledgeArtifactProvenanceRepository ??
    createInMemoryKnowledgeArtifactProvenanceRepository({ records: options.knowledgeArtifactProvenance ?? [] });
  const getKnowledgeProvenance = createKnowledgeArtifactProvenanceReader({
    knowledgeArtifactProvenanceRepository,
    knowledgeItemRepository,
    knowledgeEvidenceRepository,
    noteRepository,
    noteVersionRepository,
    knowledgeSpaceRepository
  });
  const learningObjectiveRepository =
    options.learningObjectiveRepository ??
    createInMemoryLearningObjectiveRepository({ records: options.learningObjectives ?? [] });
  const examProfileRepository =
    options.examProfileRepository ?? createInMemoryExamProfileRepository({ records: options.examProfiles ?? [] });
  const examFocusRepository =
    options.examFocusRepository ?? createInMemoryExamFocusRepository({ records: options.examFocuses ?? [] });
  const questionRepository =
    options.questionRepository ?? createInMemoryQuestionRepository({ records: options.questions ?? [] });
  const questionObjectiveRepository =
    options.questionObjectiveRepository ??
    createInMemoryQuestionObjectiveRepository({ records: options.questionObjectives ?? [] });
  const questionSourceRepository =
    options.questionSourceRepository ??
    createInMemoryQuestionSourceRepository({ records: options.questionSources ?? [] });
  const enforceReferences = options.enforceReferences ?? false;
  const runTransaction = options.runTransaction ?? (operation => operation());

  function normalizeComparableName(value: unknown) {
    return String(value ?? '').trim();
  }

  function assertSiblingNameAvailable({
    spaceId,
    parentId = null,
    folderId = null,
    title,
    name,
    currentFolderId = null,
    currentNoteId = null
  }: Omit<SiblingNameInput, 'spaceId'> & { spaceId?: string | null }) {
    const candidate = normalizeComparableName(name ?? title);
    if (!candidate) {
      return;
    }

    const conflictingFolder = folderRepository
      .list({ spaceId })
      .find(
        folder =>
          folder.parentId === parentId &&
          folder.id !== currentFolderId &&
          normalizeComparableName(folder.name) === candidate
      );
    if (conflictingFolder) {
      throw conflictError('SIBLING_NAME_CONFLICT', 'A file or folder with the same name already exists');
    }

    const conflictingNote = noteRepository
      .list({ spaceId, includeDeleted: true })
      .find(
        note =>
          !note.deleted &&
          note.folderId === folderId &&
          note.id !== currentNoteId &&
          normalizeComparableName(note.title) === candidate
      );
    if (conflictingNote) {
      throw conflictError('SIBLING_NAME_CONFLICT', 'A file or folder with the same name already exists');
    }
  }

  const { assertSpaceReference, assertNoteReferences, assertTagGroupReference, normalizeTagIds } =
    createNavigationReferencePolicy({
      knowledgeSpaceRepository,
      folderRepository,
      tagRepository,
      tagGroupRepository,
      enforceReferences
    });

  const noteVersionService = createNoteVersionService({ repository: noteVersionRepository });
  let learningObjectiveService: ReturnType<typeof createLearningObjectiveService> | null = null;
  let questionService: ReturnType<typeof createQuestionService> | null = null;
  const knowledgeItemService = createKnowledgeItemService({
    repository: knowledgeItemRepository,
    evidenceRepository: knowledgeEvidenceRepository,
    noteVersionRepository,
    annotationRepository: contentAnnotationRepository,
    noteRepository,
    getTombstone: options.getPurgeTombstone,
    onItemInvalidated: knowledgeItemId => {
      learningObjectiveService?.invalidateByKnowledgeItemId(knowledgeItemId);
      questionService?.markSourcesStale('knowledgeItem', [knowledgeItemId]);
    },
    runTransaction
  });
  learningObjectiveService = createLearningObjectiveService({
    repository: learningObjectiveRepository,
    knowledgeItemRepository,
    getTombstone: options.getPurgeTombstone,
    onObjectiveInvalidated: learningObjectiveId => {
      questionService?.invalidateByObjectiveId(learningObjectiveId);
    },
    runTransaction
  });
  const { profileService: examProfileService, focusService: examFocusService } = createAssessmentContextService({
    examProfileRepository,
    examFocusRepository,
    learningObjectiveRepository,
    getTombstone: options.getPurgeTombstone,
    runTransaction
  });
  questionService = createQuestionService({
    repository: questionRepository,
    questionObjectiveRepository,
    questionSourceRepository,
    learningObjectiveRepository,
    examFocusRepository,
    knowledgeItemRepository,
    noteRepository,
    noteVersionRepository,
    knowledgeEvidenceRepository,
    getTombstone: options.getPurgeTombstone,
    runTransaction
  });
  const trainingAssetLifecycle = createLocalTrainingAssetLifecycle({
    repositories: {
      learningObjectiveRepository,
      examProfileRepository,
      examFocusRepository,
      questionRepository,
      questionObjectiveRepository,
      questionSourceRepository,
      knowledgeItemRepository,
      analysisScopeRepository
    },
    runTransaction,
    getTombstone: options.getPurgeTombstone,
    readPurgeTaskState: options.readPurgeTaskState,
    getPurgeDatasetEpoch: options.getPurgeDatasetEpoch
  });
  const folderService = createFolderService({
    repository: folderRepository,
    validateSpaceReference: spaceId => assertSpaceReference(spaceId, 'FOLDER'),
    validateSiblingNameConflict: ({ spaceId, parentId, name, currentFolderId }) => {
      assertSiblingNameAvailable({
        spaceId,
        parentId,
        folderId: parentId,
        name,
        currentFolderId
      });
    }
  });
  const tagService = createTagService({
    repository: tagRepository,
    validateSpaceReference: spaceId => assertSpaceReference(spaceId, 'TAG'),
    validateGroupReference: assertTagGroupReference
  });
  const tagGroupService = createTagGroupService({
    repository: tagGroupRepository,
    tagRepository,
    validateSpaceReference: spaceId => assertSpaceReference(spaceId, 'TAG_GROUP')
  });
  const knowledgeSpaceService = createKnowledgeSpaceService({
    repository: knowledgeSpaceRepository,
    tagGroupRepository,
    runTransaction
  });
  const contentAnnotationService = createContentAnnotationService({
    repository: contentAnnotationRepository,
    noteRepository,
    noteVersionRepository,
    revisionRepository: annotationRevisionRepository,
    exclusionRepository: annotationExclusionRepository,
    onSourceChanged: annotation => {
      const changed = knowledgeItemService.markEvidenceByAnnotationId(
        /** @type {string} */ annotation.id,
        annotation.anchorStatus === 'missing' ? 'insufficient' : 'stale'
      );
      questionService?.markSourcesStale(
        'knowledgeEvidence',
        changed.map(evidence => evidence.id)
      );
    }
  });
  const annotationScopeService = createAnnotationScopeService({
    annotationRepository: contentAnnotationRepository,
    exclusionRepository: annotationExclusionRepository,
    analysisScopeRepository,
    noteRepository,
    noteVersionRepository,
    evidenceRepository: knowledgeEvidenceRepository,
    knowledgeItemRepository
  });
  // 仅在调用方提供 canDiscard（桌面端用它确认版本尚未同步、未被 AI 等外部记录引用）时启用。
  const versionCoalescing = options.noteVersionCoalescing ?? null;
  function isNoteVersionReferenced(version: NoteVersionRecord, noteId: string) {
    const mentions = (record: object) => {
      const text = JSON.stringify(record);
      return (
        (text.includes as (value: unknown) => boolean)(version.id) ||
        (text.includes as (value: unknown) => boolean)(version.contentHash)
      );
    };
    const annotations = contentAnnotationRepository.list({ noteId, includeDeleted: true });
    const annotationIds = new Set(annotations.map(item => item.id));
    return (
      annotations.some(mentions) ||
      annotationRevisionRepository.list().some(item => annotationIds.has(item.annotationId) && mentions(item)) ||
      annotationExclusionRepository.list({ includeDeleted: true }).some(mentions) ||
      knowledgeEvidenceRepository.list({ noteId }).some(mentions) ||
      knowledgeEvidenceRepository.list({ noteVersionId: version.id }).length > 0 ||
      knowledgeArtifactProvenanceRepository.list().some(mentions) ||
      questionSourceRepository.list().some(mentions) ||
      analysisScopeRepository.list({ includeDeleted: true }).some(mentions)
    );
  }
  function coalescePreviousVersion(
    note: Pick<NoteRecord, 'id'>,
    version: NoteVersionRecord,
    annotationChange: AnnotationReconcileContext | null | undefined
  ) {
    if (!versionCoalescing?.canDiscard) return;
    const versions = noteVersionRepository.list({ noteId: note.id });
    // 恢复已清理的私有副本时会生成同正文新 ID，也不能合并恢复前的正文。
    if (versions.some(item => item.id !== version.id && item.contentHash === version.contentHash)) return;
    const previous = selectCoalescibleVersion({
      versions,
      current: version,
      windowMs: versionCoalescing.windowMs ?? NOTE_VERSION_COALESCE_WINDOW_MS
    });
    // 只合并本次编辑的直接前像。A→B→恢复A→C 时，B 是恢复检查点而非 C 的前像；
    // 该边界由持久版本和当前正文推导，重启后仍有效。
    if (
      !previous ||
      previous.content !== annotationChange?.before ||
      isNoteVersionReferenced(previous, note.id) ||
      !versionCoalescing.canDiscard(previous)
    )
      return;
    noteVersionRepository.deleteById(previous.id);
  }
  // 影子比对已随旧链路删除（I4b）；保留空实现以维持依赖级联的冻结调用序列。
  const annotationIdentityShadow = { observe: () => null };
  const noteDependencies = {
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
  };
  const noteService = createNoteService({
    repository: noteRepository,
    annotationRepository: contentAnnotationRepository,
    validateNoteReferences: assertNoteReferences,
    normalizeTagIds,
    noteVersionService,
    runTransaction,
    // 重点内联化：只改标记的保存不让旧版本证据过期；级联完成后从正文派生内联重点行。
    ...withInlineAnnotations(createNoteDependencyLifecycle(noteDependencies), {
      repository: contentAnnotationRepository,
      revisionRepository: annotationRevisionRepository,
      marksOnlyLifecycle: createNoteDependencyLifecycle(marksOnlyDependencies(noteDependencies)),
      onSourceChanged: degradeInlineSourceEvidence(noteDependencies)
    }),
    validateSiblingNameConflict: ({ spaceId, folderId, title, currentNoteId }) => {
      assertSiblingNameAvailable({
        spaceId,
        parentId: folderId,
        folderId,
        title,
        currentNoteId
      });
    }
  });
  const searchService = createSearchService({
    findKnowledgeSpace: spaceId => knowledgeSpaceRepository.findById(spaceId),
    listNotes: options => noteService.listNotes(options)
  });
  const workspaceQueryService = createWorkspaceQueryService({
    repositories: {
      noteRepository,
      noteVersionRepository,
      knowledgeItemRepository,
      knowledgeEvidenceRepository,
      learningObjectiveRepository,
      examProfileRepository,
      examFocusRepository,
      questionRepository,
      questionObjectiveRepository,
      questionSourceRepository
    }
  });

  function deleteFolderAndCleanup(folderId: string, input: FolderDeleteInput = {}) {
    return runTransaction(() => {
      const subtreeIds = folderService.getFolderSubtreeIds(folderId);
      const root = folderRepository.findById(folderId)!;
      const mode = input.mode;
      if (!(['keep', 'with-content'] as readonly (string | undefined)[]).includes(mode))
        throw validationError('FOLDER_DELETE_MODE_REQUIRED', '请选择保留并移动内容，或将内容一起移入回收站');
      const destinationId = Object.hasOwn(input, 'destinationId') ? input.destinationId : (root.parentId ?? null);
      if (mode === 'keep' && destinationId) {
        const destination = folderRepository.findById(destinationId);
        if (
          !destination ||
          destination.deletedAt ||
          destination.spaceId !== root.spaceId ||
          subtreeIds.includes(destinationId)
        )
          throw conflictError('FOLDER_DESTINATION_INVALID', '目标文件夹不可用');
      }
      const notes = noteRepository
        .list({ spaceId: root.spaceId, includeDeleted: true })
        .filter(note => (subtreeIds as readonly (string | null | undefined)[]).includes(note.folderId));
      const packageId = `folder-${folderId}-${Date.now()}`;
      const noteIds = [];
      for (const note of notes.filter(note => !note.deleted)) {
        if (mode === 'keep') {
          noteService.updateNote(note.id, { folderId: destinationId });
          noteIds.push(note.id);
        } else {
          const deleted = noteService.deleteNote(note.id);
          noteRepository.save({ ...deleted, folderDeletionPackageId: packageId });
          noteIds.push(note.id);
        }
      }
      const deletionPackage = {
        id: packageId,
        mode: mode as FolderDeletionPackage['mode'],
        folderIds: subtreeIds,
        noteIds,
        destinationId
      };
      return { folders: folderService.trashFolder(folderId, deletionPackage), deletionPackage };
    });
  }

  function restoreDeletedFolder(folderId: string) {
    return runTransaction(() => {
      const root = folderRepository.findById(folderId);
      const deletionPackage = root?.deletionPackage;
      if (!deletionPackage) throw conflictError('FOLDER_NOT_IN_TRASH', '文件夹不在回收站中');
      const folders = folderService.restoreDeletedFolder(folderId);
      for (const noteId of deletionPackage.mode === 'with-content' ? deletionPackage.noteIds : []) {
        const note = noteRepository.findById(noteId);
        if (note?.deleted && note.folderDeletionPackageId === deletionPackage.id) noteService.restoreNote(noteId);
      }
      return { folders, deletionPackage };
    });
  }

  function deleteTagAndCleanup(tagId: string) {
    const tag = tagRepository.findById(tagId);
    if (tag?.isSystem) throw conflictError('SYSTEM_TAG_PROTECTED', 'System tags cannot be deleted');
    return runTransaction(() => {
      noteService.removeTagFromAllNotes(tagId);
      return tagService.deleteTag(tagId);
    });
  }

  function mergeTags(sourceTagId: string, targetTagId: string) {
    const source = tagRepository.findById(sourceTagId);
    const target = tagRepository.findById(targetTagId);
    if (!source || !target) throw validationError('TAG_MERGE_TARGET_INVALID', 'Both tags must exist');
    if (source.isSystem) throw conflictError('SYSTEM_TAG_PROTECTED', 'System tags cannot be merged');
    if (source.spaceId !== target.spaceId)
      throw validationError('TAG_SPACE_MISMATCH', 'Tags must belong to the same space');
    return runTransaction(() => {
      noteService.replaceTagInAllNotes(sourceTagId, targetTagId);
      tagRepository.delete(sourceTagId);
      return target;
    });
  }

  function inspectKnowledgePurge(id: string) {
    const item = knowledgeItemRepository.findById(id);
    return supplementPurgePreview(
      inspectKnowledgeItemPurge({
        item,
        conceptCleanup: options.inspectConceptPurge?.(id),
        evidence: knowledgeEvidenceRepository.list({ knowledgeItemId: id }),
        provenance: knowledgeArtifactProvenanceRepository.list({ artifactId: id }),
        learningObjectives: learningObjectiveRepository.list({ includeArchived: true, includeDeleted: true }),
        questionSources: questionSourceRepository.list(),
        analysisScopes: analysisScopeRepository.list({ includeDeleted: true })
      }),
      taskCoverage(options.readPurgeTaskState),
      options.getPurgeDatasetEpoch?.()
    );
  }

  function permanentlyDeleteKnowledgeItem(id: string, input: KnowledgePurgeInput = {}) {
    const { expectedUpdatedAt } = input;
    return runTransaction(() => {
      assertPurgeDatasetEpoch(input, options.getPurgeDatasetEpoch?.());
      if (!knowledgeItemRepository.findById(id)) {
        const tombstone = options.getPurgeTombstone?.('knowledgeItems', id);
        if (
          !expectedUpdatedAt ||
          !tombstone ||
          (tombstone.previousUpdatedAt && tombstone.previousUpdatedAt !== expectedUpdatedAt)
        ) {
          throw validationError('KNOWLEDGE_ITEM_NOT_FOUND', '知识点不存在');
        }
        return {
          status: 'already-purged',
          asset: { type: 'knowledgeItem', id },
          exclusiveRecordsDeleted: { knowledgeEvidence: 0, knowledgeArtifactProvenance: 0 },
          offlineDevices: 'pending-sync',
          backups: 'retention-managed'
        };
      }
      const preflight = inspectKnowledgePurge(id);
      assertKnowledgeItemPurgeAllowed(preflight, expectedUpdatedAt);
      assertManualPurgeScope(
        'knowledgeItem',
        knowledgeItemRepository.findById(id)!,
        input,
        knowledgeArtifactProvenanceRepository.list({ artifactId: id })
      );
      options.purgeConceptItem?.(id);
      const removedProvenance = knowledgeArtifactProvenanceRepository.deleteByKnowledgeItemId(id);
      const removedEvidence = knowledgeEvidenceRepository.deleteByKnowledgeItemId(id);
      knowledgeItemRepository.delete(id);
      return {
        status: 'subject-purged',
        asset: preflight.asset,
        exclusiveRecordsDeleted: {
          knowledgeEvidence: removedEvidence.length,
          knowledgeArtifactProvenance: removedProvenance.length
        },
        offlineDevices: 'pending-sync',
        backups: 'retention-managed'
      };
    });
  }

  function previewNoteVersionPrune(noteId: string) {
    const note = noteRepository.findById(noteId);
    if (!note) throw validationError('NOTE_NOT_FOUND', '笔记不存在');
    return buildNoteVersionPrunePreview({
      note,
      versions: noteVersionRepository.list({ noteId }),
      provenance: knowledgeArtifactProvenanceRepository.list(),
      evidence: knowledgeEvidenceRepository.list({ noteId }),
      questionSources: questionSourceRepository.list(),
      annotations: contentAnnotationRepository.list({ noteId, includeDeleted: true }),
      exclusions: annotationExclusionRepository.list({ includeDeleted: true }),
      analysisScopes: analysisScopeRepository.list({ includeDeleted: true })
    });
  }

  const { inspectEmptySpaceDeletion, deleteEmptySpace, previewSpaceMigration, migrateSpaceAssets } =
    createSpaceAssetLifecycle({
      knowledgeSpaceRepository,
      folderRepository,
      noteRepository,
      tagRepository,
      tagGroupRepository,
      contentAnnotationRepository,
      pdfAnnotationRepository,
      analysisScopeRepository,
      noteVersionRepository,
      runTransaction
    });

  // New service operations default to a transaction; only explicitly read-only
  // methods skip the snapshot/commit boundary. Nested writes share one commit.
  for (const [service, reads] of [
    [noteService, ['getNote', 'getLinkedNotes', 'getNoteLinkRelations', 'listNotes']],
    [folderService, ['listFolders', 'listFolderTree', 'getFolderSubtreeIds']],
    [tagService, ['listTags']],
    [tagGroupService, ['listTagGroups']],
    [knowledgeSpaceService, ['listKnowledgeSpaces', 'createDefaultKnowledgeSpace']],
    [contentAnnotationService, ['listAnnotationsByNote', 'getAnnotation']],
    [annotationScopeService, ['previewAnnotation', 'getKnowledgeLinks', 'previewAnalysisScope', 'getAnalysisScope']],
    [noteVersionService, ['getVersion', 'listVersions']],
    [knowledgeItemService, ['getItem', 'listItems', 'listEvidence']],
    [learningObjectiveService, ['getObjective', 'listObjectives']],
    [examProfileService, ['get', 'list']],
    [examFocusService, ['get', 'list']],
    [questionService, ['getQuestion', 'listQuestions']]
  ] as const) {
    bindLocalServiceTransactions(service, runTransaction, reads);
  }

  return {
    repositories: {
      noteRepository,
      folderRepository,
      tagRepository,
      tagGroupRepository,
      knowledgeSpaceRepository,
      contentAnnotationRepository,
      pdfAnnotationRepository,
      annotationExclusionRepository,
      annotationRevisionRepository,
      analysisScopeRepository,
      noteVersionRepository,
      knowledgeItemRepository,
      knowledgeEvidenceRepository,
      knowledgeArtifactProvenanceRepository,
      learningObjectiveRepository,
      examProfileRepository,
      examFocusRepository,
      questionRepository,
      questionObjectiveRepository,
      questionSourceRepository
    },
    noteService,
    folderService,
    tagService,
    tagGroupService,
    contentAnnotationService,
    annotationScopeService,
    knowledgeSpaceService,
    searchService,
    noteVersionService,
    knowledgeItemService,
    learningObjectiveService,
    examProfileService,
    examFocusService,
    questionService,
    trainingAssetLifecycle,
    workspaceQueryService,
    deleteFolderAndCleanup,
    restoreDeletedFolder,
    deleteTagAndCleanup,
    mergeTags,
    getKnowledgeProvenance,
    inspectKnowledgePurge,
    permanentlyDeleteKnowledgeItem,
    previewNoteVersionPrune,
    inspectEmptySpaceDeletion,
    deleteEmptySpace,
    previewSpaceMigration,
    migrateSpaceAssets
  };
}
