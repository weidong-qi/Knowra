import { assertCommandSearchOwner } from '../application/command-note-search.ts';

export function createKnowledgeHttpHandlers({ knowledgeModule, noteDeletionCoordinator, ownerId = 'demo' }) {
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

  return {
    createNote(body) {
      return noteService.createNote(body);
    },
    importMarkdown(body) {
      return noteService.importMarkdown(body);
    },
    importMarkdownBatch(body) {
      return noteService.importMarkdownBatch(body.items ?? []);
    },
    getNote(params, query = {}) {
      return noteService.getNote(params.id, {
        includeDeleted: query.includeDeleted
      });
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
      return noteService.deleteNotes(body.noteIds ?? []);
    },
    restoreNote(params) {
      return noteService.restoreNote(params.id);
    },
    permanentlyDeleteNote(params) {
      return (noteDeletionCoordinator ?? noteService).permanentlyDeleteNote(params.id);
    },
    emptyRecycleBin(query = {}) {
      return (noteDeletionCoordinator ?? noteService).emptyRecycleBin(query.spaceId ?? null);
    },
    setFavorite(params, body = {}) {
      return noteService.setFavorite(params.id, body.favorite ?? true);
    },
    removeTagFromNote(params) {
      return noteService.removeTagFromNote(params.id, params.tagId);
    },
    assignTagToNote(params, body = {}) {
      return noteService.assignTagToNote(params.id, body.tagId);
    },
    assignTagToNotes(body = {}) {
      return noteService.assignTagToNotes(body.noteIds ?? [], body.tagId);
    },
    setNoteTags(params, body) {
      return noteService.setNoteTags(params.id, body.tagIds ?? []);
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
      return tagService.reorderTags(body.tagIds ?? []);
    },
    mergeTags(body = {}) {
      return mergeTags(body.sourceTagId, body.targetTagId);
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
      return noteService.updateTagsForNotes(body.noteIds ?? [], body.addTagIds ?? [], body.removeTagIds ?? []);
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
      return annotationScopeService.getAnalysisScope(params.id, query.spaceId);
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
        : noteVersionService.listVersions({ ...query, noteId: params.id });
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
      return knowledgeItemService.createEvidence({ ...body, knowledgeItemId: params.id });
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
      return learningObjectiveService.requestRevision(params.id, body.reviewNote);
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
      return trainingAssetLifecycle.purge(params.type, params.id, body.expectedUpdatedAt, body);
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
      return knowledgeSpaceService.createKnowledgeSpace({ ...body, userId: ownerId });
    },
    listKnowledgeSpaces(query = {}) {
      return knowledgeSpaceService.listKnowledgeSpaces({
        ...query,
        userId: ownerId
      });
    },
    inspectEmptySpaceDeletion(params) {
      return inspectEmptySpaceDeletion(params.id, ownerId);
    },
    deleteEmptySpace(params, body) {
      return deleteEmptySpace(params.id, body, ownerId);
    },
    previewSpaceMigration(params, query) {
      return previewSpaceMigration(params.id, query.targetSpaceId, ownerId);
    },
    migrateSpaceAssets(params, body) {
      return migrateSpaceAssets(params.id, body, ownerId);
    },
    searchNotes(query = {}) {
      if (query.result === 'command') return searchService.searchCommandNotes(query, ownerId);
      const notes = searchService.searchNotes(query);
      return query.result === 'ids' ? notes.map(note => note.id) : notes;
    }
  };
}
