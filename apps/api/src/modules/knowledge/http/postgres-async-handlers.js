import { assertCommandSearchOwner } from '../application/command-note-search.js';

export function createPostgresKnowledgeHttpHandlers({ knowledgeModule, noteDeletionCoordinator, ownerId = 'demo' }) {
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
    deleteFolderAndCleanup,
    restoreDeletedFolder,
    deleteTagAndCleanup,
    mergeTags
  } = knowledgeModule;

  return {
    createNote: body => noteService.createNote(body),
    importMarkdown: body => noteService.importMarkdown(body),
    importMarkdownBatch: body => noteService.importMarkdownBatch(body.items ?? []),
    getNote: (params, query = {}) => noteService.getNote(params.id, { includeDeleted: query.includeDeleted }),
    getLinkedNotes: params => noteService.getLinkedNotes(params.id),
    async getNoteLinkRelations(params) {
      const note = await noteService.getNote(params.id);
      assertCommandSearchOwner(
        await knowledgeModule.repositories.knowledgeSpaceRepository.findById(note.spaceId),
        ownerId
      );
      return noteService.getNoteLinkRelations(params.id);
    },
    listNotes: (query = {}) => noteService.listNotes(query),
    updateNote: (params, body) => noteService.updateNote(params.id, body),
    deleteNote: params => noteService.deleteNote(params.id),
    deleteNotes: (body = {}) => noteService.deleteNotes(body.noteIds ?? []),
    restoreNote: params => noteService.restoreNote(params.id),
    permanentlyDeleteNote: params => (noteDeletionCoordinator ?? noteService).permanentlyDeleteNote(params.id),
    emptyRecycleBin: (query = {}) => (noteDeletionCoordinator ?? noteService).emptyRecycleBin(query.spaceId ?? null),
    setFavorite: (params, body = {}) => noteService.setFavorite(params.id, body.favorite ?? true),
    removeTagFromNote: params => noteService.removeTagFromNote(params.id, params.tagId),
    assignTagToNote: (params, body = {}) => noteService.assignTagToNote(params.id, body.tagId),
    assignTagToNotes: (body = {}) => noteService.assignTagToNotes(body.noteIds ?? [], body.tagId),
    updateTagsForNotes: (body = {}) =>
      noteService.updateTagsForNotes(body.noteIds ?? [], body.addTagIds ?? [], body.removeTagIds ?? []),
    setNoteTags: (params, body) => noteService.setNoteTags(params.id, body.tagIds ?? []),
    createFolder: body => folderService.createFolder(body),
    updateFolder: (params, body) => folderService.updateFolder(params.id, body),
    deleteFolder: (params, body) => deleteFolderAndCleanup(params.id, body),
    restoreFolder: params => restoreDeletedFolder(params.id),
    listFolders: (query = {}) => folderService.listFolders(query),
    listFolderTree: (query = {}) => folderService.listFolderTree(query),
    createTag: body => tagService.createTag(body),
    updateTag: (params, body) => tagService.updateTag(params.id, body),
    deleteTag: params => deleteTagAndCleanup(params.id),
    listTags: (query = {}) => tagService.listTags(query),
    reorderTags: (body = {}) => tagService.reorderTags(body.tagIds ?? []),
    mergeTags: (body = {}) => mergeTags(body.sourceTagId, body.targetTagId),
    createTagGroup: body => tagGroupService.createTagGroup(body),
    updateTagGroup: (params, body) => tagGroupService.updateTagGroup(params.id, body),
    deleteTagGroup: params => tagGroupService.deleteTagGroup(params.id),
    listTagGroups: (query = {}) => tagGroupService.listTagGroups(query),
    createAnnotation: body => contentAnnotationService.createAnnotation(body),
    listAnnotations: (query = {}) => contentAnnotationService.listAnnotationsByNote(query),
    getAnnotation: params => contentAnnotationService.getAnnotation(params.id),
    updateAnnotation: (params, body) => contentAnnotationService.updateAnnotation(params.id, body),
    deleteAnnotation: (params, body) => contentAnnotationService.deleteAnnotation(params.id, body),
    restoreAnnotation: (params, body) => contentAnnotationService.restoreAnnotation(params.id, body),
    updateAnnotationAnchor: (params, body) => contentAnnotationService.updateAnnotationAnchor(params.id, body),
    confirmAnnotationRange: (params, body) => contentAnnotationService.confirmAnnotationRange(params.id, body),
    previewAnnotation: params => annotationScopeService.previewAnnotation(params.id),
    createAnnotationExclusion: (params, body) => annotationScopeService.createExclusion(params.id, body),
    deleteAnnotationExclusion: (params, body) =>
      annotationScopeService.deleteExclusion(params.id, params.exclusionId, body),
    getAnnotationKnowledgeLinks: params => annotationScopeService.getKnowledgeLinks(params.id),
    previewAnalysisScope: body => annotationScopeService.previewAnalysisScope(body),
    createAnalysisScope: body => annotationScopeService.createAnalysisScope(body),
    getAnalysisScope: (params, query) => annotationScopeService.getAnalysisScope(params.id, query.spaceId),
    listAnalysisScopes: query => annotationScopeService.listAnalysisScopes(query),
    trashAnalysisScope: (params, body) => annotationScopeService.trashAnalysisScope(params.id, body),
    restoreDeletedAnalysisScope: (params, body) => annotationScopeService.restoreAnalysisScope(params.id, body),
    listNoteVersions: async (params, query = {}) => {
      const note = await noteService.getNote(params.id);
      return query.limit !== undefined || query.cursor !== undefined
        ? noteVersionService.listVersionPage(note, query)
        : noteVersionService.listVersions({ ...query, noteId: params.id });
    },
    getNoteVersion: async params => {
      await noteService.getNote(params.id);
      return noteVersionService.getVersion(params.versionId, params.id);
    },
    previewNoteVersionPrune: params => previewNoteVersionPrune(params.id),
    listKnowledgeItems: (query = {}) => knowledgeItemService.listItems(query),
    getKnowledgeItem: params => knowledgeItemService.getItem(params.id),
    createKnowledgeItem: body => knowledgeItemService.createCandidate(body),
    updateKnowledgeItem: (params, body) => knowledgeItemService.updateItem(params.id, body),
    confirmKnowledgeItem: (params, body) => knowledgeItemService.confirmItem(params.id, body),
    markKnowledgeItemNeedsRevision: (params, body) => knowledgeItemService.markNeedsRevision(params.id, body),
    archiveKnowledgeItem: (params, body) => knowledgeItemService.archive(params.id, body),
    restoreKnowledgeItem: (params, body) => knowledgeItemService.restore(params.id, body),
    trashKnowledgeItem: (params, body) => knowledgeItemService.trash(params.id, body),
    restoreDeletedKnowledgeItem: (params, body) => knowledgeItemService.restoreDeleted(params.id, body),
    inspectKnowledgePurge: params => inspectKnowledgePurge(params.id),
    permanentlyDeleteKnowledgeItem: (params, body) => permanentlyDeleteKnowledgeItem(params.id, body),
    getKnowledgeProvenance: params => getKnowledgeProvenance(params.id, ownerId),
    listKnowledgeEvidence: params => knowledgeItemService.listEvidence(params.id),
    createKnowledgeEvidence: (params, body) =>
      knowledgeItemService.createEvidence({ ...body, knowledgeItemId: params.id }),
    retireKnowledgeEvidence: (params, body) => knowledgeItemService.retireEvidence(params.id, params.evidenceId, body),
    readoptKnowledgeEvidence: (params, body) =>
      knowledgeItemService.readoptEvidence(params.id, params.evidenceId, body),
    listLearningObjectives: (query = {}) => learningObjectiveService.listObjectives(query),
    getLearningObjective: params => learningObjectiveService.getObjective(params.id),
    createLearningObjective: body => learningObjectiveService.createCandidate(body),
    updateLearningObjective: (params, body) => learningObjectiveService.updateObjective(params.id, body),
    confirmLearningObjective: (params, body) => learningObjectiveService.confirmObjective(params.id, body),
    requestLearningObjectiveRevision: (params, body = {}) =>
      learningObjectiveService.requestRevision(params.id, body.reviewNote),
    archiveLearningObjective: params => learningObjectiveService.archive(params.id),
    restoreLearningObjective: params => learningObjectiveService.restore(params.id),
    listExamProfiles: (query = {}) => examProfileService.list(query),
    getExamProfile: params => examProfileService.get(params.id),
    createExamProfile: body => examProfileService.create(body),
    updateExamProfile: (params, body) => examProfileService.update(params.id, body),
    archiveExamProfile: params => examProfileService.archive(params.id),
    restoreExamProfile: params => examProfileService.restore(params.id),
    listExamFocuses: (query = {}) => examFocusService.list(query),
    getExamFocus: params => examFocusService.get(params.id),
    createExamFocus: body => examFocusService.create(body),
    updateExamFocus: (params, body) => examFocusService.update(params.id, body),
    confirmExamFocus: params => examFocusService.confirm(params.id),
    archiveExamFocus: params => examFocusService.archive(params.id),
    restoreExamFocus: params => examFocusService.restore(params.id),
    listQuestions: (query = {}) => questionService.listQuestions(query),
    getQuestion: params => questionService.getQuestion(params.id),
    createQuestion: body => questionService.createQuestion(body),
    updateQuestion: (params, body) => questionService.updateQuestion(params.id, body),
    validateQuestion: params => questionService.validateQuestion(params.id),
    submitQuestionForReview: params => questionService.submitForReview(params.id),
    confirmQuestion: params => questionService.confirmQuestion(params.id),
    archiveQuestion: params => questionService.archiveQuestion(params.id),
    restoreQuestion: params => questionService.restoreQuestion(params.id),
    inspectTrainingAssetPurge: params => knowledgeModule.trainingAssetLifecycle.inspect(params.type, params.id),
    trashTrainingAsset: params => knowledgeModule.trainingAssetLifecycle.trash(params.type, params.id),
    restoreDeletedTrainingAsset: params => knowledgeModule.trainingAssetLifecycle.restore(params.type, params.id),
    permanentlyDeleteTrainingAsset: (params, body) =>
      knowledgeModule.trainingAssetLifecycle.purge(params.type, params.id, body.expectedUpdatedAt, body),
    getKnowledgeOverview: () => knowledgeModule.workspaceQueryService.getKnowledgeOverview(),
    getTrainingOverview: () => knowledgeModule.workspaceQueryService.getTrainingOverview(),
    listWorkspaceKnowledgeItems: (query = {}) => knowledgeModule.workspaceQueryService.listKnowledgeItems(query),
    listWorkspaceLearningObjectives: (query = {}) =>
      knowledgeModule.workspaceQueryService.listLearningObjectives(query),
    listWorkspaceQuestions: (query = {}) => knowledgeModule.workspaceQueryService.listQuestions(query),
    listWorkspaceExamProfiles: (query = {}) => knowledgeModule.workspaceQueryService.listExamProfiles(query),
    listReviewQueue: (query = {}) => knowledgeModule.workspaceQueryService.listReviewQueue(query),
    createDefaultKnowledgeSpace: () => knowledgeSpaceService.createDefaultKnowledgeSpace({ userId: ownerId }),
    createKnowledgeSpace: body => knowledgeSpaceService.createKnowledgeSpace({ ...body, userId: ownerId }),
    listKnowledgeSpaces: (query = {}) => knowledgeSpaceService.listKnowledgeSpaces({ ...query, userId: ownerId }),
    inspectEmptySpaceDeletion: params => inspectEmptySpaceDeletion(params.id, ownerId),
    deleteEmptySpace: (params, body) => deleteEmptySpace(params.id, body, ownerId),
    previewSpaceMigration: (params, query) => previewSpaceMigration(params.id, query.targetSpaceId, ownerId),
    migrateSpaceAssets: (params, body) => migrateSpaceAssets(params.id, body, ownerId),
    async searchNotes(query = {}) {
      if (query.result === 'command') return searchService.searchCommandNotes(query, ownerId);
      const notes = await searchService.searchNotes(query);
      return query.result === 'ids' ? notes.map(note => note.id) : notes;
    }
  };
}
