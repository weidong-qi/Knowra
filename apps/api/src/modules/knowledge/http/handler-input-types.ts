import type { createContentAnnotationService } from '../application/content-annotation-service.ts';
import type { createAsyncContentAnnotationService } from '../application/postgres-async/content-annotation-service.ts';
import type { createAnnotationScopeService } from '../application/annotation-scope-service.ts';
import type { createAsyncAnnotationScopeService } from '../application/postgres-async/annotation-scope-service.ts';
type AnnotationServiceShape =
  ReturnType<typeof createContentAnnotationService> | ReturnType<typeof createAsyncContentAnnotationService>;
type ScopeServiceShape =
  ReturnType<typeof createAnnotationScopeService> | ReturnType<typeof createAsyncAnnotationScopeService>;
// 外部 JSON 输入由应用服务按已有规则校验。
export type HttpInput = Record<string, unknown>;
export type Input<Fn extends (...args: never[]) => unknown, Position extends number = 0> = Parameters<Fn>[Position];
// 退役入口仍接受原请求实参，然后沿用服务中的既有拒绝逻辑。
export type AnnotationHttpPort<AnnotationService extends AnnotationServiceShape> = Omit<
  AnnotationService,
  'createAnnotation' | 'restoreAnnotation' | 'updateAnnotationAnchor' | 'confirmAnnotationRange'
> & {
  createAnnotation(body: HttpInput): ReturnType<AnnotationService['createAnnotation']>;
  restoreAnnotation(id: string, body: HttpInput): ReturnType<AnnotationService['restoreAnnotation']>;
  updateAnnotationAnchor(id: string, body: HttpInput): ReturnType<AnnotationService['updateAnnotationAnchor']>;
  confirmAnnotationRange(id: string, body: HttpInput): ReturnType<AnnotationService['confirmAnnotationRange']>;
};
export type ScopeHttpPort<ScopeService extends ScopeServiceShape> = Omit<
  ScopeService,
  'createExclusion' | 'deleteExclusion'
> & {
  createExclusion(id: string, body: HttpInput): ReturnType<ScopeService['createExclusion']>;
  deleteExclusion(id: string, exclusionId: string, body: HttpInput): ReturnType<ScopeService['deleteExclusion']>;
};

export type KnowledgeServiceKeys =
  | 'noteService'
  | 'folderService'
  | 'tagService'
  | 'tagGroupService'
  | 'knowledgeSpaceService'
  | 'searchService'
  | 'noteVersionService'
  | 'knowledgeItemService'
  | 'getKnowledgeProvenance'
  | 'inspectKnowledgePurge'
  | 'permanentlyDeleteKnowledgeItem'
  | 'previewNoteVersionPrune'
  | 'inspectEmptySpaceDeletion'
  | 'deleteEmptySpace'
  | 'previewSpaceMigration'
  | 'migrateSpaceAssets'
  | 'learningObjectiveService'
  | 'examProfileService'
  | 'examFocusService'
  | 'questionService'
  | 'trainingAssetLifecycle'
  | 'deleteFolderAndCleanup'
  | 'restoreDeletedFolder'
  | 'deleteTagAndCleanup'
  | 'mergeTags'
  | 'workspaceQueryService';
