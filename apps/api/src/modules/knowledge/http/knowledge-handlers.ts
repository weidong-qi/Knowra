import type {
  AnnotationHttpPort,
  ScopeHttpPort,
  KnowledgeServiceKeys,
  HttpInput,
  Input
} from './handler-input-types.ts';
import { assertCommandSearchOwner } from '../application/command-note-search.ts';

import type { createKnowledgeModule } from '../index.js';
import type { createNoteDeletionCoordinator } from '../application/note-deletion-coordinator.ts';
import type { createContentAnnotationService } from '../application/content-annotation-service.ts';
import type { createAnnotationScopeService } from '../application/annotation-scope-service.ts';
import type { TrainingAssetKind } from '../application/training-asset-lifecycle-types.ts';
type AnnotationService = ReturnType<typeof createContentAnnotationService>;
type ScopeService = ReturnType<typeof createAnnotationScopeService>;
type Module = ReturnType<typeof createKnowledgeModule>;
interface KnowledgeHttpModule extends Pick<Module, KnowledgeServiceKeys> {
  repositories: Required<Pick<Module['repositories'], 'knowledgeSpaceRepository'>>;
  contentAnnotationService: AnnotationHttpPort<AnnotationService>;
  annotationScopeService: ScopeHttpPort<ScopeService>;
}
interface KnowledgeHttpDependencies {
  knowledgeModule: KnowledgeHttpModule;
  noteDeletionCoordinator?: ReturnType<typeof createNoteDeletionCoordinator> | null;
  ownerId?: string;
}

export function createKnowledgeHttpHandlers({
  knowledgeModule,
  noteDeletionCoordinator,
  ownerId = 'demo'
}: KnowledgeHttpDependencies) {
  const {
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
    getKnowledgeProvenance,
    inspectKnowledgePurge,
    permanentlyDeleteKnowledgeItem,
    previewNoteVersionPrune,
    inspectEmptySpaceDeletion,
    deleteEmptySpace,
    previewSpaceMigration,
    migrateSpaceAssets,
    learningObjectiveService,
    examProfileService,
    examFocusService,
    questionService,
    trainingAssetLifecycle,
    deleteFolderAndCleanup,
    restoreDeletedFolder,
    deleteTagAndCleanup,
    mergeTags
  } = knowledgeModule;

  // 只为HTTP入参提供上下文；实际返回类型仍从实现推导。
  type HandlerInputs = {
    createNote: [body: Input<typeof noteService.createNote>];
    importMarkdown: [body: Input<typeof noteService.importMarkdown>];
    importMarkdownBatch: [body: HttpInput];
    getNote: [params: { id: string }, query?: HttpInput];
    getLinkedNotes: [params: { id: string }];
    getNoteLinkRelations: [params: { id: string }];
    listNotes: [query?: Input<typeof noteService.listNotes>];
    updateNote: [params: { id: string }, body: Input<typeof noteService.updateNote, 1>];
    deleteNote: [params: { id: string }];
    deleteNotes: [body?: HttpInput];
    restoreNote: [params: { id: string }];
    permanentlyDeleteNote: [params: { id: string }];
    emptyRecycleBin: [query?: HttpInput];
    setFavorite: [params: { id: string }, body?: HttpInput];
    removeTagFromNote: [params: { id: string; tagId: string }];
    assignTagToNote: [params: { id: string }, body?: HttpInput];
    assignTagToNotes: [body?: HttpInput];
    setNoteTags: [params: { id: string }, body: HttpInput];
    createFolder: [body: Input<typeof folderService.createFolder>];
    updateFolder: [params: { id: string }, body: Input<typeof folderService.updateFolder, 1>];
    deleteFolder: [params: { id: string }, body: Input<typeof deleteFolderAndCleanup, 1>];
    restoreFolder: [params: { id: string }];
    listFolders: [query?: Input<typeof folderService.listFolders>];
    listFolderTree: [query?: Input<typeof folderService.listFolderTree>];
    createTag: [body: Input<typeof tagService.createTag>];
    updateTag: [params: { id: string }, body: Input<typeof tagService.updateTag, 1>];
    deleteTag: [params: { id: string }];
    listTags: [query?: Input<typeof tagService.listTags>];
    reorderTags: [body?: HttpInput];
    mergeTags: [body?: HttpInput];
    createTagGroup: [body: Input<typeof tagGroupService.createTagGroup>];
    updateTagGroup: [params: { id: string }, body: Input<typeof tagGroupService.updateTagGroup, 1>];
    deleteTagGroup: [params: { id: string }];
    listTagGroups: [query?: Input<typeof tagGroupService.listTagGroups>];
    updateTagsForNotes: [body?: HttpInput];
    createAnnotation: [body: Input<typeof contentAnnotationService.createAnnotation>];
    listAnnotations: [query?: Input<typeof contentAnnotationService.listAnnotationsByNote>];
    getAnnotation: [params: { id: string }];
    updateAnnotation: [params: { id: string }, body: Input<typeof contentAnnotationService.updateAnnotation, 1>];
    deleteAnnotation: [params: { id: string }, body: Input<typeof contentAnnotationService.deleteAnnotation, 1>];
    restoreAnnotation: [params: { id: string }, body: Input<typeof contentAnnotationService.restoreAnnotation, 1>];
    updateAnnotationAnchor: [
      params: { id: string },
      body: Input<typeof contentAnnotationService.updateAnnotationAnchor, 1>
    ];
    confirmAnnotationRange: [
      params: { id: string },
      body: Input<typeof contentAnnotationService.confirmAnnotationRange, 1>
    ];
    previewAnnotation: [params: { id: string }];
    createAnnotationExclusion: [params: { id: string }, body: Input<typeof annotationScopeService.createExclusion, 1>];
    deleteAnnotationExclusion: [
      params: { id: string; exclusionId: string },
      body: Input<typeof annotationScopeService.deleteExclusion, 2>
    ];
    getAnnotationKnowledgeLinks: [params: { id: string }];
    previewAnalysisScope: [body: Input<typeof annotationScopeService.previewAnalysisScope>];
    createAnalysisScope: [body: Input<typeof annotationScopeService.createAnalysisScope>];
    getAnalysisScope: [params: { id: string }, query: HttpInput];
    listAnalysisScopes: [query: Input<typeof annotationScopeService.listAnalysisScopes>];
    trashAnalysisScope: [params: { id: string }, body: Input<typeof annotationScopeService.trashAnalysisScope, 1>];
    restoreDeletedAnalysisScope: [
      params: { id: string },
      body: Input<typeof annotationScopeService.restoreAnalysisScope, 1>
    ];
    listNoteVersions: [params: { id: string }, query?: Input<typeof noteVersionService.listVersionPage, 1>];
    getNoteVersion: [params: { id: string; versionId: string }];
    previewNoteVersionPrune: [params: { id: string }];
    listKnowledgeItems: [query?: Input<typeof knowledgeItemService.listItems>];
    getKnowledgeItem: [params: { id: string }];
    createKnowledgeItem: [body: Input<typeof knowledgeItemService.createCandidate>];
    updateKnowledgeItem: [params: { id: string }, body: Input<typeof knowledgeItemService.updateItem, 1>];
    confirmKnowledgeItem: [params: { id: string }, body: Input<typeof knowledgeItemService.confirmItem, 1>];
    markKnowledgeItemNeedsRevision: [
      params: { id: string },
      body: Input<typeof knowledgeItemService.markNeedsRevision, 1>
    ];
    archiveKnowledgeItem: [params: { id: string }, body: Input<typeof knowledgeItemService.archive, 1>];
    restoreKnowledgeItem: [params: { id: string }, body: Input<typeof knowledgeItemService.restore, 1>];
    trashKnowledgeItem: [params: { id: string }, body: Input<typeof knowledgeItemService.trash, 1>];
    restoreDeletedKnowledgeItem: [params: { id: string }, body: Input<typeof knowledgeItemService.restoreDeleted, 1>];
    inspectKnowledgePurge: [params: { id: string }];
    permanentlyDeleteKnowledgeItem: [params: { id: string }, body: Input<typeof permanentlyDeleteKnowledgeItem, 1>];
    getKnowledgeProvenance: [params: { id: string }];
    listKnowledgeEvidence: [params: { id: string }];
    createKnowledgeEvidence: [params: { id: string }, body: HttpInput];
    retireKnowledgeEvidence: [
      params: { id: string; evidenceId: string },
      body: Input<typeof knowledgeItemService.retireEvidence, 2>
    ];
    readoptKnowledgeEvidence: [
      params: { id: string; evidenceId: string },
      body: Input<typeof knowledgeItemService.readoptEvidence, 2>
    ];
    listLearningObjectives: [query?: Input<typeof learningObjectiveService.listObjectives>];
    getLearningObjective: [params: { id: string }];
    createLearningObjective: [body: Input<typeof learningObjectiveService.createCandidate>];
    updateLearningObjective: [params: { id: string }, body: Input<typeof learningObjectiveService.updateObjective, 1>];
    confirmLearningObjective: [
      params: { id: string },
      body: Input<typeof learningObjectiveService.confirmObjective, 1>
    ];
    requestLearningObjectiveRevision: [params: { id: string }, body?: HttpInput];
    archiveLearningObjective: [params: { id: string }];
    restoreLearningObjective: [params: { id: string }];
    listExamProfiles: [query?: Input<typeof examProfileService.list>];
    getExamProfile: [params: { id: string }];
    createExamProfile: [body: Input<typeof examProfileService.create>];
    updateExamProfile: [params: { id: string }, body: Input<typeof examProfileService.update, 1>];
    archiveExamProfile: [params: { id: string }];
    restoreExamProfile: [params: { id: string }];
    listExamFocuses: [query?: Input<typeof examFocusService.list>];
    getExamFocus: [params: { id: string }];
    createExamFocus: [body: Input<typeof examFocusService.create>];
    updateExamFocus: [params: { id: string }, body: Input<typeof examFocusService.update, 1>];
    confirmExamFocus: [params: { id: string }];
    archiveExamFocus: [params: { id: string }];
    restoreExamFocus: [params: { id: string }];
    listQuestions: [query?: Input<typeof questionService.listQuestions>];
    getQuestion: [params: { id: string }];
    createQuestion: [body: Input<typeof questionService.createQuestion>];
    updateQuestion: [params: { id: string }, body: Input<typeof questionService.updateQuestion, 1>];
    validateQuestion: [params: { id: string }];
    submitQuestionForReview: [params: { id: string }];
    confirmQuestion: [params: { id: string }];
    archiveQuestion: [params: { id: string }];
    restoreQuestion: [params: { id: string }];
    inspectTrainingAssetPurge: [params: { type: TrainingAssetKind; id: string }];
    trashTrainingAsset: [params: { type: TrainingAssetKind; id: string }];
    restoreDeletedTrainingAsset: [params: { type: TrainingAssetKind; id: string }];
    permanentlyDeleteTrainingAsset: [
      params: { type: TrainingAssetKind; id: string },
      body: NonNullable<Input<typeof trainingAssetLifecycle.purge, 3>> & { expectedUpdatedAt?: unknown }
    ];
    getKnowledgeOverview: [];
    getTrainingOverview: [];
    listWorkspaceKnowledgeItems: [query?: Input<typeof knowledgeModule.workspaceQueryService.listKnowledgeItems>];
    listWorkspaceLearningObjectives: [
      query?: Input<typeof knowledgeModule.workspaceQueryService.listLearningObjectives>
    ];
    listWorkspaceQuestions: [query?: Input<typeof knowledgeModule.workspaceQueryService.listQuestions>];
    listWorkspaceExamProfiles: [query?: Input<typeof knowledgeModule.workspaceQueryService.listExamProfiles>];
    listReviewQueue: [query?: Input<typeof knowledgeModule.workspaceQueryService.listReviewQueue>];
    createDefaultKnowledgeSpace: [];
    createKnowledgeSpace: [body: HttpInput];
    listKnowledgeSpaces: [query?: HttpInput];
    inspectEmptySpaceDeletion: [params: { id: string }];
    deleteEmptySpace: [params: { id: string }, body: Input<typeof deleteEmptySpace, 1>];
    previewSpaceMigration: [params: { id: string }, query: HttpInput];
    migrateSpaceAssets: [params: { id: string }, body: Input<typeof migrateSpaceAssets, 1>];
    searchNotes: [query?: Input<typeof searchService.searchCommandNotes> & { result?: string }];
  };
  return {
    createNote(body) {
      return noteService.createNote(body);
    },
    importMarkdown(body) {
      return noteService.importMarkdown(body);
    },
    importMarkdownBatch(body) {
      return noteService.importMarkdownBatch((body.items ?? []) as Input<typeof noteService.importMarkdownBatch>);
    },
    getNote(params, query = {}) {
      return noteService.getNote(params.id, {
        includeDeleted: query.includeDeleted
      } as Input<typeof noteService.getNote, 1>);
    },
    getLinkedNotes(params) {
      return noteService.getLinkedNotes(params.id);
    },
    getNoteLinkRelations(params) {
      const note = noteService.getNote(params.id);
      assertCommandSearchOwner(knowledgeModule.repositories.knowledgeSpaceRepository.findById(note.spaceId), ownerId);
      return noteService.getNoteLinkRelations(params.id);
    },
    listNotes(query = {}) {
      return noteService.listNotes(query);
    },
    updateNote(params, body) {
      return noteService.updateNote(params.id, body);
    },
    deleteNote(params) {
      return noteService.deleteNote(params.id);
    },
    deleteNotes(body = {}) {
      return noteService.deleteNotes((body.noteIds ?? []) as Input<typeof noteService.deleteNotes>);
    },
    restoreNote(params) {
      return noteService.restoreNote(params.id);
    },
    permanentlyDeleteNote(params) {
      return (noteDeletionCoordinator ?? noteService).permanentlyDeleteNote(params.id);
    },
    emptyRecycleBin(query = {}) {
      return (noteDeletionCoordinator ?? noteService).emptyRecycleBin((query.spaceId ?? null) as string | null);
    },
    setFavorite(params, body = {}) {
      return noteService.setFavorite(params.id, (body.favorite ?? true) as Input<typeof noteService.setFavorite, 1>);
    },
    removeTagFromNote(params) {
      return noteService.removeTagFromNote(params.id, params.tagId);
    },
    assignTagToNote(params, body = {}) {
      return noteService.assignTagToNote(params.id, body.tagId as Input<typeof noteService.assignTagToNote, 1>);
    },
    assignTagToNotes(body = {}) {
      return noteService.assignTagToNotes(
        (body.noteIds ?? []) as Input<typeof noteService.assignTagToNotes>,
        body.tagId as Input<typeof noteService.assignTagToNotes, 1>
      );
    },
    setNoteTags(params, body) {
      return noteService.setNoteTags(params.id, (body.tagIds ?? []) as Input<typeof noteService.setNoteTags, 1>);
    },
    createFolder(body) {
      return folderService.createFolder(body);
    },
    updateFolder(params, body) {
      return folderService.updateFolder(params.id, body);
    },
    deleteFolder(params, body) {
      return deleteFolderAndCleanup(params.id, body);
    },
    restoreFolder(params) {
      return restoreDeletedFolder(params.id);
    },
    listFolders(query = {}) {
      return folderService.listFolders(query);
    },
    listFolderTree(query = {}) {
      return folderService.listFolderTree(query);
    },
    createTag(body) {
      return tagService.createTag(body);
    },
    updateTag(params, body) {
      return tagService.updateTag(params.id, body);
    },
    deleteTag(params) {
      return deleteTagAndCleanup(params.id);
    },
    listTags(query = {}) {
      return tagService.listTags(query);
    },
    reorderTags(body = {}) {
      return tagService.reorderTags((body.tagIds ?? []) as Input<typeof tagService.reorderTags>);
    },
    mergeTags(body = {}) {
      return mergeTags(body.sourceTagId as Input<typeof mergeTags>, body.targetTagId as Input<typeof mergeTags, 1>);
    },
    createTagGroup(body) {
      return tagGroupService.createTagGroup(body);
    },
    updateTagGroup(params, body) {
      return tagGroupService.updateTagGroup(params.id, body);
    },
    deleteTagGroup(params) {
      return tagGroupService.deleteTagGroup(params.id);
    },
    listTagGroups(query = {}) {
      return tagGroupService.listTagGroups(query);
    },
    updateTagsForNotes(body = {}) {
      return noteService.updateTagsForNotes(
        (body.noteIds ?? []) as Input<typeof noteService.updateTagsForNotes>,
        (body.addTagIds ?? []) as Input<typeof noteService.updateTagsForNotes, 1>,
        (body.removeTagIds ?? []) as Input<typeof noteService.updateTagsForNotes, 2>
      );
    },
    createAnnotation(body) {
      return contentAnnotationService.createAnnotation(body);
    },
    listAnnotations(query = {}) {
      return contentAnnotationService.listAnnotationsByNote(query);
    },
    getAnnotation(params) {
      return contentAnnotationService.getAnnotation(params.id);
    },
    updateAnnotation(params, body) {
      return contentAnnotationService.updateAnnotation(params.id, body);
    },
    deleteAnnotation(params, body) {
      return contentAnnotationService.deleteAnnotation(params.id, body);
    },
    restoreAnnotation(params, body) {
      return contentAnnotationService.restoreAnnotation(params.id, body);
    },
    updateAnnotationAnchor(params, body) {
      return contentAnnotationService.updateAnnotationAnchor(params.id, body);
    },
    confirmAnnotationRange: (params, body) => contentAnnotationService.confirmAnnotationRange(params.id, body),
    previewAnnotation(params) {
      return annotationScopeService.previewAnnotation(params.id);
    },
    createAnnotationExclusion(params, body) {
      return annotationScopeService.createExclusion(params.id, body);
    },
    deleteAnnotationExclusion(params, body) {
      return annotationScopeService.deleteExclusion(params.id, params.exclusionId, body);
    },
    getAnnotationKnowledgeLinks(params) {
      return annotationScopeService.getKnowledgeLinks(params.id);
    },
    previewAnalysisScope(body) {
      return annotationScopeService.previewAnalysisScope(body);
    },
    createAnalysisScope(body) {
      return annotationScopeService.createAnalysisScope(body);
    },
    getAnalysisScope(params, query) {
      return annotationScopeService.getAnalysisScope(
        params.id,
        query.spaceId as Input<typeof annotationScopeService.getAnalysisScope, 1>
      );
    },
    listAnalysisScopes(query) {
      return annotationScopeService.listAnalysisScopes(query);
    },
    trashAnalysisScope(params, body) {
      return annotationScopeService.trashAnalysisScope(params.id, body);
    },
    restoreDeletedAnalysisScope(params, body) {
      return annotationScopeService.restoreAnalysisScope(params.id, body);
    },
    listNoteVersions(params, query = {}) {
      const note = noteService.getNote(params.id);
      return query.limit !== undefined || query.cursor !== undefined
        ? noteVersionService.listVersionPage(note, query)
        : noteVersionService.listVersions({ ...query, noteId: params.id } as Parameters<
            typeof noteVersionService.listVersions
          >[0]);
    },
    getNoteVersion(params) {
      noteService.getNote(params.id);
      return noteVersionService.getVersion(params.versionId, params.id);
    },
    previewNoteVersionPrune(params) {
      return previewNoteVersionPrune(params.id);
    },
    listKnowledgeItems(query = {}) {
      return knowledgeItemService.listItems(query);
    },
    getKnowledgeItem(params) {
      return knowledgeItemService.getItem(params.id);
    },
    createKnowledgeItem(body) {
      return knowledgeItemService.createCandidate(body);
    },
    updateKnowledgeItem(params, body) {
      return knowledgeItemService.updateItem(params.id, body);
    },
    confirmKnowledgeItem(params, body) {
      return knowledgeItemService.confirmItem(params.id, body);
    },
    markKnowledgeItemNeedsRevision(params, body) {
      return knowledgeItemService.markNeedsRevision(params.id, body);
    },
    archiveKnowledgeItem(params, body) {
      return knowledgeItemService.archive(params.id, body);
    },
    restoreKnowledgeItem(params, body) {
      return knowledgeItemService.restore(params.id, body);
    },
    trashKnowledgeItem(params, body) {
      return knowledgeItemService.trash(params.id, body);
    },
    restoreDeletedKnowledgeItem(params, body) {
      return knowledgeItemService.restoreDeleted(params.id, body);
    },
    inspectKnowledgePurge(params) {
      return inspectKnowledgePurge(params.id);
    },
    permanentlyDeleteKnowledgeItem(params, body) {
      return permanentlyDeleteKnowledgeItem(params.id, body);
    },
    getKnowledgeProvenance: params => getKnowledgeProvenance(params.id, ownerId),
    listKnowledgeEvidence(params) {
      return knowledgeItemService.listEvidence(params.id);
    },
    createKnowledgeEvidence(params, body) {
      return knowledgeItemService.createEvidence({ ...body, knowledgeItemId: params.id } as Parameters<
        typeof knowledgeItemService.createEvidence
      >[0]);
    },
    retireKnowledgeEvidence(params, body) {
      return knowledgeItemService.retireEvidence(params.id, params.evidenceId, body);
    },
    readoptKnowledgeEvidence(params, body) {
      return knowledgeItemService.readoptEvidence(params.id, params.evidenceId, body);
    },
    listLearningObjectives(query = {}) {
      return learningObjectiveService.listObjectives(query);
    },
    getLearningObjective(params) {
      return learningObjectiveService.getObjective(params.id);
    },
    createLearningObjective(body) {
      return learningObjectiveService.createCandidate(body);
    },
    updateLearningObjective(params, body) {
      return learningObjectiveService.updateObjective(params.id, body);
    },
    confirmLearningObjective(params, body) {
      return learningObjectiveService.confirmObjective(params.id, body);
    },
    requestLearningObjectiveRevision(params, body = {}) {
      return learningObjectiveService.requestRevision(
        params.id,
        body.reviewNote as Input<typeof learningObjectiveService.requestRevision, 1>
      );
    },
    archiveLearningObjective(params) {
      return learningObjectiveService.archive(params.id);
    },
    restoreLearningObjective(params) {
      return learningObjectiveService.restore(params.id);
    },
    listExamProfiles(query = {}) {
      return examProfileService.list(query);
    },
    getExamProfile(params) {
      return examProfileService.get(params.id);
    },
    createExamProfile(body) {
      return examProfileService.create(body);
    },
    updateExamProfile(params, body) {
      return examProfileService.update(params.id, body);
    },
    archiveExamProfile(params) {
      return examProfileService.archive(params.id);
    },
    restoreExamProfile(params) {
      return examProfileService.restore(params.id);
    },
    listExamFocuses(query = {}) {
      return examFocusService.list(query);
    },
    getExamFocus(params) {
      return examFocusService.get(params.id);
    },
    createExamFocus(body) {
      return examFocusService.create(body);
    },
    updateExamFocus(params, body) {
      return examFocusService.update(params.id, body);
    },
    confirmExamFocus(params) {
      return examFocusService.confirm(params.id);
    },
    archiveExamFocus(params) {
      return examFocusService.archive(params.id);
    },
    restoreExamFocus(params) {
      return examFocusService.restore(params.id);
    },
    listQuestions(query = {}) {
      return questionService.listQuestions(query);
    },
    getQuestion(params) {
      return questionService.getQuestion(params.id);
    },
    createQuestion(body) {
      return questionService.createQuestion(body);
    },
    updateQuestion(params, body) {
      return questionService.updateQuestion(params.id, body);
    },
    validateQuestion(params) {
      return questionService.validateQuestion(params.id);
    },
    submitQuestionForReview(params) {
      return questionService.submitForReview(params.id);
    },
    confirmQuestion(params) {
      return questionService.confirmQuestion(params.id);
    },
    archiveQuestion(params) {
      return questionService.archiveQuestion(params.id);
    },
    restoreQuestion(params) {
      return questionService.restoreQuestion(params.id);
    },
    inspectTrainingAssetPurge(params) {
      return trainingAssetLifecycle.inspect(params.type, params.id);
    },
    trashTrainingAsset(params) {
      return trainingAssetLifecycle.trash(params.type, params.id);
    },
    restoreDeletedTrainingAsset(params) {
      return trainingAssetLifecycle.restore(params.type, params.id);
    },
    permanentlyDeleteTrainingAsset(params, body) {
      return trainingAssetLifecycle.purge(
        params.type,
        params.id,
        body.expectedUpdatedAt as Input<typeof trainingAssetLifecycle.purge, 2>,
        body
      );
    },
    getKnowledgeOverview() {
      return knowledgeModule.workspaceQueryService.getKnowledgeOverview();
    },
    getTrainingOverview() {
      return knowledgeModule.workspaceQueryService.getTrainingOverview();
    },
    listWorkspaceKnowledgeItems(query = {}) {
      return knowledgeModule.workspaceQueryService.listKnowledgeItems(query);
    },
    listWorkspaceLearningObjectives(query = {}) {
      return knowledgeModule.workspaceQueryService.listLearningObjectives(query);
    },
    listWorkspaceQuestions(query = {}) {
      return knowledgeModule.workspaceQueryService.listQuestions(query);
    },
    listWorkspaceExamProfiles(query = {}) {
      return knowledgeModule.workspaceQueryService.listExamProfiles(query);
    },
    listReviewQueue(query = {}) {
      return knowledgeModule.workspaceQueryService.listReviewQueue(query);
    },
    createDefaultKnowledgeSpace() {
      return knowledgeSpaceService.createDefaultKnowledgeSpace({
        userId: ownerId
      });
    },
    createKnowledgeSpace(body) {
      return knowledgeSpaceService.createKnowledgeSpace({ ...body, userId: ownerId } as Parameters<
        typeof knowledgeSpaceService.createKnowledgeSpace
      >[0]);
    },
    listKnowledgeSpaces(query = {}) {
      return knowledgeSpaceService.listKnowledgeSpaces({
        ...query,
        userId: ownerId
      } as Input<typeof knowledgeSpaceService.listKnowledgeSpaces>);
    },
    inspectEmptySpaceDeletion(params) {
      return inspectEmptySpaceDeletion(params.id, ownerId);
    },
    deleteEmptySpace(params, body) {
      return deleteEmptySpace(params.id, body, ownerId);
    },
    previewSpaceMigration(params, query) {
      return previewSpaceMigration(params.id, query.targetSpaceId as Input<typeof previewSpaceMigration, 1>, ownerId);
    },
    migrateSpaceAssets(params, body) {
      return migrateSpaceAssets(params.id, body, ownerId);
    },
    searchNotes(query = {}) {
      if (query.result === 'command') return searchService.searchCommandNotes(query, ownerId);
      const notes = searchService.searchNotes(query as Input<typeof searchService.searchNotes>);
      return query.result === 'ids' ? notes.map(note => note.id) : notes;
    }
  } satisfies { [Key in keyof HandlerInputs]: (...args: HandlerInputs[Key]) => void };
}

export type KnowledgeHandlerInputs = {
  [Key in keyof ReturnType<typeof createKnowledgeHttpHandlers>]: Parameters<
    ReturnType<typeof createKnowledgeHttpHandlers>[Key]
  >;
};
