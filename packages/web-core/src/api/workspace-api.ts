import { createAttachmentApi, type AttachmentApi } from './attachment-api.js';
export type { UploadAttachmentInput } from './attachment-api.js';
import type {
  CreateKnowledgeCandidateInput,
  CreateKnowledgeEvidenceInput,
  KnowledgeCandidateResult,
  KnowledgeEvidence,
  KnowledgeEvidenceMutationResult,
  KnowledgeItem,
  KnowledgeItemQuery,
  KnowledgeMutationInput,
  KnowledgeProvenance,
  RetireKnowledgeEvidenceInput,
  UpdateKnowledgeItemInput
} from '../workspace/knowledge-types.js';
import { asArray, asItems, getData } from './response.js';
import type { RequestJson } from './client.js';
import { createKnowledgeExtractionApi, type KnowledgeExtractionApi } from './knowledge-extraction-api.js';
import { requestCommandNoteSearch, type CommandNoteSearcher } from './command-note-search.js';
import type {
  Annotation,
  ContentAnchor,
  Folder,
  KnowledgeSpace,
  Note,
  NoteVersion,
  NoteVersionPage,
  NoteVersionPageOptions,
  Tag,
  TagColor,
  TagGroup
} from '../workspace/types.js';

export interface WorkspaceResources {
  folderTree: Folder[];
  notes: Note[];
  tags: Tag[];
  tagGroups?: TagGroup[];
}

export interface NoteLinkOccurrence {
  targetNoteId: string;
  occurrenceId: string;
  url: string;
  sourceStart: number;
  sourceEnd: number;
  label: string;
  context: string;
}
export interface NoteLinkGroup {
  id: string;
  title: string;
  folderId: string | null;
  occurrences: NoteLinkOccurrence[];
}
export interface NoteLinkRelations {
  noteId: string;
  spaceId: string;
  contentHash: string;
  outgoing: Array<NoteLinkGroup & { status: 'active' | 'deleted' }>;
  backlinks: NoteLinkGroup[];
}

export interface CreateNoteInput {
  aiVisibility?: import('../workspace/types').NoteAiVisibility;
  id?: string;
  title?: string;
  rawMarkdown: string;
  spaceId?: string | null;
  folderId?: string | null;
  status?: string;
  sourceType?: string;
  favorite?: boolean;
  tagIds?: string[];
  createdAt?: string;
  updatedAt?: string;
}

export interface CreateFolderInput {
  id?: string;
  spaceId: string;
  parentId?: string | null;
  name: string;
  pathCache?: string;
}

export interface UpdateNoteInput {
  aiVisibility?: import('../workspace/types').NoteAiVisibility;
  annotationMapping?: import('../workspace/types').AnnotationMapping;
  title?: string;
  folderId?: string | null;
  status?: string;
  rawMarkdown?: string;
  expectedUpdatedAt?: string;
}

export interface NoteQueryInput {
  contentKind?: 'markdown' | 'pdf';
  query?: string;
  spaceId?: string;
  folderId?: string | null;
  tagId?: string | null;
  tagIds?: string[];
  tagMatch?: 'all' | 'any';
  favoriteOnly?: boolean;
  deletedOnly?: boolean;
  includeDeleted?: boolean;
  sortBy?: 'title' | 'createdAt' | 'updatedAt';
  order?: 'asc' | 'desc';
  offset?: number;
  limit?: number;
}

export interface NoteQueryPage {
  items: Note[];
  hasNext: boolean;
}

export interface UpdateAnnotationInput {
  expectedRevision: number;
  kind?: 'important' | 'question' | 'supplement' | 'pitfall' | 'temporary';
  importance?: Annotation['importance'];
  comment?: string;
}

export interface AnnotationPreview {
  pendingRange?: { anchor: ContentAnchor; reason: string; candidateHash: string } | null;
  annotation: Annotation;
  currentContentHash: string;
  resolution: {
    status: 'resolved' | 'needsReview' | 'missing';
    reason: string | null;
    quoteText?: string;
    sourceStart?: number;
    sourceEnd?: number;
  };
  exclusions: Array<{ id: string; status: string; anchor: ContentAnchor }>;
}

export interface AnnotationKnowledgeLinks {
  annotationId: string;
  candidates: Array<{ evidence: { id: string; status: string }; knowledgeItem: { id: string; title: string } }>;
  confirmed: Array<{ evidence: { id: string; status: string }; knowledgeItem: { id: string; title: string } }>;
  evidenceStatus: Array<{ id: string; status: string }>;
}

export interface AnnotationExclusionResult {
  annotation: Annotation;
  exclusion: { id: string; parentAnnotationId: string; status: string; revision: number; anchor: ContentAnchor };
}

export interface AnalysisScopePreview {
  spaceId: string;
  mode: 'marked' | 'all';
  previewHash: string;
  summary: { noteCount: number; segmentCount: number; annotationCount: number };
  segments: Array<{
    noteId: string;
    noteVersionId: string;
    start: number;
    end: number;
    markdown: string;
    annotationIds: string[];
  }>;
  exclusions?: Array<{ noteId: string; start: number; end: number; exclusionId?: string }>;
  noteVersions?: Array<{ noteId: string; noteVersionId: string; contentHash: string; title: string }>;
  omittedItems: Array<Record<string, unknown>>;
  ai: { available: boolean; message: string };
}

export interface AnalysisScopeInput {
  spaceId: string;
  mode: 'marked' | 'all';
  noteIds?: string[];
  annotationIds?: string[];
  selections?: Array<{ noteId: string; anchor: ContentAnchor }>;
}

export interface AnalysisScopeSnapshot {
  id: string;
  spaceId: string;
  summary: { noteCount: number; segmentCount: number; annotationCount: number };
  noteVersions: Array<{ noteId: string; noteVersionId: string; title?: string }>;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface UpdateFolderInput {
  name?: string;
  parentId?: string | null;
}

export interface EmptyRecycleBinResult {
  deletedCount?: number;
  deleted?: number;
  noteIds?: string[];
}

export interface PurgeConfirmationInput {
  expectedUpdatedAt: string;
  expectedDatasetEpoch?: string;
  confirmationToken?: string;
}
export interface AuthoritativePurgeResult {
  status: 'subject-purged' | 'already-purged';
  asset: { type: 'knowledgeItem' | TrainingAssetKind; id: string };
  localState?: 'synchronized' | 'recovery-required';
  message?: string;
}
export interface AuthoritativePurgeStatus {
  pending: { type: 'knowledgeItem' | TrainingAssetKind; id: string } | null;
  result: AuthoritativePurgeResult | null;
}
export interface KnowledgePurgePreview extends PurgeConfirmationInput {
  asset: { type: 'knowledgeItem'; id: string };
  decision: 'move-to-recycle-bin-first' | 'requires-dependency-action' | 'can-purge-no-history';
  expectedUpdatedAt: string;
  exclusiveRecords: { knowledgeEvidenceIds: string[]; knowledgeArtifactProvenanceIds: string[] };
  references: Array<{ collection: string; id: string; reasonCode: string; action: string }>;
  coverage: { persistedCurrentAndHistory: boolean; runningTasks: string; offlineDevices: string; backups: string };
}

export interface KnowledgePurgeResult extends AuthoritativePurgeResult {
  status: 'subject-purged' | 'already-purged';
  asset: { type: 'knowledgeItem'; id: string };
  exclusiveRecordsDeleted: { knowledgeEvidence: number; knowledgeArtifactProvenance: number };
  offlineDevices: string;
  backups: string;
}

export interface NoteVersionPrunePreview {
  noteId: string;
  mode: 'preview-only';
  retentionPointMetadataAvailable: boolean;
  versions: Array<{
    id: string;
    createdAt: string;
    createdBy: string;
    references: Array<{ type: string; id: string }>;
    candidateAfterRetentionReview: boolean;
    canPruneNow: boolean;
    reason: string;
  }>;
}

export interface SpaceDeletionPreview {
  asset: { type: 'knowledgeSpace'; id: string };
  decision: 'system-shell-protected' | 'requires-content-action' | 'can-delete-empty-container';
  expectedUpdatedAt: string;
  references: Array<{ collection: string; id: string; retention?: string }>;
  systemGroupIds: string[];
}

export interface SpaceMigrationPreview {
  sourceSpaceId: string;
  targetSpaceId: string;
  previewHash: string;
  decision: 'blocked' | 'can-migrate';
  blockers: string[];
  counts: Record<string, number>;
  coverage: {
    spaceScopedAssets: string[];
    globalKnowledgeAndTraining: string;
    offlineDevices: string;
    backups: string;
  };
}

export type TrainingAssetKind = 'learningObjective' | 'examProfile' | 'examFocus' | 'question';
export interface LearningObjectiveReviewBaseline {
  knowledgeUpdatedAt: string;
  objectiveUpdatedAt?: string;
}
export interface TrainingMutationInput {
  reviewBaseline?: LearningObjectiveReviewBaseline;
}
export interface TrainingAssetRecord {
  id: string;
  updatedAt: string;
  deletedAt?: string | null;
  archivedAt?: string | null;
  reviewStatus?: string;
  name?: string;
  objective?: string;
  actionVerb?: string;
  cognitiveLevel?: string;
  stem?: string;
  description?: string;
  knowledgeItemId?: string;
  examProfileId?: string;
  learningObjectiveId?: string;
  learningObjectiveIds?: string[];
  [key: string]: unknown;
}
export interface TrainingPurgePreview extends PurgeConfirmationInput {
  asset: { type: TrainingAssetKind; id: string };
  decision: 'move-to-recycle-bin-first' | 'requires-dependency-action' | 'can-purge-no-history';
  expectedUpdatedAt: string;
  references: Array<{
    collection: string;
    id: string;
    action: string;
    relatedAsset?: { kind: TrainingAssetKind; id: string };
  }>;
  exclusiveRecords: Record<string, string[]>;
  coverage: Record<string, unknown>;
}

export interface WorkspaceApi extends AttachmentApi {
  knowledgeExtraction?: KnowledgeExtractionApi;
  listTrainingAssets?(
    kind: TrainingAssetKind,
    query?: { includeArchived?: boolean; includeDeleted?: boolean }
  ): Promise<TrainingAssetRecord[]>;
  createTrainingAsset?(kind: TrainingAssetKind, input: Record<string, unknown>): Promise<TrainingAssetRecord>;
  updateTrainingAsset?(
    kind: TrainingAssetKind,
    id: string,
    input: Record<string, unknown>
  ): Promise<TrainingAssetRecord>;
  mutateTrainingAsset?(
    kind: TrainingAssetKind,
    id: string,
    action: 'validate' | 'confirm' | 'archive' | 'restore' | 'trash' | 'restore-deleted',
    input?: TrainingMutationInput
  ): Promise<TrainingAssetRecord>;
  inspectTrainingAssetPurge?(kind: TrainingAssetKind, id: string): Promise<TrainingPurgePreview>;
  purgeTrainingAsset?(
    kind: TrainingAssetKind,
    id: string,
    confirmation: string | PurgeConfirmationInput
  ): Promise<AuthoritativePurgeResult>;
  getAuthoritativePurgeStatus?(): Promise<AuthoritativePurgeStatus>;
  listKnowledgeItems?(query?: KnowledgeItemQuery): Promise<KnowledgeItem[]>;
  getKnowledgeItem?(id: string): Promise<KnowledgeItem>;
  createKnowledgeCandidate?(input: CreateKnowledgeCandidateInput): Promise<KnowledgeCandidateResult>;
  updateKnowledgeItem?(id: string, input: UpdateKnowledgeItemInput): Promise<KnowledgeItem>;
  confirmKnowledgeItem?(id: string, input?: KnowledgeMutationInput): Promise<KnowledgeItem>;
  archiveKnowledgeItem?(id: string, input?: KnowledgeMutationInput): Promise<KnowledgeItem>;
  restoreKnowledgeItem?(id: string, input?: KnowledgeMutationInput): Promise<KnowledgeItem>;
  trashKnowledgeItem?(id: string, input?: KnowledgeMutationInput): Promise<KnowledgeItem>;
  restoreDeletedKnowledgeItem?(id: string, input?: KnowledgeMutationInput): Promise<KnowledgeItem>;
  inspectKnowledgePurge?(id: string): Promise<KnowledgePurgePreview>;
  permanentlyDeleteKnowledgeItem?(id: string, input: PurgeConfirmationInput): Promise<KnowledgePurgeResult>;
  listKnowledgeEvidence?(id: string): Promise<KnowledgeEvidence[]>;
  getKnowledgeProvenance?(id: string): Promise<KnowledgeProvenance>;
  createKnowledgeEvidence?(id: string, input: CreateKnowledgeEvidenceInput): Promise<KnowledgeEvidence>;
  retireKnowledgeEvidence?(
    id: string,
    evidenceId: string,
    input?: RetireKnowledgeEvidenceInput
  ): Promise<KnowledgeEvidenceMutationResult>;
  readoptKnowledgeEvidence?(
    id: string,
    evidenceId: string,
    input?: RetireKnowledgeEvidenceInput
  ): Promise<KnowledgeEvidenceMutationResult>;
  loadWorkspaceResources(spaceId: string): Promise<WorkspaceResources>;
  searchNoteIds(input: { query?: string; spaceId?: string }): Promise<string[]>;
  searchCommandNotes?: CommandNoteSearcher;
  listKnowledgeSpaces(): Promise<KnowledgeSpace[]>;
  createDefaultKnowledgeSpace(): Promise<KnowledgeSpace>;
  createKnowledgeSpace?(input: { name: string }): Promise<KnowledgeSpace>;
  inspectEmptySpaceDeletion?(id: string): Promise<SpaceDeletionPreview>;
  deleteEmptySpace?(id: string, input: { expectedUpdatedAt: string }): Promise<{ status: string }>;
  previewSpaceMigration?(sourceId: string, targetId: string): Promise<SpaceMigrationPreview>;
  migrateSpaceAssets?(
    sourceId: string,
    input: { targetSpaceId: string; expectedPreviewHash: string }
  ): Promise<{ status: string; counts: Record<string, number> }>;
  createNote(input: CreateNoteInput): Promise<Note>;
  importMarkdownNotes(items: CreateNoteInput[]): Promise<Note[]>;
  getNote(noteId: string): Promise<Note>;
  createFolder(input: CreateFolderInput): Promise<Folder>;
  updateNote(noteId: string, input: UpdateNoteInput): Promise<Note>;
  deleteNote(noteId: string): Promise<Note>;
  restoreNote(noteId: string): Promise<Note>;
  permanentlyDeleteNote(noteId: string): Promise<Note>;
  setNoteFavorite(noteId: string, favorite: boolean): Promise<Note>;
  setNoteTags(noteId: string, tagIds: string[]): Promise<Note>;
  createTag(input: { spaceId: string; name: string; color: TagColor; groupId: string }): Promise<Tag>;
  updateTag(
    tagId: string,
    input: { name?: string; color?: TagColor; groupId?: string; sortOrder?: number }
  ): Promise<Tag>;
  deleteTag(tagId: string): Promise<Tag>;
  mergeTags(sourceTagId: string, targetTagId: string): Promise<Tag>;
  reorderTags(tagIds: string[]): Promise<Tag[]>;
  createTagGroup(input: { spaceId: string; name: string; selectionMode: 'single' | 'multiple' }): Promise<TagGroup>;
  updateTagGroup(
    groupId: string,
    input: { name?: string; selectionMode?: 'single' | 'multiple'; sortOrder?: number }
  ): Promise<TagGroup>;
  deleteTagGroup(groupId: string): Promise<TagGroup>;
  deleteNotes(noteIds: string[]): Promise<Note[]>;
  assignTagToNotes(noteIds: string[], tagId: string): Promise<Note[]>;
  updateTagsForNotes(noteIds: string[], addTagIds: string[], removeTagIds: string[]): Promise<Note[]>;
  queryNotes(input: NoteQueryInput): Promise<NoteQueryPage>;
  getLinkedNotes(noteId: string): Promise<Note[]>;
  getNoteLinkRelations?(noteId: string): Promise<NoteLinkRelations>;
  listAnnotations(noteId: string, spaceId: string): Promise<Annotation[]>;
  deleteAnnotation(annotationId: string, expectedRevision?: number): Promise<Annotation>;
  restoreAnnotation(annotationId: string, expectedRevision?: number): Promise<Annotation>;
  updateAnnotation?(annotationId: string, input: UpdateAnnotationInput): Promise<Annotation>;
  confirmAnnotationRange?(
    annotationId: string,
    input: import('../workspace/types').ConfirmAnnotationRangeInput
  ): Promise<Annotation>;
  previewAnnotation?(annotationId: string): Promise<AnnotationPreview>;
  getAnnotationKnowledgeLinks?(annotationId: string): Promise<AnnotationKnowledgeLinks>;
  previewAnalysisScope?(input: AnalysisScopeInput): Promise<AnalysisScopePreview>;
  createAnalysisScope?(
    input: AnalysisScopeInput & { previewHash: string; idempotencyKey: string }
  ): Promise<{ id: string }>;
  listAnalysisScopes?(spaceId: string): Promise<AnalysisScopeSnapshot[]>;
  trashAnalysisScope?(
    id: string,
    input: { spaceId: string; expectedUpdatedAt: string }
  ): Promise<AnalysisScopeSnapshot>;
  restoreAnalysisScope?(
    id: string,
    input: { spaceId: string; expectedUpdatedAt: string }
  ): Promise<AnalysisScopeSnapshot>;
  deleteAnnotationExclusion?(
    annotationId: string,
    exclusionId: string,
    expectedRevision: number
  ): Promise<AnnotationExclusionResult>;
  listNoteVersions(noteId: string): Promise<NoteVersion[]>;
  listNoteVersionPage?(noteId: string, options?: NoteVersionPageOptions): Promise<NoteVersionPage>;
  previewNoteVersionPrune?(noteId: string): Promise<NoteVersionPrunePreview>;
  getNoteVersion(noteId: string, versionId: string): Promise<NoteVersion>;
  updateFolder(folderId: string, input: UpdateFolderInput): Promise<Folder>;
  deleteFolder(
    folderId: string,
    input: { mode: 'keep' | 'with-content'; destinationId?: string | null }
  ): Promise<{ folders: Folder[]; deletionPackage: Folder['deletionPackage'] }>;
  restoreFolder?(folderId: string): Promise<{ folders: Folder[] }>;
  listDeletedFolders?(spaceId: string): Promise<Folder[]>;
  emptyRecycleBin(spaceId: string): Promise<EmptyRecycleBinResult>;
}

export function createWorkspaceApi({ requestJson }: { requestJson: RequestJson }): WorkspaceApi {
  function trainingAssetRoot(kind: TrainingAssetKind): string {
    return `/api/knowledge/${({ learningObjective: 'learning-objectives', examProfile: 'exam-profiles', examFocus: 'exam-focuses', question: 'questions' } as const)[kind]}`;
  }
  function requireEntity<T extends { id?: string }>(value: T | undefined, message: string): T {
    if (!value?.id) throw new Error(message);
    return value;
  }

  async function mutateKnowledgeItem(id: string, action: string, input: KnowledgeMutationInput = {}) {
    return requireEntity(
      getData<KnowledgeItem>(
        await requestJson(`/api/knowledge/items/${encodeURIComponent(id)}/${action}`, {
          method: 'POST',
          body: JSON.stringify(input)
        })
      ),
      '知识操作返回无效。'
    );
  }

  return {
    knowledgeExtraction: createKnowledgeExtractionApi(requestJson),
    async listTrainingAssets(kind, query = {}) {
      const root = trainingAssetRoot(kind);
      const params = [
        query.includeArchived ? 'includeArchived=true' : '',
        query.includeDeleted ? 'includeDeleted=true' : ''
      ]
        .filter(Boolean)
        .join('&');
      return asArray<TrainingAssetRecord>(getData(await requestJson(`${root}${params ? `?${params}` : ''}`)));
    },
    async createTrainingAsset(kind, input) {
      return requireEntity(
        getData<TrainingAssetRecord>(
          await requestJson(trainingAssetRoot(kind), { method: 'POST', body: JSON.stringify(input) })
        ),
        '训练资产创建返回无效。'
      );
    },
    async updateTrainingAsset(kind, id, input) {
      return requireEntity(
        getData<TrainingAssetRecord>(
          await requestJson(`${trainingAssetRoot(kind)}/${encodeURIComponent(id)}`, {
            method: 'PATCH',
            body: JSON.stringify(input)
          })
        ),
        '训练资产更新返回无效。'
      );
    },
    async mutateTrainingAsset(kind, id, action, input) {
      return requireEntity(
        getData<TrainingAssetRecord>(
          await requestJson(`${trainingAssetRoot(kind)}/${encodeURIComponent(id)}/${action}`, {
            method: 'POST',
            ...(input ? { body: JSON.stringify(input) } : {})
          })
        ),
        '训练资产操作返回无效。'
      );
    },
    async inspectTrainingAssetPurge(kind, id) {
      const result = getData<TrainingPurgePreview>(
        await requestJson(`${trainingAssetRoot(kind)}/${encodeURIComponent(id)}/purge-preview`)
      );
      if (!result?.asset?.id) throw new Error('训练资产清理预检返回无效。');
      return result;
    },
    async purgeTrainingAsset(kind, id, confirmation) {
      const input = typeof confirmation === 'string' ? { expectedUpdatedAt: confirmation } : confirmation;
      const result = getData<AuthoritativePurgeResult>(
        await requestJson(`${trainingAssetRoot(kind)}/${encodeURIComponent(id)}/purge`, {
          method: 'POST',
          body: JSON.stringify(input)
        })
      );
      if (!result?.asset?.id) throw new Error('训练资产清理结果无效。');
      return result;
    },
    async getAuthoritativePurgeStatus() {
      const result = getData<{ authoritativePurge: AuthoritativePurgeStatus }>(
        await requestJson('/api/local-runtime/sync')
      );
      if (!result?.authoritativePurge) throw new Error('当前本地服务尚不支持清理结果核对，请升级后重试。');
      return result.authoritativePurge;
    },
    async listKnowledgeItems(query = {}) {
      const params = Object.entries(query)
        .filter(([, value]) => value !== undefined)
        .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
        .join('&');
      return asArray<KnowledgeItem>(getData(await requestJson(`/api/knowledge/items${params ? `?${params}` : ''}`)));
    },
    async getKnowledgeItem(id) {
      return requireEntity(
        getData<KnowledgeItem>(await requestJson(`/api/knowledge/items/${encodeURIComponent(id)}`)),
        '知识内容返回无效。'
      );
    },
    async createKnowledgeCandidate(input) {
      const result = getData<KnowledgeCandidateResult>(
        await requestJson('/api/knowledge/items', { method: 'POST', body: JSON.stringify(input) })
      );
      if (!result?.item?.id || !Array.isArray(result.evidence)) throw new Error('知识候选返回无效。');
      return result;
    },
    async updateKnowledgeItem(id, input) {
      return requireEntity(
        getData<KnowledgeItem>(
          await requestJson(`/api/knowledge/items/${encodeURIComponent(id)}`, {
            method: 'PATCH',
            body: JSON.stringify(input)
          })
        ),
        '知识保存返回无效。'
      );
    },
    confirmKnowledgeItem: (id, input) => mutateKnowledgeItem(id, 'confirm', input),
    archiveKnowledgeItem: (id, input) => mutateKnowledgeItem(id, 'archive', input),
    restoreKnowledgeItem: (id, input) => mutateKnowledgeItem(id, 'restore', input),
    trashKnowledgeItem: (id, input) => mutateKnowledgeItem(id, 'trash', input),
    restoreDeletedKnowledgeItem: (id, input) => mutateKnowledgeItem(id, 'restore-deleted', input),
    async inspectKnowledgePurge(id) {
      const result = getData<KnowledgePurgePreview>(
        await requestJson(`/api/knowledge/items/${encodeURIComponent(id)}/purge-preview`)
      );
      if (!result?.asset?.id) throw new Error('知识清理预检返回无效。');
      return result;
    },
    async permanentlyDeleteKnowledgeItem(id, input) {
      const result = getData<KnowledgePurgeResult>(
        await requestJson(`/api/knowledge/items/${encodeURIComponent(id)}/permanent`, {
          method: 'DELETE',
          body: JSON.stringify(input)
        })
      );
      if (!result?.asset?.id) throw new Error('知识清理结果无效。');
      return result;
    },
    async getKnowledgeProvenance(id) {
      const result = getData<KnowledgeProvenance>(
        await requestJson(`/api/knowledge/items/${encodeURIComponent(id)}/provenance`)
      );
      if (
        !result ||
        result.artifactId !== id ||
        !['absent', 'legacy-unavailable', 'recorded'].includes(result.state) ||
        !Array.isArray(result.sources) ||
        (result.state === 'absent'
          ? result.record !== null
          : !result.record || result.record.artifactId !== id || result.record.state !== result.state)
      ) {
        throw new Error('知识来源摘要返回无效。');
      }
      return result;
    },
    async listKnowledgeEvidence(id) {
      return asArray<KnowledgeEvidence>(
        getData(await requestJson(`/api/knowledge/items/${encodeURIComponent(id)}/evidence`))
      );
    },
    async createKnowledgeEvidence(id, input) {
      return requireEntity(
        getData<KnowledgeEvidence>(
          await requestJson(`/api/knowledge/items/${encodeURIComponent(id)}/evidence`, {
            method: 'POST',
            body: JSON.stringify(input)
          })
        ),
        '知识来源返回无效。'
      );
    },
    async retireKnowledgeEvidence(id, evidenceId, input = {}) {
      const result = getData<KnowledgeEvidenceMutationResult>(
        await requestJson(
          `/api/knowledge/items/${encodeURIComponent(id)}/evidence/${encodeURIComponent(evidenceId)}/retire`,
          {
            method: 'POST',
            body: JSON.stringify(input)
          }
        )
      );
      if (!result?.item?.id || !result?.evidence?.id) throw new Error('知识来源变更返回无效。');
      return result;
    },
    async readoptKnowledgeEvidence(id, evidenceId, input = {}) {
      const result = getData<KnowledgeEvidenceMutationResult>(
        await requestJson(
          `/api/knowledge/items/${encodeURIComponent(id)}/evidence/${encodeURIComponent(evidenceId)}/readopt`,
          {
            method: 'POST',
            body: JSON.stringify(input)
          }
        )
      );
      if (!result?.item?.id || !result?.evidence?.id) throw new Error('知识来源变更返回无效。');
      return result;
    },
    async loadWorkspaceResources(spaceId) {
      const encodedSpaceId = encodeURIComponent(spaceId ?? '');
      const [folderTreePayload, notesPayload, tagsPayload, tagGroupsPayload] = await Promise.all([
        requestJson(`/api/knowledge/folders/tree?spaceId=${encodedSpaceId}`),
        requestJson(`/api/knowledge/notes?spaceId=${encodedSpaceId}&includeDeleted=true&summaryOnly=true`),
        requestJson(`/api/knowledge/tags?spaceId=${encodedSpaceId}`),
        requestJson(`/api/knowledge/tag-groups?spaceId=${encodedSpaceId}`)
      ]);
      return {
        folderTree: asArray<Folder>(getData(folderTreePayload)),
        notes: asArray<Note>(getData(notesPayload)),
        tags: asArray<Tag>(getData(tagsPayload)),
        tagGroups: asArray<TagGroup>(getData(tagGroupsPayload))
      };
    },
    async searchNoteIds({ query, spaceId }) {
      const params = [
        ['query', query ?? ''],
        ['spaceId', spaceId ?? ''],
        ['includeDeleted', 'true'],
        ['result', 'ids']
      ]
        .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
        .join('&');
      return asArray<string>(getData(await requestJson(`/api/knowledge/search/notes?${params}`)));
    },
    searchCommandNotes: input => requestCommandNoteSearch(requestJson, input),
    async listKnowledgeSpaces() {
      return asArray<KnowledgeSpace>(getData(await requestJson('/api/knowledge/spaces')));
    },
    async createDefaultKnowledgeSpace() {
      const space = getData<KnowledgeSpace>(
        await requestJson('/api/knowledge/spaces/default', {
          method: 'POST',
          body: JSON.stringify({})
        })
      );
      if (!space?.id) throw new Error('Default knowledge space response is invalid.');
      return space;
    },
    async createKnowledgeSpace(input) {
      return requireEntity(
        getData<KnowledgeSpace>(
          await requestJson('/api/knowledge/spaces', { method: 'POST', body: JSON.stringify(input) })
        ),
        '空间创建返回无效。'
      );
    },
    async inspectEmptySpaceDeletion(id) {
      const preview = getData<SpaceDeletionPreview>(
        await requestJson(`/api/knowledge/spaces/${encodeURIComponent(id)}/deletion-preflight`)
      );
      if (!preview?.asset?.id) throw new Error('空间删除预检返回无效。');
      return preview;
    },
    async deleteEmptySpace(id, input) {
      const result = getData<{ status: string }>(
        await requestJson(`/api/knowledge/spaces/${encodeURIComponent(id)}`, {
          method: 'DELETE',
          body: JSON.stringify(input)
        })
      );
      if (result?.status !== 'empty-container-deleted') throw new Error('空间删除结果无效。');
      return result;
    },
    async previewSpaceMigration(sourceId, targetId) {
      const preview = getData<SpaceMigrationPreview>(
        await requestJson(
          `/api/knowledge/spaces/${encodeURIComponent(sourceId)}/migration-preview?targetSpaceId=${encodeURIComponent(targetId)}`
        )
      );
      if (!preview?.previewHash) throw new Error('空间迁移预检返回无效。');
      return preview;
    },
    async migrateSpaceAssets(sourceId, input) {
      const result = getData<{ status: string; counts: Record<string, number> }>(
        await requestJson(`/api/knowledge/spaces/${encodeURIComponent(sourceId)}/migrate`, {
          method: 'POST',
          body: JSON.stringify(input)
        })
      );
      if (result?.status !== 'scoped-assets-migrated') throw new Error('空间迁移结果无效。');
      return result;
    },
    async createNote(input) {
      const note = getData<Note>(
        await requestJson('/api/knowledge/notes', {
          method: 'POST',
          body: JSON.stringify(input)
        })
      );
      if (!note?.id) throw new Error('Create note response is invalid.');
      return note;
    },
    async importMarkdownNotes(items) {
      const path =
        items.length === 1 ? '/api/knowledge/notes/import-markdown' : '/api/knowledge/notes/import-markdown-batch';
      const body = items.length === 1 ? items[0] : { items };
      const notes = asItems<Note>(
        getData(
          await requestJson(path, {
            method: 'POST',
            body: JSON.stringify(body)
          })
        )
      );
      if (notes.length === 0 || notes.some(note => !note?.id)) {
        throw new Error('Import Markdown response is invalid.');
      }
      return notes;
    },
    async getNote(noteId) {
      const note = getData<Note>(await requestJson(`/api/knowledge/notes/${encodeURIComponent(noteId)}`));
      if (!note?.id) throw new Error('Note detail response is invalid.');
      return note;
    },
    async createFolder(input) {
      const folder = getData<Folder>(
        await requestJson('/api/knowledge/folders', {
          method: 'POST',
          body: JSON.stringify(input)
        })
      );
      if (!folder?.id) throw new Error('Create folder response is invalid.');
      return folder;
    },
    async updateNote(noteId, input) {
      const note = getData<Note>(
        await requestJson(`/api/knowledge/notes/${encodeURIComponent(noteId)}`, {
          method: 'PATCH',
          body: JSON.stringify(input)
        })
      );
      if (!note?.id) throw new Error('Update note response is invalid.');
      return note;
    },
    async deleteNote(noteId) {
      const note = getData<Note>(
        await requestJson(`/api/knowledge/notes/${encodeURIComponent(noteId)}`, { method: 'DELETE' })
      );
      if (!note?.id) throw new Error('Delete note response is invalid.');
      return note;
    },
    async restoreNote(noteId) {
      const note = getData<Note>(
        await requestJson(`/api/knowledge/notes/${encodeURIComponent(noteId)}/restore`, { method: 'POST' })
      );
      if (!note?.id) throw new Error('Restore note response is invalid.');
      return note;
    },
    async permanentlyDeleteNote(noteId) {
      const note = getData<Note>(
        await requestJson(`/api/knowledge/notes/${encodeURIComponent(noteId)}/permanent`, { method: 'DELETE' })
      );
      if (!note?.id) throw new Error('Permanent delete note response is invalid.');
      return note;
    },
    async setNoteFavorite(noteId, favorite) {
      const note = getData<Note>(
        await requestJson(`/api/knowledge/notes/${encodeURIComponent(noteId)}/favorite`, {
          method: 'POST',
          body: JSON.stringify({ favorite })
        })
      );
      if (!note?.id) throw new Error('Favorite note response is invalid.');
      return note;
    },
    async setNoteTags(noteId, tagIds) {
      const note = getData<Note>(
        await requestJson(`/api/knowledge/notes/${encodeURIComponent(noteId)}/tags`, {
          method: 'PUT',
          body: JSON.stringify({ tagIds })
        })
      );
      if (!note?.id) throw new Error('Set note tags response is invalid.');
      return note;
    },
    async createTag(input) {
      return requireEntity(
        getData<Tag>(await requestJson('/api/knowledge/tags', { method: 'POST', body: JSON.stringify(input) })),
        'Create tag response is invalid.'
      );
    },
    async updateTag(tagId, input) {
      return requireEntity(
        getData<Tag>(
          await requestJson(`/api/knowledge/tags/${encodeURIComponent(tagId)}`, {
            method: 'PATCH',
            body: JSON.stringify(input)
          })
        ),
        'Update tag response is invalid.'
      );
    },
    async deleteTag(tagId) {
      return requireEntity(
        getData<Tag>(await requestJson(`/api/knowledge/tags/${encodeURIComponent(tagId)}`, { method: 'DELETE' })),
        'Delete tag response is invalid.'
      );
    },
    async mergeTags(sourceTagId, targetTagId) {
      return requireEntity(
        getData<Tag>(
          await requestJson('/api/knowledge/tags/merge', {
            method: 'POST',
            body: JSON.stringify({ sourceTagId, targetTagId })
          })
        ),
        'Merge tags response is invalid.'
      );
    },
    async reorderTags(tagIds) {
      return asItems<Tag>(
        getData(await requestJson('/api/knowledge/tags/reorder', { method: 'POST', body: JSON.stringify({ tagIds }) }))
      );
    },
    async createTagGroup(input) {
      return requireEntity(
        getData<TagGroup>(
          await requestJson('/api/knowledge/tag-groups', { method: 'POST', body: JSON.stringify(input) })
        ),
        'Create tag group response is invalid.'
      );
    },
    async updateTagGroup(groupId, input) {
      return requireEntity(
        getData<TagGroup>(
          await requestJson(`/api/knowledge/tag-groups/${encodeURIComponent(groupId)}`, {
            method: 'PATCH',
            body: JSON.stringify(input)
          })
        ),
        'Update tag group response is invalid.'
      );
    },
    async deleteTagGroup(groupId) {
      return requireEntity(
        getData<TagGroup>(
          await requestJson(`/api/knowledge/tag-groups/${encodeURIComponent(groupId)}`, { method: 'DELETE' })
        ),
        'Delete tag group response is invalid.'
      );
    },
    async deleteNotes(noteIds) {
      return asItems<Note>(
        getData(
          await requestJson('/api/knowledge/notes/batch/delete', {
            method: 'POST',
            body: JSON.stringify({ noteIds })
          })
        )
      );
    },
    async assignTagToNotes(noteIds, tagId) {
      return asItems<Note>(
        getData(
          await requestJson('/api/knowledge/notes/batch/tags', {
            method: 'POST',
            body: JSON.stringify({ noteIds, tagId })
          })
        )
      );
    },
    async updateTagsForNotes(noteIds, addTagIds, removeTagIds) {
      return asItems<Note>(
        getData(
          await requestJson('/api/knowledge/notes/batch/tags', {
            method: 'PATCH',
            body: JSON.stringify({ noteIds, addTagIds, removeTagIds })
          })
        )
      );
    },
    async queryNotes(input) {
      const limit = Math.max(1, input.limit ?? 30);
      const values: Record<string, string | number | boolean | null | undefined> = {
        spaceId: input.spaceId,
        folderId: input.folderId,
        tagId: input.tagId,
        tagIds: input.tagIds?.join(','),
        match: input.tagMatch,
        contentKind: input.contentKind,
        favoriteOnly: input.favoriteOnly,
        deletedOnly: input.deletedOnly,
        includeDeleted: input.includeDeleted,
        sortBy: input.sortBy,
        order: input.order,
        offset: input.offset ?? 0,
        limit: limit + 1
      };
      const params = Object.entries(values)
        .filter(([, value]) => value !== undefined && value !== null && value !== false && value !== '')
        .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
        .join('&');
      const query = input.query?.trim();
      const path = query
        ? `/api/knowledge/search/notes?query=${encodeURIComponent(query)}&${params}`
        : `/api/knowledge/notes?summaryOnly=true&${params}`;
      const notes = asArray<Note>(getData(await requestJson(path)));
      return { items: notes.slice(0, limit), hasNext: notes.length > limit };
    },
    async getLinkedNotes(noteId) {
      return asArray<Note>(getData(await requestJson(`/api/knowledge/notes/${encodeURIComponent(noteId)}/links`)));
    },
    async getNoteLinkRelations(noteId) {
      const data = getData<NoteLinkRelations>(
        await requestJson(`/api/knowledge/notes/${encodeURIComponent(noteId)}/link-relations`)
      );
      if (
        !data ||
        data.noteId !== noteId ||
        typeof data.spaceId !== 'string' ||
        !/^[a-f0-9]{64}$/.test(data.contentHash) ||
        !Array.isArray(data.outgoing) ||
        !Array.isArray(data.backlinks)
      )
        throw new Error('笔记引用查询返回无效。');
      return data;
    },
    async listAnnotations(noteId, spaceId) {
      return asArray<Annotation>(
        getData(
          await requestJson(
            `/api/knowledge/annotations?noteId=${encodeURIComponent(noteId)}&spaceId=${encodeURIComponent(spaceId)}`
          )
        )
      );
    },
    async deleteAnnotation(annotationId, expectedRevision) {
      const annotation = getData<Annotation>(
        await requestJson(`/api/knowledge/annotations/${encodeURIComponent(annotationId)}`, {
          method: 'DELETE',
          ...(expectedRevision ? { body: JSON.stringify({ expectedRevision }) } : {})
        })
      );
      if (!annotation?.id) throw new Error('Delete annotation response is invalid.');
      return annotation;
    },
    async restoreAnnotation(annotationId, expectedRevision) {
      const annotation = getData<Annotation>(
        await requestJson(`/api/knowledge/annotations/${encodeURIComponent(annotationId)}/restore`, {
          method: 'POST',
          ...(expectedRevision ? { body: JSON.stringify({ expectedRevision }) } : {})
        })
      );
      if (!annotation?.id) throw new Error('Restore annotation response is invalid.');
      return annotation;
    },
    async updateAnnotation(annotationId, input) {
      const annotation = getData<Annotation>(
        await requestJson(`/api/knowledge/annotations/${encodeURIComponent(annotationId)}`, {
          method: 'PATCH',
          body: JSON.stringify(input)
        })
      );
      if (!annotation?.id) throw new Error('Update annotation response is invalid.');
      return annotation;
    },
    async confirmAnnotationRange(annotationId, input) {
      const value = getData<Annotation>(
        await requestJson(`/api/knowledge/annotations/${encodeURIComponent(annotationId)}/confirm-range`, {
          method: 'POST',
          body: JSON.stringify(input)
        })
      );
      if (!value?.id) throw new Error('范围确认返回无效');
      return value;
    },
    async previewAnnotation(annotationId) {
      const value = getData<AnnotationPreview>(
        await requestJson(`/api/knowledge/annotations/${encodeURIComponent(annotationId)}/preview`)
      );
      if (!value) throw new Error('Annotation preview response is invalid.');
      return value;
    },
    async getAnnotationKnowledgeLinks(annotationId) {
      const value = getData<AnnotationKnowledgeLinks>(
        await requestJson(`/api/knowledge/annotations/${encodeURIComponent(annotationId)}/knowledge-links`)
      );
      if (!value) throw new Error('Annotation knowledge links response is invalid.');
      return value;
    },
    async previewAnalysisScope(input) {
      const value = getData<AnalysisScopePreview>(
        await requestJson('/api/knowledge/analysis-scopes/preview', { method: 'POST', body: JSON.stringify(input) })
      );
      if (!value) throw new Error('Analysis scope preview response is invalid.');
      return value;
    },
    async createAnalysisScope(input) {
      const value = getData<{ id: string }>(
        await requestJson('/api/knowledge/analysis-scopes', { method: 'POST', body: JSON.stringify(input) })
      );
      if (!value?.id) throw new Error('Analysis scope response is invalid.');
      return value;
    },
    async listAnalysisScopes(spaceId) {
      return asArray<AnalysisScopeSnapshot>(
        getData(
          await requestJson(`/api/knowledge/analysis-scopes?spaceId=${encodeURIComponent(spaceId)}&includeDeleted=true`)
        )
      );
    },
    async trashAnalysisScope(id, input) {
      return requireEntity(
        getData<AnalysisScopeSnapshot>(
          await requestJson(`/api/knowledge/analysis-scopes/${encodeURIComponent(id)}/trash`, {
            method: 'POST',
            body: JSON.stringify(input)
          })
        ),
        '分析范围返回无效。'
      );
    },
    async restoreAnalysisScope(id, input) {
      return requireEntity(
        getData<AnalysisScopeSnapshot>(
          await requestJson(`/api/knowledge/analysis-scopes/${encodeURIComponent(id)}/restore`, {
            method: 'POST',
            body: JSON.stringify(input)
          })
        ),
        '分析范围返回无效。'
      );
    },
    async deleteAnnotationExclusion(annotationId, exclusionId, expectedRevision) {
      const value = getData<AnnotationExclusionResult>(
        await requestJson(
          `/api/knowledge/annotations/${encodeURIComponent(annotationId)}/exclusions/${encodeURIComponent(exclusionId)}`,
          { method: 'DELETE', body: JSON.stringify({ expectedRevision }) }
        )
      );
      if (!value?.annotation?.id || !value.exclusion?.id)
        throw new Error('Delete annotation exclusion response is invalid.');
      return value;
    },
    async listNoteVersions(noteId) {
      return asArray<NoteVersion>(
        getData(await requestJson(`/api/knowledge/notes/${encodeURIComponent(noteId)}/versions`))
      );
    },
    async listNoteVersionPage(noteId, options = {}) {
      const query = `limit=${encodeURIComponent(String(options.limit ?? 20))}${options.cursor ? `&cursor=${encodeURIComponent(options.cursor)}` : ''}`;
      const page = getData<NoteVersionPage>(
        await requestJson(`/api/knowledge/notes/${encodeURIComponent(noteId)}/versions?${query}`)
      );
      if (!page || !Array.isArray(page.items) || typeof page.total !== 'number') throw new Error('版本历史响应无效');
      return page;
    },
    async previewNoteVersionPrune(noteId) {
      const preview = getData<NoteVersionPrunePreview>(
        await requestJson(`/api/knowledge/notes/${encodeURIComponent(noteId)}/versions/prune-preview`)
      );
      if (!preview || !Array.isArray(preview.versions)) throw new Error('版本清理预览返回无效。');
      return preview;
    },
    async getNoteVersion(noteId, versionId) {
      const version = getData<NoteVersion>(
        await requestJson(
          `/api/knowledge/notes/${encodeURIComponent(noteId)}/versions/${encodeURIComponent(versionId)}`
        )
      );
      if (!version?.id) throw new Error('Note version response is invalid.');
      return version;
    },
    ...createAttachmentApi(requestJson),
    async updateFolder(folderId, input) {
      const folder = getData<Folder>(
        await requestJson(`/api/knowledge/folders/${encodeURIComponent(folderId)}`, {
          method: 'PATCH',
          body: JSON.stringify(input)
        })
      );
      if (!folder?.id) throw new Error('Update folder response is invalid.');
      return folder;
    },
    async deleteFolder(folderId, input) {
      return getData<{ folders: Folder[]; deletionPackage: Folder['deletionPackage'] }>(
        await requestJson(`/api/knowledge/folders/${encodeURIComponent(folderId)}`, {
          method: 'DELETE',
          body: JSON.stringify(input)
        })
      )!;
    },
    async restoreFolder(folderId) {
      return getData<{ folders: Folder[] }>(
        await requestJson(`/api/knowledge/folders/${encodeURIComponent(folderId)}/restore`, {
          method: 'POST',
          body: '{}'
        })
      )!;
    },
    async listDeletedFolders(spaceId) {
      return asArray<Folder>(
        getData(await requestJson(`/api/knowledge/folders?spaceId=${encodeURIComponent(spaceId)}&includeDeleted=true`))
      ).filter(folder => folder.deletedAt && folder.deletionPackage);
    },
    async emptyRecycleBin(spaceId) {
      return (
        getData<EmptyRecycleBinResult>(
          await requestJson(`/api/knowledge/notes/recycle-bin?spaceId=${encodeURIComponent(spaceId ?? '')}`, {
            method: 'DELETE'
          })
        ) ?? {}
      );
    }
  };
}
