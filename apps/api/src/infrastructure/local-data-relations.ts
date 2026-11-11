import type { AnnotationStructure } from '@study-accelerator/content-anchor';
import type { AppError } from '../errors/app-error.ts';
import type {
  LocalDataState,
  LocalCollection,
  LocalRow,
  LocalRows,
  StoredJsonField,
  LocalQuestionSource
} from './local-data-types.ts';
type Rows<K extends LocalCollection> = LocalRows<K>;
type Row<K extends LocalCollection> = LocalRow<K>;
type Index<K extends LocalCollection> = Map<string | null | undefined, Row<K>>;
interface QuestionReferences {
  questions: Map<string | null | undefined, { id: string }>;
  knowledgeItems: Map<string | null | undefined, SourceItem>;
  knowledgeEvidence: Map<string | null | undefined, SourceEvidence>;
  learningObjectives: Index<'learningObjectives'>;
  notes: Map<string | null | undefined, ReconciliationNote>;
  noteVersions: Index<'noteVersions'>;
}
interface SourceItem {
  id: string;
  title?: string;
  canonicalStatement?: string;
  reviewStatus?: string | null;
  sourceMode?: string | null;
  deletedAt?: unknown;
  updatedAt?: unknown;
}
interface SourceEvidence {
  id: string;
  knowledgeItemId: string;
  noteId?: string | null;
  noteVersionId?: string | null;
  annotationId?: string | null;
  quoteText?: unknown;
  status?: string | null;
  applicabilityStatus?: string | null;
  sourceType?: string | null;
  relationType?: string | null;
}
type ReconciliationNote = Pick<Row<'notes'>, 'id' | 'rawMarkdown' | 'deleted'>;
type ReconciliationAnnotation = Pick<
  Row<'contentAnnotations'>,
  'id' | 'noteId' | 'quoteText' | 'status' | 'anchorStatus' | 'lifecycleStatus'
>;
interface ReconciliationState extends Pick<
  LocalDataState,
  'noteVersions' | 'learningObjectives' | 'questionObjectives'
> {
  questions: { id: string; reviewStatus?: string }[];
  questionSources: LocalQuestionSource[];
  knowledgeItems: SourceItem[];
  knowledgeEvidence: SourceEvidence[];
  notes: ReconciliationNote[];
  contentAnnotations: ReconciliationAnnotation[];
}
type NativeDate = new (value: unknown) => Date;
import { validatePdfRelations } from '@study-accelerator/shared/pdf';
import { parseTagColor } from '@study-accelerator/shared/tag-colors';
import { sameKnowraText } from '@study-accelerator/shared/knowra-marks';
import { calculateContentHash, projectMarkdown, resolveAnchor, listTracking } from '@study-accelerator/content-anchor';
import { nextKnowledgeItemTimestamp } from '../modules/knowledge/application/knowledge-item-concurrency.ts';
import crypto from 'node:crypto';
import { createAppError } from '../errors/app-error.ts';
import {
  assertKnowledgeItemConfirmable,
  assertLearningObjectiveConfirmable,
  assertQuestionConfirmable,
  deriveQuestionSourceStatus
} from '../modules/knowledge/application/formal-asset-validation.ts';
import { buildDefaultTagGroups } from '../modules/knowledge/domain/default-tag-groups.ts';
import { validateKnowledgeArtifactProvenanceRelations } from '../modules/knowledge/domain/knowledge-artifact-provenance-state.ts';
import { resolveAnalysisScopeNoteVersion } from '../modules/knowledge/domain/analysis-scope-version-alias.ts';
import { deriveEvidenceHealth } from '../modules/knowledge/domain/evidence-health.ts';

export function validateLocalDataRelations<State extends LocalDataState>(state: State): State {
  normalizeTagSystem(state);
  const spaces = indexById(state.spaces);
  const folders = indexById(state.folders);
  const tags = indexById(state.tags);
  const tagGroups = indexById(state.tagGroups ?? []);
  const notes = indexById(state.notes);
  const noteVersions = indexById(state.noteVersions);
  const knowledgeItems = indexById(state.knowledgeItems);
  const knowledgeEvidence = indexById(state.knowledgeEvidence);
  const annotations = indexById(state.contentAnnotations);
  const learningObjectives = indexById(state.learningObjectives);
  const examProfiles = indexById(state.examProfiles);
  const examFocuses = indexById(state.examFocuses);
  const questions = indexById(state.questions);

  validateFolders(state.folders, spaces, folders);
  validateTagGroups(state.tagGroups ?? [], spaces);
  validateTags(state.tags, spaces, tagGroups);
  validateNotes(state.notes, spaces, folders, tags);
  validateAnnotations(state.contentAnnotations, spaces, notes, noteVersions);
  validateAnnotationExtensions(state, spaces, annotations, noteVersions);
  validateNoteVersions(state.noteVersions, notes);
  validateKnowledgeItems(state.knowledgeItems);
  validateKnowledgeEvidence(state.knowledgeEvidence, knowledgeItems, notes, noteVersions, annotations);
  validateKnowledgeArtifactProvenanceRelations(state);
  validateAttachments(state.attachments, notes);
  try {
    validatePdfRelations(state);
  } catch (caught) {
    const error = caught as AppError;
    throw createAppError('STORAGE_IMPORT_INVALID', error.message, 422);
  }
  validateLearningObjectives(state.learningObjectives, knowledgeItems);
  validateExamProfiles(state.examProfiles);
  validateExamFocuses(state.examFocuses, examProfiles, learningObjectives);
  validateQuestions(state.questions);
  validateQuestionObjectives(state.questionObjectives, questions, learningObjectives);
  validateQuestionSources(state.questionSources, {
    questions,
    knowledgeItems,
    knowledgeEvidence,
    learningObjectives,
    notes,
    noteVersions
  });
  validateFormalAssetGates(state, {
    knowledgeItems,
    learningObjectives
  });
  assertFolderGraphHasNoCycles(state.folders, folders);
  return state;
}

function validateAnnotationExtensions(
  state: LocalDataState,
  spaces: Index<'spaces'>,
  annotations: Index<'contentAnnotations'>,
  noteVersions: Index<'noteVersions'>
) {
  for (const exclusion of state.annotationExclusions ?? []) {
    const annotation = annotations.get(exclusion.parentAnnotationId);
    assertReference(Boolean(annotation), `AnnotationExclusion ${exclusion.id} references unknown annotation`);
    assertReference(
      (['section', 'list'] as readonly unknown[]).includes(annotation!.scopeType),
      `AnnotationExclusion ${exclusion.id} requires a section or list annotation`
    );
    if (exclusion.noteVersionId)
      assertReference(
        noteVersions.has(exclusion.noteVersionId),
        `AnnotationExclusion ${exclusion.id} references unknown NoteVersion`
      );
  }
  for (const revision of state.annotationRevisions ?? []) {
    assertReference(
      annotations.has(revision.annotationId),
      `AnnotationRevision ${revision.id} references unknown annotation`
    );
  }
  for (const snapshot of state.analysisScopeSnapshots ?? []) {
    assertReference(spaces.has(snapshot.spaceId), `AnalysisScopeSnapshot ${snapshot.id} references unknown space`);
    for (const version of snapshot.noteVersions ?? []) {
      resolveAnalysisScopeNoteVersion(snapshot, version, noteVersions as Map<string, Row<'noteVersions'>>);
    }
  }
}

export function normalizeLegacyNoteReferences(state: LocalDataState, { repairBrokenReferences = false } = {}) {
  const spaces = indexById(state.spaces);
  const folders = indexById(state.folders);
  const onlySpaceId = state.spaces.length === 1 ? state.spaces[0].id : null;

  for (const note of state.notes) {
    const folderSpaceId = note.folderId ? folders.get(note.folderId)?.spaceId : null;
    if (!note!.spaceId || (repairBrokenReferences && !spaces.has(note!.spaceId) && onlySpaceId)) {
      note!.spaceId = folderSpaceId ?? onlySpaceId;
    }
    if (repairBrokenReferences && note.folderId && !folders.has(note.folderId)) {
      note.folderId = null;
    }
  }
}

function validateFolders(folderItems: Rows<'folders'>, spaces: Index<'spaces'>, folders: Index<'folders'>) {
  for (const folder of folderItems) {
    assertReference(spaces.has(folder!.spaceId), `Folder ${folder.id} references unknown space: ${folder!.spaceId}`);
    if (folder.parentId === null || folder.parentId === undefined) {
      continue;
    }

    const parent = folders.get(folder.parentId);
    assertReference(Boolean(parent), `Folder ${folder.id} references unknown parent: ${folder.parentId}`);
    assertReference(
      parent!.spaceId === folder!.spaceId,
      `Folder ${folder.id} and its parent must belong to the same space`
    );
    assertReference(
      folder!.deletedAt || !parent!.deletedAt,
      `Active folder ${folder.id} cannot be inside a deleted folder`
    );
  }
}

function validateTagGroups(groupItems: Rows<'tagGroups'>, spaces: Index<'spaces'>) {
  for (const group of groupItems) {
    assertReference(spaces.has(group!.spaceId), `TagGroup ${group.id} references unknown space: ${group!.spaceId}`);
    assertReference(
      (['single', 'multiple'] as readonly unknown[]).includes(group.selectionMode),
      `TagGroup ${group.id} has invalid selectionMode`
    );
  }
}

function validateTags(tagItems: Rows<'tags'>, spaces: Index<'spaces'>, tagGroups: Index<'tagGroups'>) {
  for (const tag of tagItems) {
    assertReference(spaces.has(tag!.spaceId), `Tag ${tag.id} references unknown space: ${tag!.spaceId}`);
    if (tag.groupId) {
      const group = tagGroups.get(tag.groupId);
      assertReference(Boolean(group), `Tag ${tag.id} references unknown group: ${tag.groupId}`);
      assertReference(group!.spaceId === tag!.spaceId, `Tag ${tag.id} and its group must belong to the same space`);
    }
  }
}

function normalizeTagSystem(state: LocalDataState) {
  state.tagGroups ??= [];
  // 与原 find 保持首次匹配语义；索引仅属于本次归一化，不跨快照复用。
  const groupsById = new Map<string | null | undefined, Row<'tagGroups'>>();
  for (const group of state.tagGroups) {
    if (!groupsById.has(group.id)) groupsById.set(group.id, group);
  }
  for (const space of state.spaces) {
    buildDefaultTagGroups(space.id).forEach(group => {
      if (!groupsById.has(group.id)) {
        state.tagGroups.push(group);
        groupsById.set(group.id, group);
      }
    });
  }
  state.tags.forEach((tag, index) => {
    tag.color = parseTagColor(tag.color ?? 'neutral') ?? tag.color ?? 'neutral';
    tag.isSystem = Boolean(tag.isSystem);
    tag.sortOrder = Number(tag.sortOrder) || index + 1;
    if (!tag.groupId) tag.groupId = `tag-group-${tag!.spaceId}-ordinary`;
  });
  const tagsById = new Map<string, Row<'tags'>>();
  for (const tag of state.tags) {
    if (!tagsById.has(tag.id)) tagsById.set(tag.id, tag);
  }
  state.notes.forEach(note => {
    const normalizedIds: (string | null)[] = [];
    const singleIndexes = new Map<string, number>();
    [...new Set((note.tagIds ?? []).filter(id => tagsById.has(id)))].forEach(tagId => {
      const tag = tagsById.get(tagId);
      const group = groupsById.get(tag?.groupId);
      if (group?.selectionMode === 'single') {
        const previous = singleIndexes.get(group.id);
        if (previous !== undefined) normalizedIds[previous] = null;
        singleIndexes.set(group.id, normalizedIds.length);
      }
      normalizedIds.push(tagId);
    });
    note.tagIds = normalizedIds.filter(Boolean) as string[];
  });
}

function validateNotes(
  noteItems: Rows<'notes'>,
  spaces: Index<'spaces'>,
  folders: Index<'folders'>,
  tags: Index<'tags'>
) {
  for (const note of noteItems) {
    validateNoteSpace(note, spaces);
    validateNoteFolder(note, folders);
    validateNoteTags(note, tags);
    if (note!.annotationStructure) {
      const structure = note!.annotationStructure as StoredJsonField<AnnotationStructure>;
      assertReference(
        structure.formatVersion === 1 &&
          Number.isInteger(structure.revision) &&
          structure.revision > 0 &&
          structure.contentHash === calculateContentHash(note!.rawMarkdown) &&
          Array.isArray(structure.nodes),
        `Note ${note.id} has invalid annotation structure`
      );
      const blocks = projectMarkdown(note!.rawMarkdown).blocks;
      const ids = new Set();
      for (const node of structure.nodes) {
        assertReference(
          typeof node.id === 'string' &&
            !ids.has(node.id) &&
            blocks.some(
              block =>
                block.path === node.path &&
                block.type === node.type &&
                block.sourceStart === node.sourceStart &&
                block.sourceEnd === node.sourceEnd
            ),
          `Note ${note.id} has invalid block identity`
        );
        ids.add(node.id);
      }
    }
  }
}

function validateNoteSpace(note: Row<'notes'>, spaces: Index<'spaces'>) {
  assertReference(
    Boolean(note!.spaceId) && spaces.has(note!.spaceId),
    `Note ${note.id} references unknown space: ${note!.spaceId}`
  );
}

function validateNoteFolder(note: Row<'notes'>, folders: Index<'folders'>) {
  if (note.folderId === null || note.folderId === undefined) {
    return;
  }

  const folder = folders.get(note.folderId);
  assertReference(Boolean(folder), `Note ${note.id} references unknown folder: ${note.folderId}`);
  assertReference(note!.spaceId === folder!.spaceId, `Note ${note.id} and its folder must belong to the same space`);
  assertReference(note.deleted || !folder!.deletedAt, `Active note ${note.id} cannot be inside a deleted folder`);
}

function validateNoteTags(note: Row<'notes'>, tags: Index<'tags'>) {
  const tagIds = note.tagIds ?? [];
  const uniqueTagIds = new Set(tagIds);
  assertReference(uniqueTagIds.size === tagIds.length, `Note ${note.id} contains duplicate tag references`);

  for (const tagId of tagIds) {
    const tag = tags.get(tagId);
    assertReference(Boolean(tag), `Note ${note.id} references unknown tag: ${tagId}`);
    assertReference(note!.spaceId === tag!.spaceId, `Note ${note.id} and tag ${tagId} must belong to the same space`);
  }
}

function validateAnnotations(
  annotationItems: Rows<'contentAnnotations'>,
  spaces: Index<'spaces'>,
  notes: Index<'notes'>,
  noteVersions: Index<'noteVersions'>
) {
  for (const annotation of annotationItems) {
    const note = notes.get(annotation!.noteId);
    assertReference(
      spaces.has(annotation.spaceId),
      `Annotation ${annotation.id} references unknown space: ${annotation.spaceId}`
    );
    assertReference(Boolean(note), `Annotation ${annotation.id} references unknown note: ${annotation!.noteId}`);
    assertReference(
      note!.spaceId === annotation.spaceId,
      `Annotation ${annotation.id} and its note must belong to the same space`
    );
    // v3（内联重点）的列表范围写在正文标记里，没有旧的列表身份。
    if (
      annotation!.scopeType === 'list' &&
      annotation.schemaVersion !== 3 &&
      annotation.lifecycleStatus === 'active' &&
      annotation.anchorStatus === 'resolved' &&
      annotation.noteContentHash === calculateContentHash(note!.rawMarkdown)
    ) {
      const resolution = resolveAnchor(note!.rawMarkdown, annotation.anchor!);
      const tracking = listTracking(
        projectMarkdown(note!.rawMarkdown),
        annotation.anchor!,
        note!.annotationStructure as StoredJsonField<AnnotationStructure>
      );
      assertReference(
        resolution.status === 'resolved' &&
          tracking.rootId === annotation.anchor!.tracking?.rootId &&
          JSON.stringify(tracking.memberIds) === JSON.stringify(annotation.anchor!.tracking?.memberIds) &&
          JSON.stringify(tracking.ancestorItemIds) === JSON.stringify(annotation.anchor!.tracking?.ancestorItemIds),
        `Annotation ${annotation.id} has invalid list identity`
      );
    }
    if (annotation.noteVersionId !== null && annotation.noteVersionId !== undefined) {
      const version = noteVersions.get(annotation.noteVersionId);
      assertReference(
        Boolean(version) && version!.noteId === annotation!.noteId,
        `Annotation ${annotation.id} references an invalid NoteVersion`
      );
    }
  }
}

function validateAttachments(attachmentItems: Rows<'attachments'>, notes: Index<'notes'>) {
  for (const attachment of attachmentItems) {
    assertReference(
      notes.has(attachment.noteId),
      `Attachment ${attachment.id} references unknown note: ${attachment.noteId}`
    );
  }
}

function validateNoteVersions(versionItems: Rows<'noteVersions'>, notes: Index<'notes'>) {
  for (const version of versionItems) {
    assertReference(
      notes.has(version!.noteId),
      `NoteVersion ${version.id} references unknown note: ${version!.noteId}`
    );
    const actualContentHash = crypto
      .createHash('sha256')
      .update(String(version.content ?? ''))
      .digest('hex');
    assertReference(
      version.contentHash === actualContentHash,
      `NoteVersion ${version.id} contentHash does not match its content`
    );
  }
}

function validateKnowledgeItems(items: Rows<'knowledgeItems'>) {
  for (const item of items) {
    assertReference(
      ['candidate', 'confirmed', 'needsRevision', 'archived'].includes(item.reviewStatus ?? 'candidate'),
      `KnowledgeItem ${item.id} has an invalid reviewStatus`
    );
  }
}

function validateKnowledgeEvidence(
  items: SourceEvidence[],
  knowledgeItems: Map<string | null | undefined, SourceItem>,
  notes: Map<string | null | undefined, ReconciliationNote>,
  noteVersions: Index<'noteVersions'>,
  annotations: Map<string | null | undefined, ReconciliationAnnotation>
) {
  for (const evidence of items) {
    let note: ReconciliationNote | null | undefined = null;
    let version: Row<'noteVersions'> | null | undefined = null;
    let annotation: ReconciliationAnnotation | null | undefined = null;
    assertReference(
      knowledgeItems.has(evidence.knowledgeItemId),
      `KnowledgeEvidence ${evidence.id} references unknown KnowledgeItem: ${evidence.knowledgeItemId}`
    );
    if (evidence.noteId !== null && evidence.noteId !== undefined) {
      note = notes.get(evidence.noteId);
      assertReference(Boolean(note), `KnowledgeEvidence ${evidence.id} references unknown note: ${evidence.noteId}`);
    }
    if (evidence.noteVersionId !== null && evidence.noteVersionId !== undefined) {
      version = noteVersions.get(evidence.noteVersionId);
      assertReference(
        Boolean(version),
        `KnowledgeEvidence ${evidence.id} references unknown NoteVersion: ${evidence.noteVersionId}`
      );
      if (evidence.noteId) {
        assertReference(
          version!.noteId === evidence.noteId,
          `KnowledgeEvidence ${evidence.id} and its NoteVersion must reference the same note`
        );
      }
    }
    if (evidence.annotationId !== null && evidence.annotationId !== undefined) {
      annotation = annotations.get(evidence.annotationId);
      assertReference(
        Boolean(annotation),
        `KnowledgeEvidence ${evidence.id} references unknown annotation: ${evidence.annotationId}`
      );
      if (evidence.noteId) {
        assertReference(
          annotation!.noteId === evidence.noteId,
          `KnowledgeEvidence ${evidence.id} and its annotation must reference the same note`
        );
      }
    }
    if (annotation && version) {
      assertReference(
        annotation!.noteId === version!.noteId,
        `KnowledgeEvidence ${evidence.id} annotation and NoteVersion must reference the same note`
      );
    }
    const resolvedNoteId = evidence.noteId ?? annotation?.noteId ?? version?.noteId ?? null;
    if (!note && resolvedNoteId) {
      note = notes.get(resolvedNoteId);
      assertReference(Boolean(note), `KnowledgeEvidence ${evidence.id} references unknown note: ${resolvedNoteId}`);
      evidence.noteId = resolvedNoteId;
    }
    if (evidence.sourceType === 'noteVersion') {
      assertReference(Boolean(evidence.noteVersionId), `KnowledgeEvidence ${evidence.id} requires noteVersionId`);
    }
    if (evidence.sourceType === 'annotation') {
      assertReference(Boolean(evidence.annotationId), `KnowledgeEvidence ${evidence.id} requires annotationId`);
    }
    evidence.applicabilityStatus ??= evidence.status === 'invalid' ? 'needsReview' : 'active';
    evidence.status = deriveEvidenceHealth(evidence, { annotation, note, version });
  }
}

function validateLearningObjectives(items: Rows<'learningObjectives'>, knowledgeItems: Index<'knowledgeItems'>) {
  for (const objective of items) {
    assertReference(
      knowledgeItems.has(objective.knowledgeItemId),
      `LearningObjective ${objective.id} references unknown KnowledgeItem: ${objective.knowledgeItemId}`
    );
    assertReference(
      ['candidate', 'confirmed', 'archived'].includes(objective.reviewStatus ?? 'candidate'),
      `LearningObjective ${objective.id} has an invalid reviewStatus`
    );
  }
}

function validateExamProfiles(items: Rows<'examProfiles'>) {
  for (const profile of items) {
    assertReference(
      !profile.archivedAt || !Number.isNaN(new (Date as NativeDate)(profile.archivedAt).getTime()),
      `ExamProfile ${profile.id} has an invalid archivedAt`
    );
  }
}

function validateExamFocuses(
  items: Rows<'examFocuses'>,
  examProfiles: Index<'examProfiles'>,
  learningObjectives: Index<'learningObjectives'>
) {
  const unique = new Set();
  for (const focus of items) {
    assertReference(
      examProfiles.has(focus.examProfileId),
      `ExamFocus ${focus.id} references unknown ExamProfile: ${focus.examProfileId}`
    );
    assertReference(
      learningObjectives.has(focus.learningObjectiveId),
      `ExamFocus ${focus.id} references unknown LearningObjective: ${focus.learningObjectiveId}`
    );
    const key = `${focus.examProfileId}\u0000${focus.learningObjectiveId}`;
    assertReference(!unique.has(key), `ExamProfile and LearningObjective already have an ExamFocus: ${key}`);
    unique.add(key);
  }
}

function validateQuestions(items: Rows<'questions'>) {
  for (const question of items) {
    assertReference(
      (['singleChoice', 'multipleChoice', 'trueFalse', 'shortAnswer'] as readonly unknown[]).includes(
        question.questionType ?? 'shortAnswer'
      ),
      `Question ${question.id} has an invalid questionType`
    );
    assertReference(
      ['draft', 'validating', 'candidate', 'confirmed', 'archived'].includes(question.reviewStatus ?? 'draft'),
      `Question ${question.id} has an invalid reviewStatus`
    );
  }
}

function validateQuestionObjectives(
  items: Rows<'questionObjectives'>,
  questions: Index<'questions'>,
  learningObjectives: Index<'learningObjectives'>
) {
  const unique = new Set();
  for (const relation of items) {
    assertReference(
      questions.has(relation.questionId),
      `QuestionObjective ${relation.id} references unknown Question: ${relation.questionId}`
    );
    assertReference(
      learningObjectives.has(relation.learningObjectiveId),
      `QuestionObjective ${relation.id} references unknown LearningObjective: ${relation.learningObjectiveId}`
    );
    const key = `${relation.questionId}\u0000${relation.learningObjectiveId}`;
    assertReference(!unique.has(key), `QuestionObjective relation is duplicated: ${key}`);
    unique.add(key);
  }
}

function validateQuestionSources(
  items: LocalQuestionSource[],
  { questions, knowledgeItems, knowledgeEvidence, learningObjectives, notes, noteVersions }: QuestionReferences
) {
  const referenceMaps: Partial<
    Record<
      string,
      Map<string | null | undefined, SourceItem | SourceEvidence | Row<'learningObjectives'> | Row<'noteVersions'>>
    >
  > = {
    knowledgeItem: knowledgeItems,
    knowledgeEvidence,
    learningObjective: learningObjectives,
    noteVersion: noteVersions
  };
  for (const source of items) {
    assertReference(
      questions.has(source.questionId),
      `QuestionSource ${source.id} references unknown Question: ${source.questionId}`
    );
    assertReference(
      ['active', 'stale', 'reanchored'].includes(source.status ?? 'active'),
      `QuestionSource ${source.id} has an invalid status`
    );
    let reference:
      | ((SourceItem | SourceEvidence | Row<'learningObjectives'> | Row<'noteVersions'>) & {
          isCurrent?: boolean;
          noteId?: string | null;
          content?: unknown;
        })
      | null
      | undefined = null;
    const referenceMap = referenceMaps[source.sourceType as string];
    if (referenceMap) {
      assertReference(Boolean(source.sourceId), `QuestionSource ${source.id} requires sourceId`);
      reference = referenceMap.get(source.sourceId);
      assertReference(
        Boolean(reference),
        `QuestionSource ${source.id} references unknown ${source.sourceType}: ${source.sourceId}`
      );
    }
    if (source.sourceType === 'noteVersion' && reference) {
      const note = notes.get(reference.noteId);
      reference = {
        ...reference,
        isCurrent: Boolean(note && !note.deleted && sameKnowraText(note!.rawMarkdown, reference.content))
      };
    }
    source.status = deriveQuestionSourceStatus(source, reference);
  }
}

function validateFormalAssetGates(
  state: LocalDataState,
  { knowledgeItems, learningObjectives }: Pick<QuestionReferences, 'knowledgeItems' | 'learningObjectives'>
) {
  const evidenceByItemId = groupBy(state.knowledgeEvidence, evidence => evidence.knowledgeItemId);
  for (const item of state.knowledgeItems) {
    if (item.reviewStatus !== 'confirmed') continue;
    assertFormalGate(
      () => assertKnowledgeItemConfirmable(item, evidenceByItemId.get(item.id) ?? []),
      `KnowledgeItem ${item.id} is not confirmable`
    );
  }

  for (const objective of state.learningObjectives) {
    if (objective.deletedAt || objective.reviewStatus !== 'confirmed') continue;
    assertFormalGate(
      () => assertLearningObjectiveConfirmable(objective, knowledgeItems.get(objective.knowledgeItemId)),
      `LearningObjective ${objective.id} is not confirmable`
    );
  }

  const objectiveLinksByQuestionId = groupBy(state.questionObjectives, relation => relation.questionId);
  const sourcesByQuestionId = groupBy(state.questionSources, source => source.questionId);
  for (const question of state.questions) {
    if (question.deletedAt || question.reviewStatus !== 'confirmed') continue;
    const objectives = (objectiveLinksByQuestionId.get(question.id) ?? []).map(relation =>
      learningObjectives.get(relation.learningObjectiveId)
    );
    assertFormalGate(
      () =>
        assertQuestionConfirmable(question, {
          objectives,
          sources: sourcesByQuestionId.get(question.id) ?? []
        }),
      `Question ${question.id} is not confirmable`
    );
  }
}

function assertFolderGraphHasNoCycles(folderItems: Rows<'folders'>, folders: Index<'folders'>) {
  const visits = new Map<string, string>();
  for (const folder of folderItems) {
    visitFolder(folder, folders, visits);
  }
}

function visitFolder(folder: Row<'folders'>, folders: Index<'folders'>, visits: Map<string, string>) {
  const status = visits.get(folder.id);
  if (status === 'visited') {
    return;
  }
  assertReference(status !== 'visiting', `Folder hierarchy contains a cycle at: ${folder.id}`);

  visits.set(folder.id, 'visiting');
  if (folder.parentId !== null && folder.parentId !== undefined) {
    visitFolder(folders.get(folder.parentId)!, folders, visits);
  }
  visits.set(folder.id, 'visited');
}

function indexById<T extends { id: string }>(items: T[]): Map<string | null | undefined, T> {
  return new Map(items.map(item => [item.id, item]));
}

function groupBy<T, Key>(items: T[], keyForItem: (item: T) => Key): Map<Key, T[]> {
  const grouped = new Map<Key, T[]>();
  for (const item of items) {
    const key = keyForItem(item);
    const group = grouped.get(key) ?? [];
    group.push(item);
    grouped.set(key, group);
  }
  return grouped;
}

function assertFormalGate(validate: () => void, message: string) {
  try {
    validate();
  } catch (caught) {
    const error = caught as AppError;
    assertReference(false, `${message}: ${error?.code ?? error?.message ?? 'validation failed'}`);
  }
}

function assertReference(condition: unknown, message: string): asserts condition {
  if (condition) {
    return;
  }
  throw createAppError('STORAGE_SNAPSHOT_INVALID', message, 422);
}

/** 同步的来源变化沿用领域失效规则；先降级已失效的确认状态，再做完整引用校验。 */
export function reconcileSyncedSourceStates<State extends ReconciliationState>(state: State): State {
  const notes = indexById(state.notes);
  const versions = indexById(state.noteVersions);
  const annotations = indexById(state.contentAnnotations);
  const items = indexById(state.knowledgeItems);
  validateKnowledgeEvidence(state.knowledgeEvidence, items, notes, versions, annotations);
  for (const item of state.knowledgeItems) {
    if (
      item.reviewStatus === 'confirmed' &&
      item.sourceMode !== 'manual' &&
      !state.knowledgeEvidence.some(
        evidence =>
          evidence.knowledgeItemId === item.id &&
          evidence.status === 'valid' &&
          evidence.applicabilityStatus === 'active'
      )
    ) {
      item.updatedAt = nextKnowledgeItemTimestamp(item);
      item.reviewStatus = 'needsRevision';
    }
  }
  for (const objective of state.learningObjectives) {
    const item = items.get(objective.knowledgeItemId);
    if (objective.reviewStatus === 'confirmed' && (!item || item.deletedAt || item.reviewStatus !== 'confirmed'))
      objective.reviewStatus = 'candidate';
  }
  const objectives = indexById(state.learningObjectives);
  validateQuestionSources(state.questionSources, {
    questions: indexById(state.questions),
    knowledgeItems: items,
    knowledgeEvidence: indexById(state.knowledgeEvidence),
    learningObjectives: objectives,
    notes,
    noteVersions: versions
  });
  for (const question of state.questions) {
    if (
      question.reviewStatus === 'confirmed' &&
      (state.questionSources.some(source => source.questionId === question.id && source.status === 'stale') ||
        state.questionObjectives.some(
          link =>
            link.questionId === question.id &&
            (objectives.get(link.learningObjectiveId)?.deletedAt ||
              objectives.get(link.learningObjectiveId)?.reviewStatus !== 'confirmed')
        ))
    )
      question.reviewStatus = 'candidate';
  }
  return state;
}
